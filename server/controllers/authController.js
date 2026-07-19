const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, isDuplicateKeyError } = require('../config/db');
const { serializePermission, serializeRole, serializeUser } = require('../utils/mysqlUtils');

const DEFAULT_TOKEN_EXPIRES_IN = '7d';

const getJwtSecret = () => process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

const generateToken = (userId) => jwt.sign(
  { userId },
  getJwtSecret(),
  { expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_TOKEN_EXPIRES_IN }
);

const loadUserRoles = async (userId) => {
  const roleRows = await query(
    `SELECT r.*
     FROM roles r
     INNER JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?
     ORDER BY r.id`,
    [userId]
  );

  if (!roleRows.length) return [];

  const permissionRows = await query(
    `SELECT rp.role_id, p.*
     FROM role_permissions rp
     INNER JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id IN (${roleRows.map(() => '?').join(', ')})
     ORDER BY p.id`,
    roleRows.map((role) => role.id)
  );

  return roleRows.map((role) => serializeRole(
    role,
    permissionRows
      .filter((permission) => permission.role_id === role.id)
      .map(serializePermission)
  ));
};

const getUserById = async (userId) => {
  const rows = await query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!rows[0]) return null;
  const roles = await loadUserRoles(rows[0].id);
  return serializeUser(rows[0], roles);
};

// 用户注册
const register = async (req, res) => {
  try {
    const { name, email, password, department, section } = req.body;

    if (!name || !email || !password || !department || !section) {
      return res.status(400).json({ message: '请填写姓名、邮箱、密码、部门和科室' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, department, section, is_admin)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [name, email, passwordHash, department, section]
    );

    const user = await getUserById(result.insertId);
    const token = generateToken(result.insertId);

    res.status(201).json({
      message: '注册成功',
      user,
      token,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该邮箱已被注册' });
    }
    res.status(500).json({ message: '注册失败', error: err.message });
  }
};

// 用户登录
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: '请输入邮箱和密码' });
    }

    const rows = await query('SELECT * FROM users WHERE email = ?', [email]);
    const dbUser = rows[0];

    if (!dbUser || !(await bcrypt.compare(password, dbUser.password_hash))) {
      return res.status(400).json({ message: '用户名或密码错误' });
    }

    const user = await getUserById(dbUser.id);
    const token = generateToken(dbUser.id);

    res.json({
      message: '登录成功',
      user,
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: '登录失败', error: err.message });
  }
};

const getCurrentUser = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: '未认证的用户' });
  }

  res.json({ user: req.user });
};

const logout = async (req, res) => {
  res.json({ message: '退出成功' });
};

module.exports = {
  register,
  login,
  getCurrentUser,
  logout,
  getJwtSecret,
  getUserById,
};
