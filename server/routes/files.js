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
const { createRateLimiter } = require('../middleware/rateLimit');
const { PERMISSIONS } = require('../utils/authorization');
const { normalizeUploadedFileName } = require('../utils/uploadNames');
const { verifyUploadedFileSignature } = require('../utils/fileSignature');

// 上传/下载按用户限流（需在 auth 之后使用，keyFn 依赖 req.user）
const userKey = (req) => String(req.user?.id || req.ip || 'unknown');
const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyFn: userKey,
  message: '上传过于频繁，请稍后再试',
});
const downloadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 120,
  keyFn: userKey,
  message: '下载过于频繁，请稍后再试',
});

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

// 文件过滤器：支持 Tika 可解析的 Office / PDF / 文本 / 网页 / RTF 等文档格式
// 同时校验 MIME 类型与扩展名是否匹配，防止恶意伪装文件
const allowedTypes = [
  { mime: 'application/pdf', exts: ['.pdf'] },
  { mime: 'application/msword', exts: ['.doc'] },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', exts: ['.docx'] },
  { mime: 'application/vnd.ms-excel', exts: ['.xls'] },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exts: ['.xlsx'] },
  { mime: 'application/vnd.ms-powerpoint', exts: ['.ppt'] },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', exts: ['.pptx'] },
  { mime: 'application/rtf', exts: ['.rtf'] },
  { mime: 'text/rtf', exts: ['.rtf'] },
  { mime: 'text/html', exts: ['.html', '.htm'] },
  { mime: 'text/plain', exts: ['.txt'] },
  { mime: 'text/markdown', exts: ['.md', '.markdown'] },
  { mime: 'application/json', exts: ['.json'] },
  { mime: 'application/xml', exts: ['.xml'] },
  { mime: 'text/xml', exts: ['.xml'] },
  { mime: 'text/csv', exts: ['.csv'] },
];

const fileFilter = (req, file, cb) => {
  const entry = allowedTypes.find((t) => t.mime === file.mimetype);
  if (!entry) {
    return cb(new Error('不支持的文件类型'), false);
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!entry.exts.includes(ext)) {
    return cb(new Error('文件扩展名与类型不匹配'), false);
  }
  cb(null, true);
};

const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 限制50MB
});

// 包装 multer，将超限/类型等上传错误返回为 JSON 而非默认 HTML 错误页
const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      normalizeUploadedFileName(req, res, next);
      return;
    }

    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? '文件不能超过 50MB'
        : '文件上传失败';
      return res.status(status).json({ message, error: err.code });
    }

    return res.status(400).json({ message: err.message || '文件上传失败' });
  });
};

// 获取文件列表
router.get('/', auth, requirePermission(PERMISSIONS.FILE_READ), getFiles);

// 获取单个文件
router.get('/:id', auth, requirePermission(PERMISSIONS.FILE_READ), getFile);

// 上传文件
router.post('/', auth, requirePermission(PERMISSIONS.FILE_CREATE), uploadLimiter, handleUpload, verifyUploadedFileSignature, uploadFile);

// 更新文件信息
router.put('/:id', auth, requirePermission(PERMISSIONS.FILE_UPDATE), updateFile);

// 删除文件
router.delete('/:id', auth, requirePermission(PERMISSIONS.FILE_DELETE), deleteFile);

// 下载文件
router.get('/:id/download', auth, requirePermission(PERMISSIONS.FILE_READ), downloadLimiter, downloadFile);

// 下载文件内容
router.get('/:id/download/:filename', auth, requirePermission(PERMISSIONS.FILE_READ), downloadLimiter, downloadFileContent);

// 获取文件版本历史
router.get('/:id/versions', auth, requirePermission(PERMISSIONS.FILE_READ), getFileVersions);

// 上传新版本
router.post('/:id/versions', auth, requirePermission(PERMISSIONS.FILE_UPDATE), uploadLimiter, handleUpload, verifyUploadedFileSignature, uploadNewVersion);

// 收藏/取消收藏
router.post('/:id/favorite', auth, requirePermission(PERMISSIONS.FILE_READ), toggleFavorite);

module.exports = router;
