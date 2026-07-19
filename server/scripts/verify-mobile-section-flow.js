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

const request = async (endpoint, { token, expectedStatus = 200, parse = 'auto', ...options } = {}) => {
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const data = parse === 'text'
    ? await response.text()
    : contentType.includes('application/json') ? await response.json() : await response.text();

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

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const cleanupFile = async (token, id) => {
  if (!id) return;
  await request(`/api/files/${id}`, { method: 'DELETE', token }).catch(() => {});
};

const cleanupKnowledgePoint = async (token, id) => {
  if (!id) return;
  await request(`/api/knowledge-points/${id}`, { method: 'DELETE', token }).catch(() => {});
};

const uploadTextFile = async (token, knowledgePointId, name, content, tags = []) => {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), name);
  form.append('knowledgePointId', knowledgePointId);
  form.append('visibility', 'department');
  if (tags.length) form.append('tags', tags.join(','));

  const result = await request('/api/files', {
    method: 'POST',
    token,
    body: form,
    expectedStatus: 201,
  });

  return result.file;
};

const main = async () => {
  const stamp = Date.now();
  const searchToken = `移动端科室导入-${stamp}`;
  const groupName = `移动端QA导入文件夹-${stamp}`;
  const adminToken = await login(accounts.admin);
  const readonlyToken = await login(accounts.readonly);
  let knowledgePoint = null;
  const uploadedFiles = [];

  try {
    const created = await request('/api/knowledge-points', {
      method: 'POST',
      token: adminToken,
      expectedStatus: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: groupName,
        description: '验证移动端科室页导入文件夹、文件索引搜索和详情打开所需后端数据。',
        profession: '生产技术',
        section: '采煤管理室',
        category: '导入资料',
        tags: ['移动端', '导入', 'QA'],
        icon: 'folder-upload-outline',
        visibility: 'department',
      }),
    });
    knowledgePoint = created.knowledgePoint;
    assert(knowledgePoint?.id, '移动端导入验证：创建资料夹失败');

    const firstFile = await uploadTextFile(
      adminToken,
      knowledgePoint.id,
      `${searchToken}-安全确认.txt`,
      `mobile section import search token: ${searchToken}`,
      ['移动端', '文件搜索']
    );
    uploadedFiles.push(firstFile);

    const secondFile = await uploadTextFile(
      adminToken,
      knowledgePoint.id,
      `${searchToken}-班前交底.txt`,
      `mobile section import second file: ${searchToken}`,
      ['移动端', '批量导入']
    );
    uploadedFiles.push(secondFile);

    assert(
      uploadedFiles.every((file) => file.knowledgePoint?.id === knowledgePoint.id),
      '移动端导入验证：上传文件没有关联到资料夹'
    );

    const pointDetail = await request(`/api/knowledge-points/${knowledgePoint.id}`, { token: adminToken });
    assert(pointDetail.files?.length === 2, '移动端导入验证：资料夹详情未返回导入文件');

    const scopedFileSearch = await request(
      `/api/files?search=${encodeURIComponent(searchToken)}&profession=${encodeURIComponent('生产技术')}&department=${encodeURIComponent('采煤管理室')}&limit=20`,
      { token: adminToken }
    );
    const foundIds = new Set((scopedFileSearch.files || []).map((file) => file.id));
    assert(uploadedFiles.every((file) => foundIds.has(file.id)), '移动端导入验证：科室文件名搜索未命中上传文件');
    assert(
      scopedFileSearch.files.every((file) => file.knowledgePoint?.id),
      '移动端导入验证：文件搜索结果缺少 knowledgePoint，前端无法映射回资料夹'
    );

    const groupedByPoint = scopedFileSearch.files.reduce((map, file) => {
      const pointId = file.knowledgePoint?.id;
      if (!pointId) return map;
      map[pointId] = map[pointId] || [];
      map[pointId].push(file);
      return map;
    }, {});
    assert(groupedByPoint[knowledgePoint.id]?.length === 2, '移动端导入验证：文件搜索结果无法按资料夹聚合');

    const readonlySearch = await request(
      `/api/files?search=${encodeURIComponent(searchToken)}&profession=${encodeURIComponent('生产技术')}&department=${encodeURIComponent('采煤管理室')}&limit=20`,
      { token: readonlyToken }
    );
    assert(
      (readonlySearch.files || []).some((file) => file.id === firstFile.id),
      '移动端导入验证：同科室只读账号无法搜索到权限内导入文件'
    );

    const downloadLink = await request(`/api/files/${firstFile.id}/download`, { token: readonlyToken });
    const downloadedContent = await request(downloadLink.downloadUrl, {
      token: readonlyToken,
      parse: 'text',
    });
    assert(downloadedContent.includes(searchToken), '移动端导入验证：下载文件内容异常');

    const versionForm = new FormData();
    versionForm.append('file', new Blob([`mobile section version v2: ${searchToken}`], { type: 'text/plain' }), `${searchToken}-新版.txt`);
    versionForm.append('versionLabel', 'V2');
    versionForm.append('changeLog', '移动端详情页上传新版验证');
    const versionUpload = await request(`/api/files/${secondFile.id}/versions`, {
      method: 'POST',
      token: adminToken,
      body: versionForm,
    });
    assert(versionUpload.version?.version === 'V2', '移动端导入验证：上传新版本未返回 V2');

    const versions = await request(`/api/files/${secondFile.id}/versions`, { token: adminToken });
    assert(
      Array.isArray(versions) && versions[0]?.version === 'V2',
      '移动端导入验证：版本历史未返回最新 V2'
    );

    const latestLink = await request(`/api/files/${secondFile.id}/download`, { token: readonlyToken });
    const latestContent = await request(latestLink.downloadUrl, {
      token: readonlyToken,
      parse: 'text',
    });
    assert(latestContent.includes('version v2'), '移动端导入验证：下载未返回最新版本内容');

    const thirdFile = await uploadTextFile(
      adminToken,
      knowledgePoint.id,
      `${searchToken}-批量删除.txt`,
      `mobile section batch delete file: ${searchToken}`,
      ['移动端', '批量删除']
    );
    uploadedFiles.push(thirdFile);

    await Promise.all([firstFile.id, thirdFile.id].map((id) => request(`/api/files/${id}`, {
      method: 'DELETE',
      token: adminToken,
    })));
    const afterDelete = await request(`/api/files?knowledgePoint=${knowledgePoint.id}&limit=20`, { token: adminToken });
    const afterDeleteIds = new Set((afterDelete.files || []).map((file) => file.id));
    assert(
      !afterDeleteIds.has(firstFile.id) && !afterDeleteIds.has(thirdFile.id),
      '移动端导入验证：批量删除后的文件仍出现在资料夹列表'
    );
    assert(
      afterDeleteIds.has(secondFile.id),
      '移动端导入验证：批量删除误删了未选中的文件'
    );

    console.log(JSON.stringify({
      ok: true,
      knowledgePointId: knowledgePoint.id,
      uploadedFileIds: uploadedFiles.map((file) => file.id),
      checked: [
        'mobile section creates remote folder',
        'mobile section uploads multiple files',
        'file search maps results back to knowledge point',
        'readonly scoped file search',
        'download imported file content',
        'upload new version and download latest content',
        'batch delete-style cleanup updates knowledge point file list',
      ],
    }, null, 2));
  } finally {
    for (const file of uploadedFiles) {
      await cleanupFile(adminToken, file.id);
    }
    await cleanupKnowledgePoint(adminToken, knowledgePoint?.id);
  }
};

main().catch((error) => {
  console.error('移动端科室导入流程验证失败:', error);
  process.exit(1);
});
