const express = require('express');
const router = express.Router();
const { queryAgent, getAgentUsageStats } = require('../controllers/agentController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

router.post('/query', auth, queryAgent);
router.get('/usage', auth, requirePermission(PERMISSIONS.AUDIT_READ), getAgentUsageStats);

module.exports = router;
