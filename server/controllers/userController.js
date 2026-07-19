const bcrypt = require('bcryptjs');
const { query, withTransaction, isDuplicateKeyError } = require('../config/db');
const { serializeRole, serializeUser, toId, placeholders } = require('../utils/mysqlUtils');
const { PERMISSIONS, hasPermission } = require('../utils/authorization');
const { loadPermissionsForRoles } = require('./roleController');

const loadRolesForUsers = async (userIds) => {
  if (!userIds.length) return new Map();

  const roleRows = await query(
    `SELECT ur.user_id, r.*
     FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id IN (${placeholders(userIds)})
     ORDER BY r.id`,
    userIds
  );

  const permissionsByRole = await loadPermissionsForRoles(roleRows.map((role) => role.id));
  const map = new Map();

  for (const row of roleRows) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(serializeRole(row, permissionsByRole.get(row.id) || []));
  }

  return map;
};

const assignRoleIds = async (connection, userId, roleIds = []) => {
  await connection.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);

  for (const roleId of roleIds.map(toId).filter(Boolean)) {
    await connection.execute('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
  }
};

const getUsers = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || '';
    const department = req.query.department || '';
    const params = [];
    const filters = [];

    if (search) {
      filters.push('(name LIKE ? OR email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (department) {
      filters.push('department = ?');
      params.push(department);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRows = await query(`SELECT COUNT(*) AS total FROM users ${where}`, params);
    const total = countRows[0].total;
    const users = await query(
      `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );

    const rolesByUser = await loadRolesForUsers(users.map((user) => user.id));

    res.json({
      users: users.map((user) => serializeUser(user, rolesByUser.get(user.id) || [])),
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalUsers: total,
    });
  } catch (err) {
    res.status(500).json({ message: '获取用户列表失败', error: err.message });
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, password, department, section, isAdmin = false, roles = [] } = req.body;
    if (!name || !email || !password || !department || !section) {
      return res.status(400).json({ message: '请填写姓名、邮箱、密码、部门和科室' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const canGrantAdmin = hasPermission(req.user, PERMISSIONS.USER_GRANT_ADMIN);

    const userId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO users (name, email, password_hash, department, section, is_admin)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, email, passwordHash, department, section, canGrantAdmin && isAdmin ? 1 : 0]
      );
      await assignRoleIds(connection, result.insertId, roles);
      return result.insertId;
    });

    const rows = await query('SELECT * FROM users WHERE id = ?', [userId]);
    const rolesByUser = await loadRolesForUsers([userId]);

    res.status(201).json({
      message: '用户创建成功',
      user: serializeUser(rows[0], rolesByUser.get(userId) || []),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该邮箱已被注册' });
    }
    res.status(500).json({ message: '用户创建失败', error: err.message });
  }
};

const getUser = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
    if (!rows[0]) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const rolesByUser = await loadRolesForUsers([id]);
    res.json({ user: serializeUser(rows[0], rolesByUser.get(id) || []) });
  } catch (err) {
    res.status(500).json({ message: '获取用户信息失败', error: err.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const { name, email, password, department, section, isAdmin = false, roles } = req.body;

    const existing = await query('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing[0]) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const canGrantAdmin = hasPermission(req.user, PERMISSIONS.USER_GRANT_ADMIN);
    const nextIsAdmin = canGrantAdmin ? Boolean(isAdmin) : Boolean(existing[0].is_admin);

    await withTransaction(async (connection) => {
      if (password) {
        const passwordHash = await bcrypt.hash(password, 10);
        await connection.execute(
          `UPDATE users
           SET name = ?, email = ?, password_hash = ?, department = ?, section = ?, is_admin = ?
           WHERE id = ?`,
          [name, email, passwordHash, department, section, nextIsAdmin ? 1 : 0, id]
        );
      } else {
        await connection.execute(
          `UPDATE users
           SET name = ?, email = ?, department = ?, section = ?, is_admin = ?
           WHERE id = ?`,
          [name, email, department, section, nextIsAdmin ? 1 : 0, id]
        );
      }

      if (Array.isArray(roles)) {
        await assignRoleIds(connection, id, roles);
      }
    });

    const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
    const rolesByUser = await loadRolesForUsers([id]);

    res.json({
      message: '用户更新成功',
      user: serializeUser(rows[0], rolesByUser.get(id) || []),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该邮箱已被注册' });
    }
    res.status(500).json({ message: '用户更新失败', error: err.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ message: '不能删除自己' });
    }

    const result = await query('DELETE FROM users WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }

    res.json({ message: '用户删除成功' });
  } catch (err) {
    res.status(500).json({ message: '用户删除失败', error: err.message });
  }
};

const assignRoles = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];

    const existing = await query('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing[0]) {
      return res.status(404).json({ message: '用户不存在' });
    }

    await withTransaction((connection) => assignRoleIds(connection, id, roleIds));

    const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
    const rolesByUser = await loadRolesForUsers([id]);

    res.json({
      message: '角色分配成功',
      user: serializeUser(rows[0], rolesByUser.get(id) || []),
    });
  } catch (err) {
    res.status(500).json({ message: '角色分配失败', error: err.message });
  }
};

module.exports = {
  getUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
  assignRoles,
  loadRolesForUsers,
};
