require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const accounts = {
  admin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  },
  maintainer: {
    email: process.env.SEED_MAINTAINER_EMAIL || 'maintainer@example.com',
    password: process.env.SEED_MAINTAINER_PASSWORD || 'maintainer123',
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
    expectedStatus: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return data.token;
};

const createDocument = async (token) => {
  const form = new FormData();
  form.append('file', new Blob(['library permission verification'], { type: 'text/plain' }), 'library-permission-check.txt');
  form.append('title', '权限验证临时资料');
  form.append('versionLabel', 'V1');
  form.append('category', '措施模板');
  form.append('profession', '生产技术');
  form.append('section', '采煤管理室');
  form.append('issuer', '生产技术部');
  form.append('summary', '用于验证资料库后端权限，脚本结束后删除。');
  form.append('tags', '权限,验证');

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
  const maintainerToken = await login(accounts.maintainer);
  const readonlyToken = await login(accounts.readonly);

  const adminAccess = await request('/api/library-documents/access/me', { token: adminToken });
  const readonlyAccess = await request('/api/library-documents/access/me', { token: readonlyToken });
  if (!adminAccess.capabilities.canCreate || !adminAccess.capabilities.canDelete) {
    throw new Error('管理员资料库能力异常');
  }
  if (readonlyAccess.capabilities.canCreate || readonlyAccess.capabilities.canUpdate || readonlyAccess.capabilities.canDelete) {
    throw new Error('只读用户不应具备写入资料库能力');
  }

  const document = await createDocument(adminToken);

  try {
    const readonlyDetail = await request(`/api/library-documents/${document.id}`, { token: readonlyToken });
    if (readonlyDetail.canManage || readonlyDetail.capabilities.canUpdate || readonlyDetail.capabilities.canDelete) {
      throw new Error('只读用户不应获得资料管理能力');
    }

    await request(`/api/library-documents/${document.id}`, {
      method: 'PUT',
      token: readonlyToken,
      expectedStatus: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '只读用户尝试修改' }),
    });

    const maintainerDetail = await request(`/api/library-documents/${document.id}`, { token: maintainerToken });
    if (!maintainerDetail.canManage || !maintainerDetail.capabilities.canUpdate || !maintainerDetail.capabilities.canDelete) {
      throw new Error('资料维护员应具备本科室资料管理能力');
    }

    const capabilities = await request(`/api/library-documents/${document.id}/capabilities`, { token: maintainerToken });
    if (!capabilities.capabilities.allowedActions.includes('update')) {
      throw new Error('资料能力接口未返回 update 动作');
    }

    const updated = await request(`/api/library-documents/${document.id}`, {
      method: 'PUT',
      token: maintainerToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '权限验证已编辑资料',
        category: '验收清单',
        profession: '生产技术',
        section: '采煤管理室',
        tags: ['权限', '验证', '编辑'],
        summary: '资料维护员已完成编辑验证。',
      }),
    });
    if (updated.document.title !== '权限验证已编辑资料' || updated.document.category !== '验收清单') {
      throw new Error('资料维护员编辑结果异常');
    }

    await request(`/api/library-documents/${document.id}`, {
      method: 'DELETE',
      token: maintainerToken,
    });

    await request(`/api/library-documents/${document.id}`, {
      token: adminToken,
      expectedStatus: 404,
    });

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'library access capabilities',
        'document capabilities in list/detail payloads',
        'readonly user read-only enforcement',
        'maintainer scoped update/delete',
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
