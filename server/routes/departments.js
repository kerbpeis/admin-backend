const express = require('express');
const router = express.Router();
const { 
  getDepartments, 
  getProfessions,
  getDepartment, 
  createDepartment, 
  updateDepartment, 
  deleteDepartment,
  getDepartmentMembers,
  getSections,
  checkPermission
} = require('../controllers/departmentController');
const { auth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/authorization');

// 获取专业分类列表
router.get('/professions', auth, requirePermission(PERMISSIONS.DEPARTMENT_READ), getProfessions);

// 获取科室列表
router.get('/sections', auth, requirePermission(PERMISSIONS.DEPARTMENT_READ), getSections);

// 检查用户权限
router.get('/check-permission', auth, checkPermission);

// 获取部门列表
router.get('/', auth, requirePermission(PERMISSIONS.DEPARTMENT_READ), getDepartments);

// 获取单个部门
router.get('/:id', auth, requirePermission(PERMISSIONS.DEPARTMENT_READ), getDepartment);

// 创建部门
router.post('/', auth, requirePermission(PERMISSIONS.DEPARTMENT_CREATE), createDepartment);

// 更新部门
router.put('/:id', auth, requirePermission(PERMISSIONS.DEPARTMENT_UPDATE), updateDepartment);

// 删除部门
router.delete('/:id', auth, requirePermission(PERMISSIONS.DEPARTMENT_DELETE), deleteDepartment);

// 获取部门成员
router.get('/:id/members', auth, requirePermission(PERMISSIONS.DEPARTMENT_READ), getDepartmentMembers);

module.exports = router;
