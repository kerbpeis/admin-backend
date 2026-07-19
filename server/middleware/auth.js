const jwt = require('jsonwebtoken');
const { getJwtSecret, getUserById } = require('../controllers/authController');
const { hasAnyPermission } = require('../utils/authorization');

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
    const user = await getUserById(decoded.userId);

    if (!user) {
      return res.status(401).json({ message: '认证用户不存在' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('auth中间件 - 认证失败:', err.message);
    res.status(401).json({ message: '认证失败', error: err.message });
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
