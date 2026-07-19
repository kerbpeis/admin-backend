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

const request = async (endpoint, { token, expectedStatus = 200, parse = 'auto', ...options } = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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

const cleanupKnowledgePoint = async (token, knowledgePointId) => {
  if (!knowledgePointId) return;
  await request(`/api/knowledge-points/${knowledgePointId}`, {
    method: 'DELETE',
    token,
    expectedStatus: 200,
  }).catch(() => {});
};

const cleanupFile = async (token, fileId) => {
  if (!fileId) return;
  await request(`/api/files/${fileId}`, {
    method: 'DELETE',
    token,
    expectedStatus: 200,
  }).catch(() => {});
};

const main = async () => {
  const name = `闭环验证临时文件夹-${Date.now()}`;
  const adminToken = await login(accounts.admin);
  const maintainerToken = await login(accounts.maintainer);
  const readonlyToken = await login(accounts.readonly);

  await request('/api/knowledge-points', {
    method: 'POST',
    token: readonlyToken,
    expectedStatus: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '只读账号不应创建文件夹',
      profession: '生产技术',
      section: '采煤管理室',
      visibility: 'department',
    }),
  });

  const created = await request('/api/knowledge-points', {
    method: 'POST',
    token: adminToken,
    expectedStatus: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: '用于验证移动端科室文件夹接入后端，脚本结束后删除。',
      profession: '生产技术',
      section: '采煤管理室',
      category: '设备',
      tags: ['后端', '文件夹', '闭环验证'],
      icon: 'folder-outline',
      visibility: 'department',
    }),
  });

  const knowledgePoint = created.knowledgePoint;
  let uploadedFile = null;

  try {
    assert(knowledgePoint.id, '创建结果缺少知识点 ID');
    assert(knowledgePoint.profession?.name === '生产技术', '中文专业名未正确解析');
    assert(knowledgePoint.department?.name === '采煤管理室', '中文科室名未正确解析');

    const listed = await request(`/api/knowledge-points?search=${encodeURIComponent(name)}&professionId=${encodeURIComponent('生产技术')}&departmentId=${encodeURIComponent('采煤管理室')}&limit=5`, {
      token: adminToken,
    });
    assert(listed.knowledgePoints.some((item) => item.id === knowledgePoint.id), '创建后的文件夹未出现在科室列表');

    const readonlyDetail = await request(`/api/knowledge-points/${knowledgePoint.id}`, { token: readonlyToken });
    assert(readonlyDetail.id === knowledgePoint.id, '同科室只读账号无法查看文件夹');

    await request(`/api/knowledge-points/${knowledgePoint.id}`, {
      method: 'PUT',
      token: readonlyToken,
      expectedStatus: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '只读账号不应编辑文件夹' }),
    });

    await request(`/api/knowledge-points/${knowledgePoint.id}`, {
      method: 'DELETE',
      token: readonlyToken,
      expectedStatus: 403,
    });

    const updatedName = `${name}-已编辑`;
    const updated = await request(`/api/knowledge-points/${knowledgePoint.id}`, {
      method: 'PUT',
      token: maintainerToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: updatedName,
        description: '维护员已完成文件夹编辑验证。',
        category: '工艺',
        tags: ['后端', '文件夹', '编辑'],
        icon: 'sitemap-outline',
        visibility: 'department',
      }),
    });
    assert(updated.knowledgePoint.name === updatedName, '维护员编辑文件夹名称失败');
    assert(updated.knowledgePoint.category === '工艺', '维护员编辑文件夹分类失败');

    await request('/api/files', {
      method: 'POST',
      token: readonlyToken,
      expectedStatus: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledgePointId: knowledgePoint.id,
      }),
    });

    const form = new FormData();
    form.append('file', new Blob(['knowledge file flow verification'], { type: 'text/plain' }), 'knowledge-file-flow.txt');
    form.append('knowledgePointId', knowledgePoint.id);
    form.append('visibility', 'department');
    form.append('tags', '后端,文件,闭环验证');

    const uploadResult = await request('/api/files', {
      method: 'POST',
      token: adminToken,
      body: form,
      expectedStatus: 201,
    });
    uploadedFile = uploadResult.file;
    assert(uploadedFile.id, '上传文件结果缺少文件 ID');
    assert(uploadedFile.knowledgePoint?.id === knowledgePoint.id, '上传文件未关联到知识点');

    const fileList = await request(`/api/files?knowledgePoint=${knowledgePoint.id}&limit=5`, { token: adminToken });
    assert(fileList.files.some((item) => item.id === uploadedFile.id), '上传后的文件未出现在知识点文件列表');

    const readonlyFile = await request(`/api/files/${uploadedFile.id}`, { token: readonlyToken });
    assert(readonlyFile.id === uploadedFile.id, '同科室只读账号无法查看文件');

    const downloadLink = await request(`/api/files/${uploadedFile.id}/download`, { token: readonlyToken });
    const content = await request(downloadLink.downloadUrl, {
      token: readonlyToken,
      parse: 'text',
    });
    assert(content.includes('knowledge file flow verification'), '文件下载内容异常');

    await request(`/api/files/${uploadedFile.id}`, {
      method: 'DELETE',
      token: readonlyToken,
      expectedStatus: 403,
    });

    const renamedFile = await request(`/api/files/${uploadedFile.id}`, {
      method: 'PUT',
      token: maintainerToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'knowledge-file-flow-renamed.txt',
        tags: ['后端', '文件', '编辑'],
        visibility: 'department',
      }),
    });
    assert(renamedFile.file.name === 'knowledge-file-flow-renamed.txt', '维护员重命名文件失败');

    await request(`/api/files/${uploadedFile.id}/versions`, {
      method: 'POST',
      token: readonlyToken,
      expectedStatus: 403,
      body: new FormData(),
    });

    const versionForm = new FormData();
    versionForm.append('file', new Blob(['knowledge file flow verification v2'], { type: 'text/plain' }), 'knowledge-file-flow-v2.txt');
    versionForm.append('versionLabel', 'V2');
    versionForm.append('changeLog', '闭环验证上传文件第二版');

    const versionUpload = await request(`/api/files/${uploadedFile.id}/versions`, {
      method: 'POST',
      token: maintainerToken,
      body: versionForm,
    });
    assert(versionUpload.version?.version === 'V2', '文件新版本上传结果异常');
    assert(versionUpload.file?.name === 'knowledge-file-flow-renamed.txt', '文件新版本上传后未返回最新文件信息');

    const versions = await request(`/api/files/${uploadedFile.id}/versions`, { token: adminToken });
    assert(Array.isArray(versions) && versions.length >= 2, '文件版本记录未包含新旧版本');
    assert(versions[0].version === 'V2', '文件版本记录排序或版本号异常');

    const latestDownloadLink = await request(`/api/files/${uploadedFile.id}/download`, { token: adminToken });
    const latestContent = await request(latestDownloadLink.downloadUrl, {
      token: adminToken,
      parse: 'text',
    });
    assert(latestContent.includes('knowledge file flow verification v2'), '文件下载内容不是最新版本');

    const favoritePoint = await request('/api/favorites', {
      method: 'POST',
      token: readonlyToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'knowledge_point',
        id: knowledgePoint.id,
      }),
    });
    assert(favoritePoint.isFavorited === true, '知识点收藏结果异常');
    assert(favoritePoint.favorite?.knowledgePoint?.id === knowledgePoint.id, '知识点收藏未返回对应资源');

    const repeatedFavoritePoint = await request('/api/favorites', {
      method: 'POST',
      token: readonlyToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sectionGroup',
        id: knowledgePoint.id,
      }),
    });
    assert(repeatedFavoritePoint.isFavorited === true, '知识点重复收藏应保持已收藏状态');

    const favoriteFile = await request('/api/favorites', {
      method: 'POST',
      token: readonlyToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'file',
        id: uploadedFile.id,
      }),
    });
    assert(favoriteFile.isFavorited === true, '文件收藏结果异常');
    assert(favoriteFile.favorite?.file?.id === uploadedFile.id, '文件收藏未返回对应资源');

    const favoritedPointDetail = await request(`/api/knowledge-points/${knowledgePoint.id}`, { token: readonlyToken });
    assert(favoritedPointDetail.isFavorited === true, '知识点详情未返回已收藏状态');
    assert(
      favoritedPointDetail.files.some((item) => item.id === uploadedFile.id && item.isFavorited === true),
      '知识点详情中的文件未返回已收藏状态'
    );

    const favoritedFileDetail = await request(`/api/files/${uploadedFile.id}`, { token: readonlyToken });
    assert(favoritedFileDetail.isFavorited === true, '文件详情未返回已收藏状态');

    const favoritedPointList = await request(`/api/knowledge-points?search=${encodeURIComponent(updatedName)}&limit=5`, { token: readonlyToken });
    assert(
      favoritedPointList.knowledgePoints.some((item) => item.id === knowledgePoint.id && item.isFavorited === true),
      '知识点列表未返回已收藏状态'
    );

    const favoritedFileList = await request(`/api/files?knowledgePoint=${knowledgePoint.id}&limit=5`, { token: readonlyToken });
    assert(
      favoritedFileList.files.some((item) => item.id === uploadedFile.id && item.isFavorited === true),
      '文件列表未返回已收藏状态'
    );

    const favorites = await request('/api/favorites?type=all&limit=20', { token: readonlyToken });
    assert(
      favorites.favorites.some((item) => item.type === 'knowledge_point' && item.itemId === knowledgePoint.id),
      '收藏列表未包含知识点'
    );
    assert(
      favorites.favorites.some((item) => item.type === 'file' && item.itemId === uploadedFile.id),
      '收藏列表未包含文件'
    );

    await request(`/api/favorites/file/${uploadedFile.id}`, {
      method: 'DELETE',
      token: readonlyToken,
    });
    await request(`/api/favorites/knowledge_point/${knowledgePoint.id}`, {
      method: 'DELETE',
      token: readonlyToken,
    });

    const unfavoritedPointDetail = await request(`/api/knowledge-points/${knowledgePoint.id}`, { token: readonlyToken });
    assert(unfavoritedPointDetail.isFavorited === false, '取消收藏后知识点详情状态异常');
    assert(
      unfavoritedPointDetail.files.some((item) => item.id === uploadedFile.id && item.isFavorited === false),
      '取消收藏后知识点详情中的文件状态异常'
    );

    const unfavoritedPointList = await request(`/api/knowledge-points?search=${encodeURIComponent(updatedName)}&limit=5`, { token: readonlyToken });
    assert(
      unfavoritedPointList.knowledgePoints.some((item) => item.id === knowledgePoint.id && item.isFavorited === false),
      '取消收藏后知识点列表状态异常'
    );

    const favoritesAfterDelete = await request('/api/favorites?type=all&limit=20', { token: readonlyToken });
    assert(
      !favoritesAfterDelete.favorites.some((item) => item.itemId === uploadedFile.id || item.itemId === knowledgePoint.id),
      '取消收藏后列表仍包含临时资源'
    );

    await request(`/api/files/${uploadedFile.id}`, {
      method: 'DELETE',
      token: maintainerToken,
    });
    await request(`/api/files/${uploadedFile.id}`, {
      token: adminToken,
      expectedStatus: 404,
    });
    uploadedFile = null;

    await request(`/api/knowledge-points/${knowledgePoint.id}`, {
      method: 'DELETE',
      token: maintainerToken,
    });

    await request(`/api/knowledge-points/${knowledgePoint.id}`, {
      token: adminToken,
      expectedStatus: 404,
    });

    console.log(JSON.stringify({
      ok: true,
      knowledgePointId: knowledgePoint.id,
      checked: [
        'readonly create/update/delete blocked',
        'create with Chinese profession and section names',
        'section list filtering',
        'readonly scoped detail read',
        'maintainer scoped update/delete',
        'file upload/list/download/update/delete',
        'file version upload/list/latest download',
        'favorite add/list/delete for knowledge point and file',
        'favorite state in knowledge point and file list/detail',
      ],
    }, null, 2));
  } catch (error) {
    await cleanupFile(adminToken, uploadedFile?.id);
    await cleanupKnowledgePoint(adminToken, knowledgePoint.id);
    throw error;
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
