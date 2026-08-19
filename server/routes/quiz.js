const express = require('express');
const router = express.Router();
const {
  getDaily,
  submitAnswer,
  getStats,
  getWrongBook,
  uploadQuestions,
  importText,
  generateFromDocument,
} = require('../controllers/quizController');
const { auth, requirePermission } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { PERMISSIONS } = require('../utils/authorization');

// AI 出题按用户限流（会消耗 LLM 额度）
const generateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyFn: (req) => String(req.user?.id || req.ip || 'unknown'),
  message: 'AI 出题过于频繁，请稍后再试',
});

router.get('/daily', auth, getDaily);
router.post('/answer', auth, submitAnswer);
router.get('/stats', auth, getStats);
router.get('/wrong', auth, getWrongBook);
router.post('/questions', auth, uploadQuestions);
router.post('/import-text', auth, requirePermission(PERMISSIONS.FILE_CREATE), importText);
router.post('/generate', auth, requirePermission(PERMISSIONS.FILE_CREATE), generateLimiter, generateFromDocument);

module.exports = router;
