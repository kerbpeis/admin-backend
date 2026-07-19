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

const createDocument = async (token) => {
  const form = new FormData();
  form.append('file', new Blob(['library stats verification'], { type: 'text/plain' }), 'library-stats-check.txt');
  form.append('title', '统计验证临时资料');
  form.append('versionLabel', 'V1');
  form.append('category', '措施模板');
  form.append('profession', '生产技术');
  form.append('section', '采煤管理室');
  form.append('issuer', '生产技术部');
  form.append('summary', '用于验证资料库统计接口，脚本结束后删除。');

  const data = await request('/api/library-documents', {
    method: 'POST',
    token,
    body: form,
    expectedStatus: 201,
  });
  return data.document;
};

const assertStatsShape = (stats) => {
  if (!stats.summary || !stats.distributions || !Array.isArray(stats.recentDocuments) || !Array.isArray(stats.recentActivities)) {
    throw new Error('统计接口返回结构不完整');
  }
  if (!Array.isArray(stats.distributions.byCategory) || !Array.isArray(stats.distributions.byProfession) || !Array.isArray(stats.distributions.bySection)) {
    throw new Error('统计分布结构不完整');
  }
};

const main = async () => {
  const adminToken = await login(accounts.admin);
  const readonlyToken = await login(accounts.readonly);

  await request('/api/library-documents/stats/overview', { expectedStatus: 401 });

  const adminStats = await request('/api/library-documents/stats/overview', { token: adminToken });
  assertStatsShape(adminStats);
  if (adminStats.summary.totalDocuments < 5 || !adminStats.capabilities.canCreate) {
    throw new Error('管理员统计或能力异常');
  }

  const readonlyStats = await request('/api/library-documents/stats/overview', { token: readonlyToken });
  assertStatsShape(readonlyStats);
  if (readonlyStats.capabilities.canCreate || readonlyStats.capabilities.canUpdate || readonlyStats.summary.manageableDocuments !== 0) {
    throw new Error('只读用户统计能力异常');
  }

  const document = await createDocument(adminToken);
  try {
    await request(`/api/library-documents/${document.id}`, { token: adminToken });
    const focusedStats = await request(`/api/library-documents/stats/overview?search=${encodeURIComponent(document.title)}&recentLimit=3&activityLimit=5`, {
      token: adminToken,
    });
    assertStatsShape(focusedStats);
    if (focusedStats.summary.totalDocuments !== 1 || focusedStats.recentDocuments[0]?.id !== document.id) {
      throw new Error('按关键词过滤后的资料统计异常');
    }
    if (!focusedStats.recentActivities.some((activity) => activity.resourceId === document.id)) {
      throw new Error('统计接口未返回临时资料的最近操作');
    }

    await request(`/api/library-documents/${document.id}`, {
      method: 'DELETE',
      token: adminToken,
    });

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'admin scoped library stats',
        'readonly scoped library stats',
        'keyword-filtered stats',
        'recent documents and activities',
      ],
    }, null, 2));
  } catch (error) {
    await request(`/api/library-documents/${document.id}`, {
      method: 'DELETE',
      token: adminToken,
      expectedStatus: 200,
    }).catch(() => {});
    throw error;
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
