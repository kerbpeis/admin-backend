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
  form.append('file', new Blob(['audit log verification'], { type: 'text/plain' }), 'audit-log-check.txt');
  form.append('title', '审计日志验证临时资料');
  form.append('versionLabel', 'V1');
  form.append('category', '措施模板');
  form.append('profession', '生产技术');
  form.append('section', '采煤管理室');
  form.append('issuer', '生产技术部');
  form.append('summary', '用于验证审计日志，脚本结束后删除。');

  const data = await request('/api/library-documents', {
    method: 'POST',
    token,
    body: form,
    expectedStatus: 201,
  });
  return data.document;
};

const main = async () => {
  const adminToken = await login(accounts.admin);
  const readonlyToken = await login(accounts.readonly);

  await request('/api/audit-logs', {
    token: readonlyToken,
    expectedStatus: 403,
  });

  const document = await createDocument(adminToken);

  try {
    await request(`/api/library-documents/${document.id}`, { token: adminToken });
    await request(`/api/library-documents/${document.id}`, {
      method: 'PUT',
      token: adminToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '审计日志验证已编辑资料',
        category: '验收清单',
        profession: '生产技术',
        section: '采煤管理室',
        summary: '已完成审计编辑动作。',
      }),
    });
    await request(`/api/library-documents/${document.id}/versions`, { token: adminToken });
    await request(`/api/library-documents/${document.id}/download`, { token: adminToken });
    await request(`/api/library-documents/${document.id}`, {
      method: 'DELETE',
      token: adminToken,
    });

    const logs = await request(`/api/audit-logs?resourceType=library_document&resourceId=${document.id}&limit=50`, {
      token: adminToken,
    });
    const actions = new Set(logs.logs.map((log) => log.action));
    const requiredActions = [
      'library_document.create',
      'library_document.view',
      'library_document.update',
      'library_document.version_list',
      'library_document.download_link',
      'library_document.delete',
    ];

    for (const action of requiredActions) {
      if (!actions.has(action)) {
        throw new Error(`审计日志缺少动作: ${action}`);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      documentId: document.id,
      actions: requiredActions,
      totalLogsForDocument: logs.pagination.total,
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
