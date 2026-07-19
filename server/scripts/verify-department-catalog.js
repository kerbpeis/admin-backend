require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const accounts = {
  admin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  },
  readonly: {
    email: process.env.SEED_READONLY_EMAIL || 'readonly@example.com',
    password: process.env.SEED_READONLY_PASSWORD || 'readonly123',
  },
};

const request = async (endpoint, { token, expectedStatus = 200, ...options } = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`${options.method || 'GET'} ${endpoint} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
};

const login = async ({ email, password }) => {
  const data = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return data.token;
};

const assertDepartmentStats = (department, label) => {
  if (!department?.id || !department?.name) {
    throw new Error(`${label}缺少基础字段`);
  }
  if (!Number.isFinite(Number(department.fileCount)) || !Number.isFinite(Number(department.knowledgePointCount))) {
    throw new Error(`${label}缺少资料统计字段`);
  }
};

const main = async () => {
  const adminToken = await login(accounts.admin);
  const readonlyToken = await login(accounts.readonly);

  await request('/api/departments/professions', { expectedStatus: 401 });

  const professions = await request('/api/departments/professions', { token: adminToken });
  if (!Array.isArray(professions) || professions.length < 1) {
    throw new Error('专业目录为空');
  }

  const firstProfession = professions.find((item) => Array.isArray(item.sections) && item.sections.length) || professions[0];
  assertDepartmentStats(firstProfession, '专业');
  if (!Array.isArray(firstProfession.subcategories) || !Array.isArray(firstProfession.sections)) {
    throw new Error('专业目录缺少科室列表');
  }
  if (firstProfession.sections[0]) {
    assertDepartmentStats(firstProfession.sections[0], '专业下属科室');
  }

  const sections = await request(`/api/departments/sections?professionName=${encodeURIComponent(firstProfession.name)}`, {
    token: adminToken,
  });
  if (!Array.isArray(sections)) {
    throw new Error('科室接口返回结构异常');
  }
  if (sections.some((section) => section.parentDepartment?.name !== firstProfession.name)) {
    throw new Error('按专业名称过滤科室异常');
  }
  if (sections[0]) {
    assertDepartmentStats(sections[0], '科室');
  }

  const readonlyProfessions = await request('/api/departments/professions', { token: readonlyToken });
  if (!Array.isArray(readonlyProfessions) || readonlyProfessions.length !== professions.length) {
    throw new Error('只读账号读取专业目录异常');
  }

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'department catalog requires authentication',
      'profession catalog includes sections and content stats',
      'sections can be filtered by profession name',
      'readonly user can read department catalog',
    ],
  }, null, 2));
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
