const jwt = require('jsonwebtoken');
const { getJwtSecret, getUserById } = require('../controllers/authController');
const { hasAnyPermission } = require('../utils/authorization');

// 认证用户短 TTL 缓存：避免每个请求都查 users/roles/permissions 三张表。
// 代价是角色/权限变更最长 TTL 后才生效，可通过调小环境变量权衡。
const USER_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS) || 60 * 1000;
const userCache = new Map(); // userId -> { user, expiresAt }

const getCachedUser = async (userId) => {
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const user = await getUserById(userId);
  if (user) {
    userCache.set(userId, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  } else {
    userCache.delete(userId);
  }
  return user;
};

const getTokenFromRequest = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
};

const auth = async (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }

    const decoded = jwt.verify(token, getJwtSecret());
    const user = await getCachedUser(decoded.userId);

    if (!user) {
      return res.status(401).json({ message: '认证用户不存在' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('auth中间件 - 认证失败:', err.message);
    res.status(401).json({ message: '认证失败' });
  }
};

const adminAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: '需要先登录' });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({ message: '没有权限执行此操作' });
  }

  next();
};

const requirePermission = (...permissionNames) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: '需要先登录' });
    }

    if (!hasAnyPermission(req.user, permissionNames)) {
      return res.status(403).json({
        message: '没有权限执行此操作',
        requiredPermissions: permissionNames,
      });
    }

    next();
  };
};

module.exports = { auth, adminAuth, requirePermission };
