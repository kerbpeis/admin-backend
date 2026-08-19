const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, isDuplicateKeyError } = require('../config/db');
const { serializePermission, serializeRole, serializeUser } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');
const { validateFields } = require('../utils/validation');

const crypto = require('crypto');

const DEFAULT_TOKEN_EXPIRES_IN = '7d';

let devSecretWarned = false;
let devSecretCache = null;

// 为开发环境生成一个基于项目路径的稳定随机密钥，避免硬编码固定密钥。
// 同一项目、同一机器重启后密钥不变，不同项目或不同机器密钥不同。
const getStableDevJwtSecret = () => {
  if (devSecretCache) return devSecretCache;
  const projectPath = process.cwd();
  devSecretCache = crypto
    .createHmac('sha256', 'admin-backend-dev-stable-salt')
    .update(projectPath)
    .digest('hex');
  return devSecretCache;
};

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 JWT_SECRET 环境变量');
  }
  if (!devSecretWarned) {
    devSecretWarned = true;
    console.warn('未配置 JWT_SECRET，正在使用基于项目路径生成的开发密钥，请勿用于生产环境');
  }
  return getStableDevJwtSecret();
};

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
  const rows = await query(
    `SELECT u.*, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.id = ?`,
    [userId]
  );
  if (!rows[0]) return null;
  const roles = await loadUserRoles(rows[0].id);
  return serializeUser(rows[0], roles);
};

// 用户注册（必须携带有效的公司邀请码）
const register = async (req, res) => {
  try {
    const validation = validateFields({
      name: req.body?.name,
      email: req.body?.email,
      password: req.body?.password,
      department: req.body?.department,
      section: req.body?.section,
      inviteCode: req.body?.inviteCode,
    });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message, field: validation.field });
    }
    const { name, email, password, department, section, inviteCode } = validation.values;

    const companyRows = await query(
      'SELECT id FROM companies WHERE invite_code = ? LIMIT 1',
      [inviteCode]
    );
    if (!companyRows[0]) {
      return res.status(400).json({ message: '邀请码无效，请向公司管理员索取正确的邀请码' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (company_id, name, email, password_hash, department, section, is_admin, platform_role)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'member')`,
      [companyRows[0].id, name, email, passwordHash, department, section]
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
    sendServerError(res, err, '注册失败');
  }
};

// 用户登录
const login = async (req, res) => {
  try {
    const validation = validateFields({
      email: req.body?.email,
      password: req.body?.password,
    });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message, field: validation.field });
    }
    const { email, password } = validation.values;

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
    sendServerError(res, err, '登录失败');
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
