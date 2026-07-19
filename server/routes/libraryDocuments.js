const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const {
  createLibraryDocument,
  deleteLibraryDocument,
  downloadLibraryDocumentContent,
  getLibraryDocumentAccess,
  getLibraryDocumentCapabilities,
  getLibraryDocument,
  getLibraryDocumentDownload,
  getLibraryDocumentVersions,
  getLibraryDocumentStats,
  getLibraryDocuments,
  updateLibraryDocument,
  uploadLibraryDocumentVersion,
} = require('../controllers/libraryDocumentController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');
const { normalizeUploadedFileName } = require('../utils/uploadNames');

const router = express.Router();

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dateDir = path.join(uploadDir, new Date().toISOString().split('T')[0]);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    cb(null, dateDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

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
    'text/csv',
    'text/plain',
    'text/markdown',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error('不支持的资料文件类型'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      normalizeUploadedFileName(req, res, next);
      return;
    }

    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? '资料文件不能超过 50MB'
        : '资料文件上传失败';
      return res.status(status).json({ message, error: err.code });
    }

    return res.status(400).json({ message: err.message || '资料文件上传失败' });
  });
};

router.get('/', auth, requirePermission(PERMISSIONS.FILE_READ), getLibraryDocuments);
router.get('/access/me', auth, getLibraryDocumentAccess);
router.get('/stats/overview', auth, requirePermission(PERMISSIONS.FILE_READ), getLibraryDocumentStats);
router.post('/', auth, requirePermission(PERMISSIONS.FILE_CREATE), handleUpload, createLibraryDocument);
router.get('/:id', auth, requirePermission(PERMISSIONS.FILE_READ), getLibraryDocument);
router.put('/:id', auth, requirePermission(PERMISSIONS.FILE_UPDATE), updateLibraryDocument);
router.delete('/:id', auth, requirePermission(PERMISSIONS.FILE_DELETE), deleteLibraryDocument);
router.get('/:id/capabilities', auth, requirePermission(PERMISSIONS.FILE_READ), getLibraryDocumentCapabilities);
router.get('/:id/download', auth, requirePermission(PERMISSIONS.FILE_READ), getLibraryDocumentDownload);
router.get('/:id/download/content', auth, requirePermission(PERMISSIONS.FILE_READ), downloadLibraryDocumentContent);
router.get('/:id/versions', auth, requirePermission(PERMISSIONS.FILE_READ), getLibraryDocumentVersions);
router.post('/:id/versions', auth, requirePermission(PERMISSIONS.FILE_UPDATE), handleUpload, uploadLibraryDocumentVersion);

module.exports = router;
