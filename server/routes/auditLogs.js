const express = require('express');
const { getAuditLog, getAuditLogs } = require('../controllers/auditLogController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

const router = express.Router();

router.get('/', auth, requirePermission(PERMISSIONS.AUDIT_READ), getAuditLogs);
router.get('/:id', auth, requirePermission(PERMISSIONS.AUDIT_READ), getAuditLog);

module.exports = router;
