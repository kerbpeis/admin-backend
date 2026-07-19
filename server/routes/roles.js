const express = require('express');
const router = express.Router();
const { getRoles, createRole, getRole, updateRole, deleteRole, assignPermissions } = require('../controllers/roleController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

// 获取角色列表
router.get('/', auth, requirePermission(PERMISSIONS.ROLE_READ, PERMISSIONS.USER_ASSIGN_ROLE), getRoles);

// 创建新角色
router.post('/', auth, requirePermission(PERMISSIONS.ROLE_CREATE), createRole);

// 获取单个角色信息
router.get('/:id', auth, requirePermission(PERMISSIONS.ROLE_READ), getRole);

// 更新角色信息
router.put('/:id', auth, requirePermission(PERMISSIONS.ROLE_UPDATE), updateRole);

// 删除角色
router.delete('/:id', auth, requirePermission(PERMISSIONS.ROLE_DELETE), deleteRole);

// 为角色分配权限
router.post('/:id/permissions', auth, requirePermission(PERMISSIONS.ROLE_ASSIGN_PERMISSION), assignPermissions);

module.exports = router;
