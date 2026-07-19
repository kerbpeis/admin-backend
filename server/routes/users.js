const express = require('express');
const router = express.Router();
const { getUsers, createUser, getUser, updateUser, deleteUser, assignRoles } = require('../controllers/userController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

// 获取用户列表
router.get('/', auth, requirePermission(PERMISSIONS.USER_READ), getUsers);

// 创建新用户
router.post('/', auth, requirePermission(PERMISSIONS.USER_CREATE), createUser);

// 获取单个用户信息
router.get('/:id', auth, requirePermission(PERMISSIONS.USER_READ), getUser);

// 更新用户信息
router.put('/:id', auth, requirePermission(PERMISSIONS.USER_UPDATE), updateUser);

// 删除用户
router.delete('/:id', auth, requirePermission(PERMISSIONS.USER_DELETE), deleteUser);

// 为用户分配角色
router.post('/:id/roles', auth, requirePermission(PERMISSIONS.USER_ASSIGN_ROLE), assignRoles);

module.exports = router;
