const express = require('express');
const router = express.Router();
const { 
  getKnowledgePoints, 
  getKnowledgePoint, 
  createKnowledgePoint, 
  updateKnowledgePoint, 
  deleteKnowledgePoint,
  toggleFavorite
} = require('../controllers/knowledgePointController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

// 获取知识点列表
router.get('/', auth, requirePermission(PERMISSIONS.FOLDER_READ), getKnowledgePoints);

// 获取单个知识点
router.get('/:id', auth, requirePermission(PERMISSIONS.FOLDER_READ), getKnowledgePoint);

// 创建知识点
router.post('/', auth, requirePermission(PERMISSIONS.FOLDER_CREATE), createKnowledgePoint);

// 更新知识点
router.put('/:id', auth, requirePermission(PERMISSIONS.FOLDER_UPDATE), updateKnowledgePoint);

// 删除知识点
router.delete('/:id', auth, requirePermission(PERMISSIONS.FOLDER_DELETE), deleteKnowledgePoint);

// 收藏/取消收藏
router.post('/:id/favorite', auth, requirePermission(PERMISSIONS.FOLDER_READ), toggleFavorite);

module.exports = router;
