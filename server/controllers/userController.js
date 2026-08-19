const bcrypt = require('bcryptjs');
const { query, withTransaction, isDuplicateKeyError } = require('../config/db');
const { serializeRole, serializeUser, toId, placeholders, firstPresent, parsePageAndLimit } = require('../utils/mysqlUtils');
const { PERMISSIONS, hasPermission } = require('../utils/authorization');
const { getScopedCompanyId } = require('../utils/resourceAccess');
const { loadPermissionsForRoles } = require('./roleController');
const { sendServerError } = require('../utils/serverError');
const { validateFields } = require('../utils/validation');

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
    const { page, limit } = parsePageAndLimit(req.query, 10, 100);
    const search = req.query.search || '';
    const department = req.query.department || '';
    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const params = [];
    const filters = [];

    if (companyId) {
      filters.push('u.company_id = ?');
      params.push(companyId);
    }

    if (search) {
      filters.push('(u.name LIKE ? OR u.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (department) {
      filters.push('u.department = ?');
      params.push(department);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRows = await query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
    const total = countRows[0].total;
    const users = await query(
      `SELECT u.*, c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ${where}
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
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
    sendServerError(res, err, '获取用户列表失败');
  }
};

const createUser = async (req, res) => {
  try {
    const { isAdmin = false, roles = [] } = req.body;
    const validation = validateFields({
      name: req.body?.name,
      email: req.body?.email,
      password: req.body?.password,
      department: req.body?.department,
      section: req.body?.section,
    });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message, field: validation.field });
    }
    const { name, email, password, department, section } = validation.values;

    if (roles !== undefined && !Array.isArray(roles)) {
      return res.status(400).json({ message: '角色列表必须是数组', field: 'roles' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const canGrantAdmin = hasPermission(req.user, PERMISSIONS.USER_GRANT_ADMIN);
    const companyId = getScopedCompanyId(req.user, req.body.companyId);
    const nextIsAdmin = canGrantAdmin && isAdmin;

    const userId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO users (company_id, name, email, password_hash, department, section, is_admin, platform_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, name, email, passwordHash, department, section, nextIsAdmin ? 1 : 0, nextIsAdmin ? 'super_admin' : 'member']
      );
      await assignRoleIds(connection, result.insertId, roles);
      return result.insertId;
    });

    const rows = await query(
      `SELECT u.*, c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ?`,
      [userId]
    );
    const rolesByUser = await loadRolesForUsers([userId]);

    res.status(201).json({
      message: '用户创建成功',
      user: serializeUser(rows[0], rolesByUser.get(userId) || []),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该邮箱已被注册' });
    }
    sendServerError(res, err, '用户创建失败');
  }
};

const getUser = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const rows = await query(
      `SELECT u.*, c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ? ${companyId ? 'AND u.company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const rolesByUser = await loadRolesForUsers([id]);
    res.json({ user: serializeUser(rows[0], rolesByUser.get(id) || []) });
  } catch (err) {
    sendServerError(res, err, '获取用户信息失败');
  }
};

const updateUser = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const { password, isAdmin = false, roles } = req.body;
    const companyId = getScopedCompanyId(req.user, req.body.companyId || req.query.companyId);

    const existing = await query(
      `SELECT * FROM users WHERE id = ? ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (!existing[0]) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 未传的字段保持原值；传了的字段做统一校验
    const fieldsToValidate = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      fieldsToValidate.name = req.body.name;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'email')) {
      fieldsToValidate.email = req.body.email;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'department')) {
      fieldsToValidate.department = req.body.department;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'section')) {
      fieldsToValidate.section = req.body.section;
    }
    if (password) {
      fieldsToValidate.password = password;
    }
    const validation = validateFields(fieldsToValidate);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message, field: validation.field });
    }

    const name = validation.values.name ?? existing[0].name;
    const email = validation.values.email ?? existing[0].email;
    const department = validation.values.department ?? existing[0].department;
    const section = validation.values.section ?? existing[0].section;
    const validatedPassword = validation.values.password;

    const canGrantAdmin = hasPermission(req.user, PERMISSIONS.USER_GRANT_ADMIN);
    const nextIsAdmin = canGrantAdmin ? Boolean(isAdmin) : Boolean(existing[0].is_admin);
    const nextPlatformRole = nextIsAdmin ? 'super_admin' : (existing[0].platform_role === 'company_admin' ? 'company_admin' : 'member');

    await withTransaction(async (connection) => {
      if (validatedPassword) {
        const passwordHash = await bcrypt.hash(validatedPassword, 12);
        await connection.execute(
          `UPDATE users
           SET name = ?, email = ?, password_hash = ?, department = ?, section = ?, is_admin = ?, platform_role = ?
           WHERE id = ?`,
          [name, email, passwordHash, department, section, nextIsAdmin ? 1 : 0, nextPlatformRole, id]
        );
      } else {
        await connection.execute(
          `UPDATE users
           SET name = ?, email = ?, department = ?, section = ?, is_admin = ?, platform_role = ?
           WHERE id = ?`,
          [name, email, department, section, nextIsAdmin ? 1 : 0, nextPlatformRole, id]
        );
      }

      if (Array.isArray(roles)) {
        await assignRoleIds(connection, id, roles);
      }
    });

    const rows = await query(
      `SELECT u.*, c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ?`,
      [id]
    );
    const rolesByUser = await loadRolesForUsers([id]);

    res.json({
      message: '用户更新成功',
      user: serializeUser(rows[0], rolesByUser.get(id) || []),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该邮箱已被注册' });
    }
    sendServerError(res, err, '用户更新失败');
  }
};

const deleteUser = async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ message: '不能删除自己' });
    }

    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const result = await query(
      `DELETE FROM users WHERE id = ? ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }

    res.json({ message: '用户删除成功' });
  } catch (err) {
    sendServerError(res, err, '用户删除失败');
  }
};

const assignRoles = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const roleIds = Array.isArray(req.body.roleIds) ? req.body.roleIds : [];
    const companyId = getScopedCompanyId(req.user, req.body.companyId || req.query.companyId);

    const existing = await query(
      `SELECT * FROM users WHERE id = ? ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (!existing[0]) {
      return res.status(404).json({ message: '用户不存在' });
    }

    await withTransaction((connection) => assignRoleIds(connection, id, roleIds));

    const rows = await query(
      `SELECT u.*, c.name AS company_name
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE u.id = ?`,
      [id]
    );
    const rolesByUser = await loadRolesForUsers([id]);

    res.json({
      message: '角色分配成功',
      user: serializeUser(rows[0], rolesByUser.get(id) || []),
    });
  } catch (err) {
    sendServerError(res, err, '角色分配失败');
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
