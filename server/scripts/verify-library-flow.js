require('dotenv').config();
const { pool, query } = require('../config/db');

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

const request = async (endpoint, { token, expectedStatus = 200, parse = 'auto', ...options } = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (parse === 'text') {
    data = await response.text();
  } else if (parse === 'buffer') {
    data = Buffer.from(await response.arrayBuffer());
  } else {
    data = contentType.includes('application/json') ? await response.json() : await response.text();
  }

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

const createDocument = async (token, title) => {
  const form = new FormData();
  form.append('file', new Blob(['library flow verification v1'], { type: 'text/plain' }), 'library-flow-v1.txt');
  form.append('title', title);
  form.append('versionLabel', 'V1');
  form.append('category', '措施模板');
  form.append('profession', '生产技术');
  form.append('section', '采煤管理室');
  form.append('issuer', '生产技术部');
  form.append('approver', '安全监管部');
  form.append('effectiveDate', '2026-07-16');
  form.append('reviewDate', '2026-12-31');
  form.append('summary', '用于验证资料库真实闭环，脚本结束后删除。');
  form.append('tags', '闭环,验证,资料库');

  const data = await request('/api/library-documents', {
    method: 'POST',
    token,
    body: form,
    expectedStatus: 201,
  });

  return data.document;
};

const uploadVersion = async (token, documentId) => {
  const form = new FormData();
  form.append('file', new Blob(['library flow verification v2'], { type: 'text/plain' }), 'library-flow-v2.txt');
  form.append('versionLabel', 'V2');
  form.append('note', '闭环验证上传第二版');

  const data = await request(`/api/library-documents/${documentId}/versions`, {
    method: 'POST',
    token,
    body: form,
  });

  return data;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const cleanupDocument = async (token, documentId) => {
  if (!documentId) return;
  await request(`/api/library-documents/${documentId}`, {
    method: 'DELETE',
    token,
    expectedStatus: 200,
  }).catch(() => {});
};

const cleanupAuditLogs = async (documentId) => {
  const params = ['闭环验证临时资料-%'];
  let sql = 'DELETE FROM audit_logs WHERE resource_name LIKE ?';
  if (documentId) {
    sql += " OR (resource_type = 'library_document' AND resource_id = ?)";
    params.push(String(documentId));
  }
  await query(sql, params).catch(() => {});
};

const main = async () => {
  const title = `闭环验证临时资料-${Date.now()}`;
  const adminToken = await login(accounts.admin);
  const maintainerToken = await login(accounts.maintainer);
  const readonlyToken = await login(accounts.readonly);

  const [adminAccess, maintainerAccess, readonlyAccess] = await Promise.all([
    request('/api/library-documents/access/me', { token: adminToken }),
    request('/api/library-documents/access/me', { token: maintainerToken }),
    request('/api/library-documents/access/me', { token: readonlyToken }),
  ]);

  assert(adminAccess.capabilities.canCreate && adminAccess.capabilities.canDelete, '管理员资料库能力异常');
  assert(maintainerAccess.capabilities.canCreate && maintainerAccess.capabilities.canUpdate, '维护员资料库能力异常');
  assert(!readonlyAccess.capabilities.canCreate && !readonlyAccess.capabilities.canUpdate, '只读账号不应具备写入能力');

  const readonlyCreateForm = new FormData();
  readonlyCreateForm.append('file', new Blob(['readonly blocked'], { type: 'text/plain' }), 'readonly-blocked.txt');
  readonlyCreateForm.append('title', '只读账号不应创建');
  await request('/api/library-documents', {
    method: 'POST',
    token: readonlyToken,
    body: readonlyCreateForm,
    expectedStatus: 403,
  });

  let document = await createDocument(adminToken, title);

  try {
    const listed = await request(`/api/library-documents?search=${encodeURIComponent(title)}&limit=5`, { token: adminToken });
    assert(listed.documents.some((item) => item.id === document.id), '创建后的资料未出现在检索列表');

    const readonlyDetail = await request(`/api/library-documents/${document.id}`, { token: readonlyToken });
    assert(readonlyDetail.id === document.id, '只读账号无法查看权限内资料');
    assert(!readonlyDetail.canManage && !readonlyDetail.capabilities.canUpdate, '只读账号不应显示管理能力');

    await request(`/api/library-documents/${document.id}`, {
      method: 'PUT',
      token: readonlyToken,
      expectedStatus: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '只读账号不应编辑' }),
    });

    await request(`/api/library-documents/${document.id}/versions`, {
      method: 'POST',
      token: readonlyToken,
      expectedStatus: 403,
      body: new FormData(),
    });

    const updated = await request(`/api/library-documents/${document.id}`, {
      method: 'PUT',
      token: maintainerToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${title}-已编辑`,
        category: '验收清单',
        profession: '生产技术',
        section: '采煤管理室',
        tags: ['闭环', '验证', '编辑'],
        summary: '维护员已完成资料信息编辑。',
      }),
    });
    assert(updated.document.title === `${title}-已编辑`, '维护员编辑资料标题失败');
    assert(updated.document.category === '验收清单', '维护员编辑资料类型失败');

    const versionUpload = await uploadVersion(maintainerToken, document.id);
    assert(versionUpload.version.version === 'V2', '新版本上传结果异常');
    assert(versionUpload.document.version === 'V2', '资料当前版本未切换到 V2');

    const versions = await request(`/api/library-documents/${document.id}/versions`, { token: adminToken });
    assert(versions.versions.length >= 2, '版本记录未包含新旧版本');
    assert(versions.versions[0].version === 'V2', '版本记录排序或版本号异常');

    const downloadLink = await request(`/api/library-documents/${document.id}/download`, { token: adminToken });
    assert(downloadLink.downloadUrl && downloadLink.file?.name === 'library-flow-v2.txt', '下载地址或文件信息异常');

    const content = await request(downloadLink.downloadUrl, {
      token: adminToken,
      parse: 'text',
    });
    assert(content.includes('library flow verification v2'), '下载内容不是最新版本文件');

    const stats = await request(`/api/library-documents/stats/overview?search=${encodeURIComponent(title)}&activityLimit=10`, {
      token: adminToken,
    });
    assert(stats.summary.totalDocuments === 1, '闭环资料统计过滤结果异常');
    assert(stats.recentDocuments[0]?.id === document.id, '统计最近资料未返回闭环资料');

    await request(`/api/library-documents/${document.id}`, {
      method: 'DELETE',
      token: maintainerToken,
    });

    await request(`/api/library-documents/${document.id}`, {
      token: adminToken,
      expectedStatus: 404,
    });

    const logs = await request(`/api/audit-logs?resourceType=library_document&resourceId=${document.id}&limit=50`, {
      token: adminToken,
    });
    const actions = new Set(logs.logs.map((log) => log.action));
    const requiredActions = [
      'library_document.create',
      'library_document.view',
      'library_document.update',
      'library_document.version_upload',
      'library_document.version_list',
      'library_document.download_link',
      'library_document.download_content',
      'library_document.delete',
    ];

    for (const action of requiredActions) {
      assert(actions.has(action), `审计日志缺少动作: ${action}`);
    }

    console.log(JSON.stringify({
      ok: true,
      documentId: document.id,
      checked: [
        'role access capabilities',
        'readonly create/update/version blocked',
        'create/search/detail',
        'maintainer update and version upload',
        'version list and latest download content',
        'stats filtering',
        'delete and audit logs',
      ],
      auditActions: requiredActions,
    }, null, 2));
  } catch (error) {
    await cleanupDocument(adminToken, document?.id);
    throw error;
  } finally {
    await cleanupAuditLogs(document?.id);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end().catch(() => {}));
