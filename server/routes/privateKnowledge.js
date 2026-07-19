const express = require('express');
const router = express.Router();
const {
  createAgentInteraction,
  createShareRequest,
  deletePrivateWorkspace,
  deleteAgentInteractions,
  getActivityHistory,
  getAgentInteractions,
  getDownloadHistory,
  getLearningProgress,
  getPrivateWorkspace,
  getReadingHistory,
  getShareRequests,
  saveLearningProgress,
  savePrivateWorkspace,
  saveReadingHistory,
  updateLearningProgress,
  updateShareRequest,
} = require('../controllers/privateKnowledgeController');
const { auth } = require('../middleware/auth');

router.get('/agent-interactions', auth, getAgentInteractions);
router.post('/agent-interactions', auth, createAgentInteraction);
router.delete('/agent-interactions', auth, deleteAgentInteractions);
router.delete('/agent-interactions/:interactionId', auth, deleteAgentInteractions);
router.get('/share-requests', auth, getShareRequests);
router.post('/share-requests', auth, createShareRequest);
router.patch('/share-requests/:requestId', auth, updateShareRequest);
router.get('/activity-history', auth, getActivityHistory);
router.get('/download-history', auth, getDownloadHistory);
router.get('/learning-progress', auth, getLearningProgress);
router.put('/learning-progress', auth, saveLearningProgress);
router.patch('/learning-progress/:documentId', auth, updateLearningProgress);
router.get('/reading-history', auth, getReadingHistory);
router.put('/reading-history', auth, saveReadingHistory);
router.get('/', auth, getPrivateWorkspace);
router.put('/', auth, savePrivateWorkspace);
router.delete('/', auth, deletePrivateWorkspace);

module.exports = router;
