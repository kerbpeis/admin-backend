const express = require('express');
const router = express.Router();
const { register, login, getCurrentUser, logout } = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// 注册路由
router.post('/register', register);

// 登录路由
router.post('/login', login);

// 获取当前用户信息（需要认证）
router.get('/me', auth, getCurrentUser);

// 退出登录
router.post('/logout', auth, logout);

module.exports = router;
