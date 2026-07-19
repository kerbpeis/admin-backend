const express = require('express');
const router = express.Router();
const { getPermissions, createPermission, batchCreatePermissions, getPermission, updatePermission, deletePermission } = require('../controllers/permissionController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

// 获取权限列表
router.get('/', auth, requirePermission(PERMISSIONS.PERMISSION_READ, PERMISSIONS.ROLE_ASSIGN_PERMISSION), getPermissions);

// 创建新权限
router.post('/', auth, requirePermission(PERMISSIONS.PERMISSION_CREATE), createPermission);

// 批量创建权限
router.post('/batch', auth, requirePermission(PERMISSIONS.PERMISSION_BATCH_CREATE), batchCreatePermissions);

// 获取单个权限信息
router.get('/:id', auth, requirePermission(PERMISSIONS.PERMISSION_READ), getPermission);

// 更新权限信息
router.put('/:id', auth, requirePermission(PERMISSIONS.PERMISSION_UPDATE), updatePermission);

// 删除权限
router.delete('/:id', auth, requirePermission(PERMISSIONS.PERMISSION_DELETE), deletePermission);

module.exports = router;
