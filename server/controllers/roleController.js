const { query, withTransaction, isDuplicateKeyError } = require('../config/db');
const { serializePermission, serializeRole, toId, placeholders, firstPresent, parsePageAndLimit } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');

const loadPermissionsForRoles = async (roleIds) => {
  if (!roleIds.length) return new Map();

  const rows = await query(
    `SELECT rp.role_id, p.*
     FROM role_permissions rp
     INNER JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id IN (${placeholders(roleIds)})
     ORDER BY p.id`,
    roleIds
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.role_id)) map.set(row.role_id, []);
    map.get(row.role_id).push(serializePermission(row));
  }

  return map;
};

const getRoles = async (req, res) => {
  try {
    const { page, limit } = parsePageAndLimit(req.query, 100, 100);
    const offset = (page - 1) * limit;

    const countRows = await query('SELECT COUNT(*) AS total FROM roles');
    const total = countRows[0].total;

    const roles = await query(
      'SELECT * FROM roles ORDER BY id LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const permissionsByRole = await loadPermissionsForRoles(roles.map((role) => role.id));

    res.json({
      roles: roles.map((role) => serializeRole(role, permissionsByRole.get(role.id) || [])),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '获取角色列表失败');
  }
};

const saveRolePermissions = async (connection, roleId, permissionIds = []) => {
  await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

  for (const permissionId of permissionIds.map(toId).filter(Boolean)) {
    await connection.execute(
      'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      [roleId, permissionId]
    );
  }
};

const createRole = async (req, res) => {
  try {
    const { name, description = '', permissions = [] } = req.body;
    if (!name) {
      return res.status(400).json({ message: '请输入角色名称' });
    }
    if (permissions !== undefined && !Array.isArray(permissions)) {
      return res.status(400).json({ message: '权限列表必须是数组', field: 'permissions' });
    }

    const roleId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO roles (name, description) VALUES (?, ?)',
        [name, description]
      );
      await saveRolePermissions(connection, result.insertId, permissions);
      return result.insertId;
    });

    const roles = await query('SELECT * FROM roles WHERE id = ?', [roleId]);
    const permissionsByRole = await loadPermissionsForRoles([roleId]);

    res.status(201).json({
      message: '角色创建成功',
      role: serializeRole(roles[0], permissionsByRole.get(roleId) || []),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该角色已存在' });
    }
    sendServerError(res, err, '角色创建失败');
  }
};

const getRole = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const rows = await query('SELECT * FROM roles WHERE id = ?', [id]);
    if (!rows[0]) {
      return res.status(404).json({ message: '角色不存在' });
    }

    const permissionsByRole = await loadPermissionsForRoles([id]);
    res.json({ role: serializeRole(rows[0], permissionsByRole.get(id) || []) });
  } catch (err) {
    sendServerError(res, err, '获取角色信息失败');
  }
};

const updateRole = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const { permissions } = req.body;

    const existing = await query('SELECT * FROM roles WHERE id = ?', [id]);
    if (!existing[0]) {
      return res.status(404).json({ message: '角色不存在' });
    }

    // 未传的字段保持原值
    const name = firstPresent(req.body, ['name'], existing[0].name);
    const description = firstPresent(req.body, ['description'], existing[0].description);

    await withTransaction(async (connection) => {
      await connection.execute('UPDATE roles SET name = ?, description = ? WHERE id = ?', [name, description, id]);
      if (Array.isArray(permissions)) {
        await saveRolePermissions(connection, id, permissions);
      }
    });

    const rows = await query('SELECT * FROM roles WHERE id = ?', [id]);
    const permissionsByRole = await loadPermissionsForRoles([id]);

    res.json({
      message: '角色更新成功',
      role: serializeRole(rows[0], permissionsByRole.get(id) || []),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该角色名已被使用' });
    }
    sendServerError(res, err, '角色更新失败');
  }
};

const deleteRole = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const users = await query('SELECT COUNT(*) AS total FROM user_roles WHERE role_id = ?', [id]);
    if (users[0].total > 0) {
      return res.status(400).json({ message: '该角色正在被用户使用，无法删除' });
    }

    const result = await query('DELETE FROM roles WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '角色不存在' });
    }

    res.json({ message: '角色删除成功' });
  } catch (err) {
    sendServerError(res, err, '角色删除失败');
  }
};

const assignPermissions = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const permissionIds = Array.isArray(req.body.permissionIds) ? req.body.permissionIds : [];

    const existing = await query('SELECT * FROM roles WHERE id = ?', [id]);
    if (!existing[0]) {
      return res.status(404).json({ message: '角色不存在' });
    }

    await withTransaction((connection) => saveRolePermissions(connection, id, permissionIds));

    const rows = await query('SELECT * FROM roles WHERE id = ?', [id]);
    const permissionsByRole = await loadPermissionsForRoles([id]);

    res.json({
      message: '权限分配成功',
      role: serializeRole(rows[0], permissionsByRole.get(id) || []),
    });
  } catch (err) {
    sendServerError(res, err, '权限分配失败');
  }
};

module.exports = {
  getRoles,
  createRole,
  getRole,
  updateRole,
  deleteRole,
  assignPermissions,
  loadPermissionsForRoles,
};
