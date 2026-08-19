const express = require('express');
const router = express.Router();
const { queryAgent, getAgentUsageStats } = require('../controllers/agentController');
const { auth, requirePermission } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { PERMISSIONS } = require('../utils/authorization');

// 智能体查询突发限流（每日总量由 AGENT_LLM_DAILY_LIMIT 控制，这里防短时间刷接口）
const agentQueryLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyFn: (req) => String(req.user?.id || req.ip || 'unknown'),
  message: '提问过于频繁，请稍后再试',
});

router.post('/query', auth, agentQueryLimiter, queryAgent);
router.get('/usage', auth, requirePermission(PERMISSIONS.AUDIT_READ), getAgentUsageStats);

module.exports = router;
