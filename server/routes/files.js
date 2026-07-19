const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { 
  getFiles, 
  getFile, 
  uploadFile, 
  updateFile, 
  deleteFile, 
  downloadFile,
  downloadFileContent,
  getFileVersions,
  uploadNewVersion,
  toggleFavorite
} = require('../controllers/fileController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');
const { normalizeUploadedFileName } = require('../utils/uploadNames');

// 确保上传目录存在
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dateDir = path.join(uploadDir, new Date().toISOString().split('T')[0]);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    cb(null, dateDir);
  },
  filename: (req, file, cb) => {
    // 使用时间戳 + 原始文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/gif',
    'text/plain',
    'text/markdown'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'), false);
  }
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 限制50MB
});

// 获取文件列表
router.get('/', auth, requirePermission(PERMISSIONS.FILE_READ), getFiles);

// 获取单个文件
router.get('/:id', auth, requirePermission(PERMISSIONS.FILE_READ), getFile);

// 上传文件
router.post('/', auth, requirePermission(PERMISSIONS.FILE_CREATE), upload.single('file'), normalizeUploadedFileName, uploadFile);

// 更新文件信息
router.put('/:id', auth, requirePermission(PERMISSIONS.FILE_UPDATE), updateFile);

// 删除文件
router.delete('/:id', auth, requirePermission(PERMISSIONS.FILE_DELETE), deleteFile);

// 下载文件
router.get('/:id/download', auth, requirePermission(PERMISSIONS.FILE_READ), downloadFile);

// 下载文件内容
router.get('/:id/download/:filename', auth, requirePermission(PERMISSIONS.FILE_READ), downloadFileContent);

// 获取文件版本历史
router.get('/:id/versions', auth, requirePermission(PERMISSIONS.FILE_READ), getFileVersions);

// 上传新版本
router.post('/:id/versions', auth, requirePermission(PERMISSIONS.FILE_UPDATE), upload.single('file'), normalizeUploadedFileName, uploadNewVersion);

// 收藏/取消收藏
router.post('/:id/favorite', auth, requirePermission(PERMISSIONS.FILE_READ), toggleFavorite);

module.exports = router;
