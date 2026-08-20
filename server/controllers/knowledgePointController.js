const { query } = require('../config/db');
const { serializeFile, serializeKnowledgePoint, stringifyTags, toId, placeholders, firstPresent, parsePageAndLimit } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');
const {
  buildCompanyFilter,
  buildVisibilityFilter,
  canReadScopedResource,
  canManageScopedResource,
  ensureWritableVisibility,
  getScopedCompanyId,
  resolveDepartmentIds,
  resolveWritableTarget,
} = require('../utils/resourceAccess');

const baseKnowledgePointSelect = `
  SELECT kp.*,
    d.name AS department_name, d.type AS department_type, dp.name AS department_parent_name,
    p.name AS profession_name, p.type AS profession_type,
    u.name AS created_by_name, u.email AS created_by_email, u.department AS created_by_department, u.section AS created_by_section
  FROM knowledge_points kp
  LEFT JOIN departments d ON d.id = kp.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = kp.profession_id
  LEFT JOIN users u ON u.id = kp.created_by
`;

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

const getKnowledgePointRow = async (id) => {
  const rows = await query(`${baseKnowledgePointSelect} WHERE kp.id = ? AND kp.status = 'active'`, [toId(id)]);
  return rows[0] || null;
};

const getFavoriteKnowledgePointIdSet = async (user, pointIds = []) => {
  const ids = Array.from(new Set(pointIds.map(toId).filter(Boolean)));
  if (!ids.length || !user?.id) return new Set();

  const rows = await query(
    `SELECT knowledge_point_id FROM knowledge_point_favorites WHERE user_id = ? AND knowledge_point_id IN (${placeholders(ids)})`,
    [toId(user.id), ...ids]
  );
  return new Set(rows.map((row) => String(row.knowledge_point_id)));
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

const serializeKnowledgePointsForUser = async (user, rows = []) => {
  const favoriteIds = await getFavoriteKnowledgePointIdSet(user, rows.map((row) => row.id));
  return rows.map((row) => serializeKnowledgePoint(row, {
    isFavorited: favoriteIds.has(String(row.id)),
  }));
};

const serializeKnowledgePointForUser = async (user, row, extras = {}) => {
  if (!row) return null;
  const favoriteIds = await getFavoriteKnowledgePointIdSet(user, [row.id]);
  return serializeKnowledgePoint(row, {
    isFavorited: favoriteIds.has(String(row.id)),
    ...extras,
  });
};

const serializeFilesForUser = async (user, rows = []) => {
  const favoriteIds = await getFavoriteFileIdSet(user, rows.map((row) => row.id));
  return rows.map((row) => serializeFile(row, {
    isFavorited: favoriteIds.has(String(row.id)),
  }));
};

const firstFilled = (source, keys, fallback = null) => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
};

const hasTargetOverride = (source = {}) => (
  ['departmentId', 'sectionId', 'department', 'section', 'professionId', 'profession']
    .some((key) => Object.prototype.hasOwnProperty.call(source, key))
);

const resolveWritableTargetFromBody = async (user, body, fallback = {}) => {
  const sectionValue = firstFilled(
    body,
    ['departmentId', 'sectionId', 'department', 'section'],
    fallback.departmentId
  );
  const professionValue = firstFilled(
    body,
    ['professionId', 'profession'],
    fallback.professionId
  );
  const requestedCompanyId = firstFilled(body, ['companyId'], fallback.companyId);
  const companyId = getScopedCompanyId(user, requestedCompanyId);
  const sectionIds = sectionValue ? await resolveDepartmentIds(sectionValue, null, companyId) : [];
  const professionIds = professionValue ? await resolveDepartmentIds(professionValue, 'profession', companyId) : [];

  return resolveWritableTarget(user, {
    departmentId: sectionIds[0] || toId(sectionValue) || null,
    professionId: professionIds[0] || toId(professionValue) || null,
    companyId,
  });
};

