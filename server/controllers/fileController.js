const { query, withTransaction } = require('../config/db');
const { serializeFile, stringifyTags, toId, placeholders } = require('../utils/mysqlUtils');
const { indexFileContentSafely } = require('../utils/fileContentIndex');
const {
  buildVisibilityFilter,
  canReadScopedResource,
  canManageScopedResource,
  ensureWritableVisibility,
  resolveDepartmentIds,
  resolveWritableTarget,
} = require('../utils/resourceAccess');

const baseFileSelect = `
  SELECT f.*,
    u.name AS uploaded_by_name, u.email AS uploaded_by_email, u.department AS uploaded_by_department, u.section AS uploaded_by_section,
    d.name AS department_name, d.type AS department_type, dp.name AS department_parent_name,
    p.name AS profession_name, p.type AS profession_type,
    kp.name AS knowledge_point_name
  FROM files f
  LEFT JOIN users u ON u.id = f.uploaded_by
  LEFT JOIN departments d ON d.id = f.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = f.profession_id
  LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
`;

const baseKnowledgePointSelect = `
  SELECT kp.*,
    d.name AS department_name, d.type AS department_type, dp.name AS department_parent_name,
    p.name AS profession_name, p.type AS profession_type
  FROM knowledge_points kp
  LEFT JOIN departments d ON d.id = kp.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = kp.profession_id
`;

const getFileRow = async (id) => {
  const rows = await query(`${baseFileSelect} WHERE f.id = ? AND f.status = 'active'`, [toId(id)]);
  return rows[0] || null;
};

const getKnowledgePointRow = async (id) => {
  const knowledgePointId = toId(id);
  if (!knowledgePointId) return null;
  const rows = await query(`${baseKnowledgePointSelect} WHERE kp.id = ? AND kp.status = 'active'`, [knowledgePointId]);
  return rows[0] || null;
};

const getFavoriteFileIdSet = async (user, fileIds = []) => {
  const ids = Array.from(new Set(fileIds.map(toId).filter(Boolean)));
  if (!ids.length || !user?.id) return new Set();

  const rows = await query(
    `SELECT file_id FROM file_favorites WHERE user_id = ? AND file_id IN (${placeholders(ids)})`,
    [toId(user.id), ...ids]
  );
  return new Set(rows.map((row) => String(row.file_id)));
};

const serializeFilesForUser = async (user, rows = []) => {
  const favoriteIds = await getFavoriteFileIdSet(user, rows.map((row) => row.id));
  return rows.map((row) => serializeFile(row, {
    isFavorited: favoriteIds.has(String(row.id)),
  }));
};

const serializeFileForUser = async (user, row, extras = {}) => {
  if (!row) return null;
  const favoriteIds = await getFavoriteFileIdSet(user, [row.id]);
  return serializeFile(row, {
    isFavorited: favoriteIds.has(String(row.id)),
    ...extras,
  });
};

