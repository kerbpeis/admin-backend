const express = require('express');
const {
  createCompany,
  getCompanies,
  refreshInviteCode,
  updateCompany,
} = require('../controllers/companyController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

const router = express.Router();

router.get('/', auth, requirePermission(PERMISSIONS.USER_READ), getCompanies);
router.post('/', auth, requirePermission(PERMISSIONS.USER_CREATE), createCompany);
router.put('/:id', auth, requirePermission(PERMISSIONS.USER_UPDATE), updateCompany);
router.post('/:id/invite-code', auth, requirePermission(PERMISSIONS.USER_UPDATE), refreshInviteCode);

module.exports = router;
