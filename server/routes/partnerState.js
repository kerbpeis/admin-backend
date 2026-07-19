const express = require('express');
const router = express.Router();
const {
  appendPartnerMessage,
  createPartnerConversation,
  createPartnerNotifications,
  getPartnerConversationMessages,
  getPartnerConversations,
  getPartnerDomainState,
  getPartnerMembers,
  getPartnerNotifications,
  getPartnerState,
  getPartnerTasks,
  markPartnerConversationRead,
  updatePartnerMemberPresence,
  updatePartnerNotification,
  updatePartnerTask,
  updatePartnerConversation,
  savePartnerState,
  deletePartnerState,
} = require('../controllers/partnerStateController');
const { auth } = require('../middleware/auth');

router.get('/domain', auth, getPartnerDomainState);
router.get('/members', auth, getPartnerMembers);
router.patch('/members/:memberId/presence', auth, updatePartnerMemberPresence);
router.get('/conversations', auth, getPartnerConversations);
router.post('/conversations', auth, createPartnerConversation);
router.get('/conversations/:conversationId/messages', auth, getPartnerConversationMessages);
router.post('/conversations/:conversationId/messages', auth, appendPartnerMessage);
router.post('/conversations/:conversationId/read', auth, markPartnerConversationRead);
router.patch('/conversations/:conversationId', auth, updatePartnerConversation);
router.get('/tasks', auth, getPartnerTasks);
router.patch('/tasks/:taskId', auth, updatePartnerTask);
router.get('/notifications', auth, getPartnerNotifications);
router.post('/notifications', auth, createPartnerNotifications);
router.patch('/notifications/:notificationId', auth, updatePartnerNotification);
router.get('/', auth, getPartnerState);
router.put('/', auth, savePartnerState);
router.delete('/', auth, deletePartnerState);

module.exports = router;