exports.getKnowledgePoints = async (req, res) => {
  try {
    const {
      departmentId,
      professionId,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = req.query;
    const { page, limit } = parsePageAndLimit(req.query, 20, 100);

    const filters = [`kp.status = 'active'`];
    const params = [];

    const companyFilter = buildCompanyFilter(req.user, 'kp', { requestedCompanyId: req.query.companyId });
    filters.push(companyFilter.sql);
    params.push(...companyFilter.params);

    const visibilityFilter = await buildVisibilityFilter(req.user, 'kp', 'created_by');
    filters.push(visibilityFilter.sql);
    params.push(...visibilityFilter.params);
    const companyId = getScopedCompanyId(req.user, req.query.companyId);

    if (departmentId) {
      const ids = await resolveDepartmentIds(departmentId, null, companyId);
      filters.push(`kp.department_id IN (${placeholders(ids.length ? ids : [0])})`);
      params.push(...(ids.length ? ids : [0]));
    }

    if (professionId) {
      const ids = await resolveDepartmentIds(professionId, 'profession', companyId);
      filters.push(`kp.profession_id IN (${placeholders(ids.length ? ids : [0])})`);
      params.push(...(ids.length ? ids : [0]));
    }

    if (search) {
      filters.push('(kp.name LIKE ? OR kp.description LIKE ? OR kp.category LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const sortable = {
      createdAt: 'kp.created_at',
      created_at: 'kp.created_at',
      updatedAt: 'kp.updated_at',
      name: 'kp.name',
      viewCount: 'kp.view_count',
    };
    const sortColumn = sortable[sortBy] || 'kp.created_at';
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const where = `WHERE ${filters.join(' AND ')}`;
    const offset = (page - 1) * limit;
    const countRows = await query(`SELECT COUNT(*) AS total FROM knowledge_points kp ${where}`, params);
    const total = countRows[0].total;

    const rows = await query(
      `${baseKnowledgePointSelect}
       ${where}
       ORDER BY ${sortColumn} ${direction}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      knowledgePoints: await serializeKnowledgePointsForUser(req.user, rows),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '获取知识点列表失败');
  }
};

exports.getKnowledgePoint = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const knowledgePoint = await getKnowledgePointRow(id);
    if (!knowledgePoint) {
      return res.status(404).json({ message: '知识点不存在' });
    }

    if (!canReadScopedResource(req.user, knowledgePoint, 'created_by')) {
      return res.status(403).json({ message: '没有权限查看此知识点' });
    }

    const fileCompanyFilter = buildCompanyFilter(req.user, 'f');
    const fileVisibilityFilter = await buildVisibilityFilter(req.user, 'f', 'uploaded_by');
    await query('UPDATE knowledge_points SET view_count = view_count + 1 WHERE id = ?', [id]);
    const files = await query(
      `${baseFileSelect}
       WHERE f.knowledge_point_id = ? AND f.status = 'active' AND ${fileCompanyFilter.sql} AND ${fileVisibilityFilter.sql}
       ORDER BY f.created_at DESC`,
      [id, ...fileCompanyFilter.params, ...fileVisibilityFilter.params]
    );

    const serializedFiles = await serializeFilesForUser(req.user, files);
    res.json(await serializeKnowledgePointForUser(
      req.user,
      { ...knowledgePoint, view_count: knowledgePoint.view_count + 1 },
      { files: serializedFiles }
    ));
  } catch (err) {
    sendServerError(res, err, '获取知识点详情失败');
  }
};

exports.createKnowledgePoint = async (req, res) => {
  try {
    const {
      name,
      description = '',
      category = '',
      tags,
      visibility = 'department',
      icon = 'book-open-variant',
    } = req.body;

    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ message: '请输入知识点名称' });
    }
    if (String(name).length > 200) {
      return res.status(400).json({ message: '知识点名称不能超过 200 个字符', field: 'name' });
    }
    if (description && String(description).length > 5000) {
      return res.status(400).json({ message: '描述不能超过 5000 个字符', field: 'description' });
    }
    if (category && String(category).length > 100) {
      return res.status(400).json({ message: '分类不能超过 100 个字符', field: 'category' });
    }
    if (icon && String(icon).length > 80) {
      return res.status(400).json({ message: '图标标识不能超过 80 个字符', field: 'icon' });
    }

    const visibilityCheck = ensureWritableVisibility(req.user, visibility);
    if (!visibilityCheck.ok) {
      return res.status(403).json({ message: visibilityCheck.message });
    }

    const target = await resolveWritableTargetFromBody(req.user, req.body);
    if (!target.ok) {
      return res.status(403).json({ message: target.message });
    }

    const result = await query(
      `INSERT INTO knowledge_points
       (company_id, name, description, department_id, profession_id, category, tags, visibility, icon, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        target.companyId,
        name,
        description,
        target.departmentId,
        target.professionId,
        category,
        stringifyTags(tags),
        visibilityCheck.visibility,
        icon,
        toId(req.user.id),
      ]
    );

    res.status(201).json({
      message: '知识点创建成功',
      knowledgePoint: await serializeKnowledgePointForUser(req.user, await getKnowledgePointRow(result.insertId)),
    });
  } catch (err) {
    sendServerError(res, err, '创建知识点失败');
  }
};

exports.updateKnowledgePoint = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const knowledgePoint = await getKnowledgePointRow(id);
    if (!knowledgePoint) {
      return res.status(404).json({ message: '知识点不存在' });
    }

    if (!canManageScopedResource(req.user, knowledgePoint, 'created_by')) {
      return res.status(403).json({ message: '没有权限编辑此知识点' });
    }

    const { name, tags, visibility, icon } = req.body;
    if (name !== undefined && String(name).trim().length === 0) {
      return res.status(400).json({ message: '知识点名称不能为空', field: 'name' });
    }
    if (name && String(name).length > 200) {
      return res.status(400).json({ message: '知识点名称不能超过 200 个字符', field: 'name' });
    }
    // 未传 description/category 时保持原值，避免被默认空串清空
    const description = firstPresent(req.body, ['description'], knowledgePoint.description);
    const category = firstPresent(req.body, ['category'], knowledgePoint.category);
    if (description && String(description).length > 5000) {
      return res.status(400).json({ message: '描述不能超过 5000 个字符', field: 'description' });
    }
    if (category && String(category).length > 100) {
      return res.status(400).json({ message: '分类不能超过 100 个字符', field: 'category' });
    }
    if (icon && String(icon).length > 80) {
      return res.status(400).json({ message: '图标标识不能超过 80 个字符', field: 'icon' });
    }
    const visibilityCheck = ensureWritableVisibility(req.user, visibility || knowledgePoint.visibility);
    if (!visibilityCheck.ok) {
      return res.status(403).json({ message: visibilityCheck.message });
    }

    let target = {
      ok: true,
      departmentId: knowledgePoint.department_id,
      professionId: knowledgePoint.profession_id,
    };
    if (hasTargetOverride(req.body)) {
      target = await resolveWritableTargetFromBody(req.user, req.body, {
        departmentId: knowledgePoint.department_id,
        professionId: knowledgePoint.profession_id,
      });
      if (!target.ok) {
        return res.status(403).json({ message: target.message });
      }
    }

    await query(
      `UPDATE knowledge_points
       SET name = ?, description = ?, department_id = ?, profession_id = ?, category = ?, tags = ?, visibility = ?, icon = ?
       WHERE id = ?`,
      [
        name || knowledgePoint.name,
        description,
        target.departmentId,
        target.professionId,
        category,
        stringifyTags(tags) ?? knowledgePoint.tags,
        visibilityCheck.visibility,
        icon || knowledgePoint.icon,
        id,
      ]
    );

    res.json({
      message: '知识点更新成功',
      knowledgePoint: await serializeKnowledgePointForUser(req.user, await getKnowledgePointRow(id)),
    });
  } catch (err) {
    sendServerError(res, err, '更新知识点失败');
  }
};