exports.getFiles = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      department,
      profession,
      knowledgePoint,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = req.query;

    const filters = [`f.status = 'active'`];
    const params = [];

    const visibilityFilter = await buildVisibilityFilter(req.user, 'f', 'uploaded_by');
    filters.push(visibilityFilter.sql);
    params.push(...visibilityFilter.params);

    if (department) {
      const ids = await resolveDepartmentIds(department);
      filters.push(`f.department_id IN (${placeholders(ids.length ? ids : [0])})`);
      params.push(...(ids.length ? ids : [0]));
    }

    if (profession) {
      const ids = await resolveDepartmentIds(profession, 'profession');
      filters.push(`f.profession_id IN (${placeholders(ids.length ? ids : [0])})`);
      params.push(...(ids.length ? ids : [0]));
    }

    if (knowledgePoint) {
      filters.push('f.knowledge_point_id = ?');
      params.push(toId(knowledgePoint));
    }

    if (search) {
      filters.push('(f.name LIKE ? OR f.description LIKE ? OR f.tags LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const sortable = {
      createdAt: 'f.created_at',
      created_at: 'f.created_at',
      updatedAt: 'f.updated_at',
      name: 'f.name',
      downloadCount: 'f.download_count',
      viewCount: 'f.view_count',
    };
    const sortColumn = sortable[sortBy] || 'f.created_at';
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const where = `WHERE ${filters.join(' AND ')}`;

    const countRows = await query(`SELECT COUNT(*) AS total FROM files f ${where}`, params);
    const total = countRows[0].total;
    const files = await query(
      `${baseFileSelect}
       ${where}
       ORDER BY ${sortColumn} ${direction}
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), (Number(page) - 1) * Number(limit)]
    );

    res.json({
      files: await serializeFilesForUser(req.user, files),
      pagination: {
        current: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
      },
    });
  } catch (err) {
    console.error('获取文件列表失败:', err);
    res.status(500).json({ message: '获取文件列表失败', error: err.message });
  }
};

exports.getFile = async (req, res) => {
  try {
    const file = await getFileRow(req.params.id);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canReadScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限查看此文件' });
    }

    await query('UPDATE files SET view_count = view_count + 1 WHERE id = ?', [file.id]);
    res.json(await serializeFileForUser(req.user, { ...file, view_count: file.view_count + 1 }));
  } catch (err) {
    res.status(500).json({ message: '获取文件详情失败', error: err.message });
  }
};

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择要上传的文件' });
    }

    const {
      knowledgePointId,
      departmentId,
      professionId,
      description = '',
      tags,
      visibility = 'department',
    } = req.body;

    const visibilityCheck = ensureWritableVisibility(req.user, visibility);
    if (!visibilityCheck.ok) {
      return res.status(403).json({ message: visibilityCheck.message });
    }

    const knowledgePoint = knowledgePointId ? await getKnowledgePointRow(knowledgePointId) : null;
    if (knowledgePointId && !knowledgePoint) {
      return res.status(404).json({ message: '知识点不存在' });
    }

    if (knowledgePoint && !canManageScopedResource(req.user, knowledgePoint, 'created_by')) {
      return res.status(403).json({ message: '没有权限向该知识点上传文件' });
    }

    const target = await resolveWritableTarget(req.user, {
      departmentId: departmentId || knowledgePoint?.department_id,
      professionId: professionId || knowledgePoint?.profession_id,
    });
    if (!target.ok) {
      return res.status(403).json({ message: target.message });
    }

    const insertedId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO files
         (name, original_name, path, size, mime_type, extension, description, knowledge_point_id, department_id, profession_id, uploaded_by, visibility, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.file.originalname,
          req.file.originalname,
          req.file.path,
          req.file.size,
          req.file.mimetype,
          req.file.originalname.split('.').pop().toLowerCase(),
          description,
          knowledgePoint ? toId(knowledgePoint.id) : null,
          target.departmentId,
          target.professionId,
          toId(req.user.id),
          visibilityCheck.visibility,
          stringifyTags(tags),
        ]
      );

      await connection.execute(
        `INSERT INTO file_versions (file_id, version, version_label, path, size, original_name, mime_type, uploaded_by, change_log)
         VALUES (?, 1, 'V1', ?, ?, ?, ?, ?, '初始版本')`,
        [result.insertId, req.file.path, req.file.size, req.file.originalname, req.file.mimetype, toId(req.user.id)]
      );

      if (knowledgePoint) {
        await connection.execute('UPDATE knowledge_points SET file_count = file_count + 1 WHERE id = ?', [toId(knowledgePoint.id)]);
      }

      return result.insertId;
    });

    await indexFileContentSafely(insertedId, req.file.path, req.file.originalname.split('.').pop().toLowerCase());

    const file = await getFileRow(insertedId);
    res.status(201).json({
      message: '文件上传成功',
      file: await serializeFileForUser(req.user, file),
    });
  } catch (err) {
    console.error('文件上传失败:', err);
    res.status(500).json({ message: '文件上传失败', error: err.message });
  }
};

exports.updateFile = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const file = await getFileRow(id);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canManageScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限编辑此文件' });
    }

    const { name, description = '', tags, visibility } = req.body;
    const visibilityCheck = ensureWritableVisibility(req.user, visibility || file.visibility);
    if (!visibilityCheck.ok) {
      return res.status(403).json({ message: visibilityCheck.message });
    }

    await query(
      `UPDATE files
       SET name = ?, description = ?, tags = ?, visibility = ?
       WHERE id = ?`,
      [name || file.name, description, stringifyTags(tags) ?? file.tags, visibilityCheck.visibility, id]
    );

    res.json({
      message: '文件更新成功',
      file: await serializeFileForUser(req.user, await getFileRow(id)),
    });
  } catch (err) {
    res.status(500).json({ message: '更新文件失败', error: err.message });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const file = await getFileRow(id);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canManageScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限删除此文件' });
    }

    await withTransaction(async (connection) => {
      await connection.execute(`UPDATE files SET status = 'deleted' WHERE id = ?`, [id]);
      if (file.knowledge_point_id) {
        await connection.execute('UPDATE knowledge_points SET file_count = GREATEST(file_count - 1, 0) WHERE id = ?', [file.knowledge_point_id]);
      }
    });

    res.json({ message: '文件删除成功' });
  } catch (err) {
    res.status(500).json({ message: '删除文件失败', error: err.message });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const file = await getFileRow(req.params.id);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canReadScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限下载此文件' });
    }

    await query('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [file.id]);

    res.json({
      downloadUrl: `/api/files/${file.id}/download/${encodeURIComponent(file.original_name)}`,
      file: {
        id: String(file.id),
        _id: String(file.id),
        name: file.name,
        size: Number(file.size || 0),
        mimeType: file.mime_type,
      },
    });
  } catch (err) {
    res.status(500).json({ message: '下载文件失败', error: err.message });
  }
};

exports.downloadFileContent = async (req, res) => {
  try {
    const file = await getFileRow(req.params.id);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canReadScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限下载此文件' });
    }

    await query('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [file.id]);
    return res.download(file.path, file.original_name);
  } catch (err) {
    res.status(500).json({ message: '下载文件内容失败', error: err.message });
  }
};

exports.getFileVersions = async (req, res) => {
  try {
    const file = await getFileRow(req.params.id);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canReadScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限查看此文件版本' });
    }

    const versions = await query(
      `SELECT fv.*, u.name AS uploaded_by_name, u.email AS uploaded_by_email
       FROM file_versions fv
       LEFT JOIN users u ON u.id = fv.uploaded_by
       WHERE fv.file_id = ?
       ORDER BY fv.version DESC`,
      [file.id]
    );

    res.json(versions.map((version) => ({
      _id: String(version.id),
      id: String(version.id),
      file: String(version.file_id),
      version: version.version_label || `V${version.version}`,
      versionNumber: version.version,
      path: version.path,
      size: Number(version.size || 0),
      sourceFile: {
        name: version.original_name || file.original_name,
        mimeType: version.mime_type || file.mime_type,
        size: Number(version.size || 0),
      },
      uploadedBy: {
        _id: String(version.uploaded_by),
        id: String(version.uploaded_by),
        name: version.uploaded_by_name,
        email: version.uploaded_by_email,
      },
      changeLog: version.change_log || '',
      hash: version.hash,
      createdAt: version.created_at,
    })));
  } catch (err) {
    res.status(500).json({ message: '获取文件版本失败', error: err.message });
  }
};

exports.uploadNewVersion = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择要上传的文件' });
    }

    const id = toId(req.params.id);
    const file = await getFileRow(id);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canManageScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限上传新版本' });
    }

    const nextVersion = file.current_version + 1;
    const versionLabel = req.body.versionLabel || req.body.version || `V${nextVersion}`;
    const versionId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO file_versions (file_id, version, version_label, path, size, original_name, mime_type, uploaded_by, change_log)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          nextVersion,
          versionLabel,
          req.file.path,
          req.file.size,
          req.file.originalname,
          req.file.mimetype,
          toId(req.user.id),
          req.body.changeLog || `发布 ${versionLabel}`,
        ]
      );

      await connection.execute(
        `UPDATE files
         SET path = ?, size = ?, original_name = ?, mime_type = ?, extension = ?, current_version = ?, version_label = ?
         WHERE id = ?`,
        [
          req.file.path,
          req.file.size,
          req.file.originalname,
          req.file.mimetype,
          req.file.originalname.split('.').pop().toLowerCase(),
          nextVersion,
          versionLabel,
          id,
        ]
      );

      return result.insertId;
    });

    const versions = await query('SELECT * FROM file_versions WHERE id = ?', [versionId]);
    res.json({
      message: '新版本上传成功',
      file: await serializeFileForUser(req.user, await getFileRow(id)),
      version: {
        _id: String(versions[0].id),
        id: String(versions[0].id),
        version: versions[0].version_label || `V${versions[0].version}`,
        versionNumber: versions[0].version,
        path: versions[0].path,
        size: Number(versions[0].size || 0),
        changeLog: versions[0].change_log || '',
        createdAt: versions[0].created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ message: '上传新版本失败', error: err.message });
  }
};

exports.toggleFavorite = async (req, res) => {
  try {
    const fileId = toId(req.params.id);
    const file = await getFileRow(fileId);
    if (!file) {
      return res.status(404).json({ message: '文件不存在' });
    }

    if (!canReadScopedResource(req.user, file, 'uploaded_by')) {
      return res.status(403).json({ message: '没有权限收藏此文件' });
    }

    const rows = await query('SELECT * FROM file_favorites WHERE file_id = ? AND user_id = ?', [fileId, toId(req.user.id)]);
    const isFavorited = Boolean(rows[0]);

    if (isFavorited) {
      await query('DELETE FROM file_favorites WHERE file_id = ? AND user_id = ?', [fileId, toId(req.user.id)]);
    } else {
      await query('INSERT INTO file_favorites (file_id, user_id) VALUES (?, ?)', [fileId, toId(req.user.id)]);
    }

    res.json({
      message: isFavorited ? '已取消收藏' : '已添加收藏',
      isFavorited: !isFavorited,
    });
  } catch (err) {
    res.status(500).json({ message: '收藏操作失败', error: err.message });
  }
};
