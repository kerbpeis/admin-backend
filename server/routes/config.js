const express = require('express');
const router = express.Router();
const { auth, requirePermission } = require('../middleware/auth');
const { getConfig, updateConfig, getConfigMeta } = require('../controllers/configController');
const { PERMISSIONS } = require('../utils/authorization');

// 获取运行时配置（需要系统管理权限）
router.get('/', auth, requirePermission(PERMISSIONS.PERMISSION_READ), getConfig);

// 获取配置项元信息（需要系统管理权限）
router.get('/meta', auth, requirePermission(PERMISSIONS.PERMISSION_READ), getConfigMeta);

// 更新运行时配置（需要权限管理权限）
router.put('/', auth, requirePermission(PERMISSIONS.PERMISSION_UPDATE), updateConfig);

module.exports = router;
