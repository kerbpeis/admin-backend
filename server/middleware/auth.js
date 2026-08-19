const jwt = require('jsonwebtoken');
const { getJwtSecret, getUserById } = require('../controllers/authController');
const { hasAnyPermission } = require('../utils/authorization');

// 认证用户短 TTL 缓存：避免每个请求都查 users/roles/permissions 三张表。
// 代价是角色/权限变更最长 TTL 后才生效，可通过调小环境变量权衡。
const USER_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS) || 60 * 1000;
const MAX_USER_CACHE_SIZE = Number(process.env.AUTH_USER_CACHE_MAX_SIZE) || 1000;
const userCache = new Map(); // userId -> { user, expiresAt }

// 清理过期缓存条目，防止长期运行内存泄漏
const cleanupExpiredUserCache = () => {
  const now = Date.now();
  for (const [userId, cached] of userCache) {
    if (cached.expiresAt <= now) {
      userCache.delete(userId);
    }
  }
};

// 当缓存接近上限时，按过期时间淘汰最老的 20% 条目
const evictOldestUserCache = () => {
  if (userCache.size < MAX_USER_CACHE_SIZE * 0.9) return;
  const entries = Array.from(userCache.entries())
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const evictCount = Math.max(1, Math.floor(entries.length * 0.2));
  for (let i = 0; i < evictCount; i += 1) {
    userCache.delete(entries[i][0]);
  }
};

const getCachedUser = async (userId) => {
  const cached = userCache.get(userId);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.user;
    }
    userCache.delete(userId);
  }

  const user = await getUserById(userId);
  if (user) {
    evictOldestUserCache();
    userCache.set(userId, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  }
  return user;
};

// 每 5 分钟清理一次过期缓存
const cleanupInterval = setInterval(cleanupExpiredUserCache, 5 * 60 * 1000);
cleanupInterval.unref?.();

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
