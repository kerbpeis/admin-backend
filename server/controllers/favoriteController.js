const { query } = require('../config/db');
const { serializeFile, serializeKnowledgePoint, toId, parsePageAndLimit } = require('../utils/mysqlUtils');
const {
  buildVisibilityFilter,
  canReadScopedResource,
} = require('../utils/resourceAccess');
const { PERMISSIONS, hasPermission } = require('../utils/authorization');
const { sendServerError } = require('../utils/serverError');

const baseFileFavoriteSelect = `
  SELECT f.*, ff.created_at AS favorite_created_at,
    u.name AS uploaded_by_name, u.email AS uploaded_by_email, u.department AS uploaded_by_department, u.section AS uploaded_by_section,
    d.name AS department_name, d.type AS department_type, dp.name AS department_parent_name,
    p.name AS profession_name, p.type AS profession_type,
    kp.name AS knowledge_point_name
  FROM file_favorites ff
  JOIN files f ON f.id = ff.file_id
  LEFT JOIN users u ON u.id = f.uploaded_by
  LEFT JOIN departments d ON d.id = f.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = f.profession_id
  LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
`;

const baseKnowledgePointFavoriteSelect = `
  SELECT kp.*, kpf.created_at AS favorite_created_at,
    d.name AS department_name, d.type AS department_type, dp.name AS department_parent_name,
    p.name AS profession_name, p.type AS profession_type,
    u.name AS created_by_name, u.email AS created_by_email, u.department AS created_by_department, u.section AS created_by_section
  FROM knowledge_point_favorites kpf
  JOIN knowledge_points kp ON kp.id = kpf.knowledge_point_id
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

const normalizeFavoriteType = (type) => {
  if (type === 'all') return 'all';
  if (['file', 'sectionFile'].includes(type)) return 'file';
  if (['knowledge_point', 'knowledgePoint', 'sectionGroup', 'folder'].includes(type)) return 'knowledge_point';
  return null;
};

const canReadFiles = (user) => hasPermission(user, PERMISSIONS.FILE_READ);
const canReadKnowledgePoints = (user) => hasPermission(user, PERMISSIONS.FOLDER_READ);

const serializeFileFavorite = (row) => ({
  id: `file:${row.id}`,
  type: 'file',
  itemId: String(row.id),
  favoriteCreatedAt: row.favorite_created_at,
  file: serializeFile(row, { isFavorited: true }),
});

const serializeKnowledgePointFavorite = (row) => ({
  id: `knowledge_point:${row.id}`,
  type: 'knowledge_point',
  itemId: String(row.id),
  favoriteCreatedAt: row.favorite_created_at,
  knowledgePoint: serializeKnowledgePoint(row, { isFavorited: true }),
});

const getFileRow = async (id) => {
  const rows = await query(`${baseFileSelect} WHERE f.id = ? AND f.status = 'active'`, [toId(id)]);
  return rows[0] || null;
};

const getKnowledgePointRow = async (id) => {
  const rows = await query(`${baseKnowledgePointSelect} WHERE kp.id = ? AND kp.status = 'active'`, [toId(id)]);
  return rows[0] || null;
};

const getFileFavoriteRow = async (user, fileId) => {
  const visibilityFilter = await buildVisibilityFilter(user, 'f', 'uploaded_by');
  const rows = await query(
    `${baseFileFavoriteSelect}
     WHERE ff.user_id = ? AND ff.file_id = ? AND f.status = 'active' AND ${visibilityFilter.sql}`,
    [toId(user.id), toId(fileId), ...visibilityFilter.params]
  );
  return rows[0] || null;
};

const getKnowledgePointFavoriteRow = async (user, knowledgePointId) => {
  const visibilityFilter = await buildVisibilityFilter(user, 'kp', 'created_by');
  const rows = await query(
    `${baseKnowledgePointFavoriteSelect}
     WHERE kpf.user_id = ? AND kpf.knowledge_point_id = ? AND kp.status = 'active' AND ${visibilityFilter.sql}`,
    [toId(user.id), toId(knowledgePointId), ...visibilityFilter.params]
  );
  return rows[0] || null;
};

const listFileFavorites = async (user, limit) => {
  const visibilityFilter = await buildVisibilityFilter(user, 'f', 'uploaded_by');
  const rows = await query(
    `${baseFileFavoriteSelect}
     WHERE ff.user_id = ? AND f.status = 'active' AND ${visibilityFilter.sql}
     ORDER BY ff.created_at DESC
     LIMIT ?`,
    [toId(user.id), ...visibilityFilter.params, limit]
  );
  return rows.map(serializeFileFavorite);
};

const listKnowledgePointFavorites = async (user, limit) => {
  const visibilityFilter = await buildVisibilityFilter(user, 'kp', 'created_by');
  const rows = await query(
    `${baseKnowledgePointFavoriteSelect}
     WHERE kpf.user_id = ? AND kp.status = 'active' AND ${visibilityFilter.sql}
     ORDER BY kpf.created_at DESC
     LIMIT ?`,
    [toId(user.id), ...visibilityFilter.params, limit]
  );
  return rows.map(serializeKnowledgePointFavorite);
};

exports.getFavorites = async (req, res) => {
  try {
    const type = req.query.type ? normalizeFavoriteType(req.query.type) : 'all';
    if (!type || !['all', 'file', 'knowledge_point'].includes(type)) {
      return res.status(400).json({ message: '收藏类型不正确' });
    }

    const { page, limit } = parsePageAndLimit(req.query, 100, 200);
    const offset = (page - 1) * limit;
    const favorites = [];

    if ((type === 'all' || type === 'file') && canReadFiles(req.user)) {
      favorites.push(...await listFileFavorites(req.user, limit + offset));
    } else if (type === 'file') {
      return res.status(403).json({ message: '没有权限查看文件收藏' });
    }

    if ((type === 'all' || type === 'knowledge_point') && canReadKnowledgePoints(req.user)) {
      favorites.push(...await listKnowledgePointFavorites(req.user, limit + offset));
    } else if (type === 'knowledge_point') {
      return res.status(403).json({ message: '没有权限查看文件夹收藏' });
    }

    favorites.sort((a, b) => new Date(b.favoriteCreatedAt || 0).getTime() - new Date(a.favoriteCreatedAt || 0).getTime());

    const total = favorites.length;
    res.json({
      favorites: favorites.slice(offset, offset + limit),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '获取收藏列表失败');
  }
};

exports.addFavorite = async (req, res) => {
  try {
    const type = normalizeFavoriteType(req.body.type);
    const id = toId(req.body.id);
    if (!type || !id) {
      return res.status(400).json({ message: '收藏类型或资源 ID 不正确' });
    }

    if (type === 'file') {
      if (!canReadFiles(req.user)) {
        return res.status(403).json({ message: '没有权限收藏文件' });
      }

      const file = await getFileRow(id);
      if (!file) {
        return res.status(404).json({ message: '文件不存在' });
      }
      if (!canReadScopedResource(req.user, file, 'uploaded_by')) {
        return res.status(403).json({ message: '没有权限收藏此文件' });
      }

      await query('INSERT IGNORE INTO file_favorites (file_id, user_id) VALUES (?, ?)', [id, toId(req.user.id)]);
      const favorite = await getFileFavoriteRow(req.user, id);
      return res.json({
        message: '已添加收藏',
        isFavorited: true,
        favorite: serializeFileFavorite(favorite),
      });
    }

    if (!canReadKnowledgePoints(req.user)) {
      return res.status(403).json({ message: '没有权限收藏文件夹' });
    }

    const knowledgePoint = await getKnowledgePointRow(id);
    if (!knowledgePoint) {
      return res.status(404).json({ message: '知识点不存在' });
    }
    if (!canReadScopedResource(req.user, knowledgePoint, 'created_by')) {
      return res.status(403).json({ message: '没有权限收藏此知识点' });
    }

    await query('INSERT IGNORE INTO knowledge_point_favorites (knowledge_point_id, user_id) VALUES (?, ?)', [id, toId(req.user.id)]);
    const favorite = await getKnowledgePointFavoriteRow(req.user, id);
    return res.json({
      message: '已添加收藏',
      isFavorited: true,
      favorite: serializeKnowledgePointFavorite(favorite),
    });
  } catch (err) {
    sendServerError(res, err, '添加收藏失败');
  }
};

exports.deleteFavorite = async (req, res) => {
  try {
    const type = normalizeFavoriteType(req.params.type);
    const id = toId(req.params.id);
    if (!type || !id) {
      return res.status(400).json({ message: '收藏类型或资源 ID 不正确' });
    }

    if (type === 'file') {
      if (!canReadFiles(req.user)) {
        return res.status(403).json({ message: '没有权限取消文件收藏' });
      }
      await query('DELETE FROM file_favorites WHERE file_id = ? AND user_id = ?', [id, toId(req.user.id)]);
      return res.json({ message: '已取消收藏', isFavorited: false });
    }

    if (!canReadKnowledgePoints(req.user)) {
      return res.status(403).json({ message: '没有权限取消文件夹收藏' });
    }
    await query('DELETE FROM knowledge_point_favorites WHERE knowledge_point_id = ? AND user_id = ?', [id, toId(req.user.id)]);
    return res.json({ message: '已取消收藏', isFavorited: false });
  } catch (err) {
    sendServerError(res, err, '取消收藏失败');
  }
};
