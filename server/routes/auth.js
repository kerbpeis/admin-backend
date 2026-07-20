const express = require('express');
const router = express.Router();
const { register, login, getCurrentUser, logout } = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');

// 登录限流：同一 IP+邮箱 5 分钟内最多 10 次，防暴力破解
const loginLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${req.ip || 'unknown'}:${String(req.body?.email || '').toLowerCase()}`,
  message: '登录尝试过于频繁，请 5 分钟后再试',
});

// 注册限流：同一 IP 10 分钟内最多 5 次，防批量注册
const registerLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: '注册请求过于频繁，请稍后再试',
});

// 注册路由
router.post('/register', registerLimiter, register);

// 登录路由
router.post('/login', loginLimiter, login);

// 获取当前用户信息（需要认证）
router.get('/me', auth, getCurrentUser);

// 退出登录
router.post('/logout', auth, logout);

module.exports = router;
