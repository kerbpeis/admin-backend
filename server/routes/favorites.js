const express = require('express');
const router = express.Router();
const {
  getFavorites,
  addFavorite,
  deleteFavorite,
} = require('../controllers/favoriteController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

router.get('/', auth, requirePermission(PERMISSIONS.FILE_READ, PERMISSIONS.FOLDER_READ), getFavorites);
router.post('/', auth, requirePermission(PERMISSIONS.FILE_READ, PERMISSIONS.FOLDER_READ), addFavorite);
router.delete('/:type/:id', auth, requirePermission(PERMISSIONS.FILE_READ, PERMISSIONS.FOLDER_READ), deleteFavorite);

module.exports = router;