exports.deleteKnowledgePoint = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const knowledgePoint = await getKnowledgePointRow(id);
    if (!knowledgePoint) {
      return res.status(404).json({ message: '知识点不存在' });
    }

    if (!canManageScopedResource(req.user, knowledgePoint, 'created_by')) {
      return res.status(403).json({ message: '没有权限删除此知识点' });
    }

    await query(`UPDATE knowledge_points SET status = 'deleted' WHERE id = ?`, [id]);
    res.json({ message: '知识点删除成功' });
  } catch (err) {
    sendServerError(res, err, '删除知识点失败');
  }
};

exports.toggleFavorite = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const knowledgePoint = await getKnowledgePointRow(id);
    if (!knowledgePoint) {
      return res.status(404).json({ message: '知识点不存在' });
    }

    if (!canReadScopedResource(req.user, knowledgePoint, 'created_by')) {
      return res.status(403).json({ message: '没有权限收藏此知识点' });
    }

    const rows = await query(
      'SELECT * FROM knowledge_point_favorites WHERE knowledge_point_id = ? AND user_id = ?',
      [id, toId(req.user.id)]
    );
    const isFavorited = Boolean(rows[0]);

    if (isFavorited) {
      await query('DELETE FROM knowledge_point_favorites WHERE knowledge_point_id = ? AND user_id = ?', [id, toId(req.user.id)]);
    } else {
      await query('INSERT INTO knowledge_point_favorites (knowledge_point_id, user_id) VALUES (?, ?)', [id, toId(req.user.id)]);
    }

    res.json({
      message: isFavorited ? '已取消收藏' : '已添加收藏',
      isFavorited: !isFavorited,
    });
  } catch (err) {
    sendServerError(res, err, '收藏操作失败');
  }
};
