const { query } = require('../config/db');
const { toId } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');

const checkSameSection = (user, departmentName) => departmentName && departmentName === user.section;

const checkSameDepartment = (user, row) => (
  row.department_name === user.department ||
  row.profession_name === user.department ||
  row.department_name === user.section
);

const checkFilePermission = (action) => {
  return async (req, res, next) => {
    try {
      if (req.user.isAdmin) return next();

      const fileId = toId(req.params.id || req.body.fileId);
      const rows = await query(
        `SELECT f.*, d.name AS department_name, p.name AS profession_name
         FROM files f
         LEFT JOIN departments d ON d.id = f.department_id
         LEFT JOIN departments p ON p.id = f.profession_id
         WHERE f.id = ?`,
        [fileId]
      );
      const file = rows[0];

      if (!file) {
        return res.status(404).json({ message: '文件不存在' });
      }

      if (String(file.uploaded_by) === String(req.user.id)) return next();

      const canRead = file.visibility === 'public' || checkSameDepartment(req.user, file);
      const canManage = checkSameSection(req.user, file.department_name);
      const hasPermission = ['view', 'download'].includes(action) ? canRead : canManage;

      if (!hasPermission) {
        return res.status(403).json({ message: '没有权限执行此操作', requiredAction: action });
      }

      next();
    } catch (err) {
      sendServerError(res, err, '权限检查失败');
    }
  };
};

const checkKnowledgePointPermission = (action) => {
  return async (req, res, next) => {
    try {
      if (req.user.isAdmin) return next();

      const knowledgePointId = toId(req.params.id || req.body.knowledgePointId);
      const rows = await query(
        `SELECT kp.*, d.name AS department_name, p.name AS profession_name
         FROM knowledge_points kp
         LEFT JOIN departments d ON d.id = kp.department_id
         LEFT JOIN departments p ON p.id = kp.profession_id
         WHERE kp.id = ?`,
        [knowledgePointId]
      );
      const knowledgePoint = rows[0];

      if (!knowledgePoint) {
        return res.status(404).json({ message: '知识点不存在' });
      }

      if (String(knowledgePoint.created_by) === String(req.user.id)) return next();

      const canRead = knowledgePoint.visibility === 'public' || checkSameDepartment(req.user, knowledgePoint);
      const canManage = checkSameSection(req.user, knowledgePoint.department_name);
      const hasPermission = action === 'view' ? canRead : canManage;

      if (!hasPermission) {
        return res.status(403).json({ message: '没有权限执行此操作', requiredAction: action });
      }

      next();
    } catch (err) {
      sendServerError(res, err, '权限检查失败');
    }
  };
};

const checkDepartmentPermission = (action) => {
  return async (req, res, next) => {
    try {
      if (req.user.isAdmin) return next();
      if (action === 'view') return next();

      const departmentId = toId(req.params.id || req.body.departmentId);
      const rows = await query('SELECT * FROM departments WHERE id = ?', [departmentId]);
      const department = rows[0];

      if (!department) {
        return res.status(404).json({ message: '部门不存在' });
      }

      if (department.name === req.user.section && action === 'manage_members') {
        return next();
      }

      res.status(403).json({ message: '没有权限执行此操作', requiredAction: action });
    } catch (err) {
      sendServerError(res, err, '权限检查失败');
    }
  };
};

module.exports = {
  checkFilePermission,
  checkKnowledgePointPermission,
  checkDepartmentPermission,
};
