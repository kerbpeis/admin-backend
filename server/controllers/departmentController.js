const { query, withTransaction, isDuplicateKeyError } = require('../config/db');
const { serializeDepartment, serializeUser, toId, placeholders, parsePageAndLimit } = require('../utils/mysqlUtils');
const { getScopedCompanyId, isPlatformAdmin } = require('../utils/resourceAccess');
const { loadRolesForUsers } = require('./userController');
const { sendServerError } = require('../utils/serverError');

const DIRECTORY_TYPES = new Set(['profession', 'section']);

const baseDepartmentSelect = `
  SELECT d.*, p.name AS parent_department_name, p.type AS parent_department_type, c.name AS company_name
  FROM departments d
  LEFT JOIN departments p ON p.id = d.parent_department_id
  LEFT JOIN companies c ON c.id = d.company_id
`;

const loadManagers = async (departmentIds) => {
  if (!departmentIds.length) return new Map();

  const rows = await query(
    `SELECT dm.department_id, u.*
     FROM department_managers dm
     INNER JOIN users u ON u.id = dm.user_id
     WHERE dm.department_id IN (${placeholders(departmentIds)})`,
    departmentIds
  );

  const rolesByUser = await loadRolesForUsers(rows.map((user) => user.id));
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.department_id)) map.set(row.department_id, []);
    map.get(row.department_id).push(serializeUser(row, rolesByUser.get(row.id) || []));
  }

  return map;
};

const loadDepartmentContentStats = async (departmentIds, scopeColumn = 'department_id', companyId = null) => {
  const ids = departmentIds.map(toId).filter(Boolean);
  const safeScopeColumn = scopeColumn === 'profession_id' ? 'profession_id' : 'department_id';
  const stats = new Map(ids.map((id) => [id, { knowledgePointCount: 0, fileCount: 0 }]));
  if (!ids.length) return stats;
  const companyFilter = companyId ? ' AND company_id = ?' : '';
  const params = companyId ? [...ids, companyId] : ids;

  const knowledgeRows = await query(
    `SELECT ${safeScopeColumn} AS department_id, COUNT(*) AS total
     FROM knowledge_points
     WHERE ${safeScopeColumn} IN (${placeholders(ids)}) AND status = 'active'${companyFilter}
     GROUP BY ${safeScopeColumn}`,
    params
  );
  for (const row of knowledgeRows) {
    const id = toId(row.department_id);
    if (stats.has(id)) stats.get(id).knowledgePointCount = Number(row.total || 0);
  }

  const fileRows = await query(
    `SELECT ${safeScopeColumn} AS department_id, COUNT(*) AS total
     FROM files
     WHERE ${safeScopeColumn} IN (${placeholders(ids)}) AND status = 'active'${companyFilter}
     GROUP BY ${safeScopeColumn}`,
    params
  );
  for (const row of fileRows) {
    const id = toId(row.department_id);
    if (stats.has(id)) stats.get(id).fileCount = Number(row.total || 0);
  }

  return stats;
};

const getDepartments = async (req, res) => {
  try {
    const filters = ['d.is_active = 1'];
    const params = [];
    // 平台管理员传 companyId=all 时查看全部公司的目录（只读总览）
    const wantsAllCompanies = isPlatformAdmin(req.user) && req.query.companyId === 'all';
    const companyId = wantsAllCompanies ? null : getScopedCompanyId(req.user, req.query.companyId);

    if (companyId) {
      filters.push('d.company_id = ?');
      params.push(companyId);
    }

    if (req.query.type) {
      filters.push('d.type = ?');
      params.push(req.query.type);
    }

    if (req.query.parentDepartment) {
      filters.push('d.parent_department_id = ?');
      params.push(toId(req.query.parentDepartment));
    }

    const { page, limit } = parsePageAndLimit(req.query, 100, 100);
    const offset = (page - 1) * limit;

    const where = `WHERE ${filters.join(' AND ')}`;
    const countRows = await query(`SELECT COUNT(*) AS total FROM departments d ${where}`, params);
    const total = countRows[0].total;

    const rows = await query(
      `${baseDepartmentSelect}
       ${where}
       ORDER BY d.order_index, d.created_at
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const managersByDepartment = await loadManagers(rows.map((department) => department.id));
    const statsByDepartment = await loadDepartmentContentStats(rows.map((department) => department.id), 'department_id', companyId);
    const statsByProfession = await loadDepartmentContentStats(rows.map((department) => department.id), 'profession_id', companyId);

    res.json({
      departments: rows.map((department) => serializeDepartment(department, {
        managers: managersByDepartment.get(department.id) || [],
        ...(department.type === 'profession'
          ? statsByProfession.get(department.id)
          : statsByDepartment.get(department.id)),
      })),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '获取部门列表失败');
  }
};

const getProfessions = async (req, res) => {
  try {
    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const professions = await query(
      `${baseDepartmentSelect}
       WHERE d.type = 'profession' AND d.is_active = 1
       ${companyId ? 'AND d.company_id = ?' : ''}
       ORDER BY d.order_index`,
      companyId ? [companyId] : []
    );

    const sections = await query(
      `SELECT * FROM departments
       WHERE type = 'section' AND is_active = 1
       ${companyId ? 'AND company_id = ?' : ''}
       ORDER BY order_index`,
      companyId ? [companyId] : []
    );

    const statsByProfession = await loadDepartmentContentStats(professions.map((profession) => profession.id), 'profession_id', companyId);
    const statsBySection = await loadDepartmentContentStats(sections.map((section) => section.id), 'department_id', companyId);

    const result = professions.map((profession) => serializeDepartment(profession, {
      ...(statsByProfession.get(profession.id) || {}),
      sections: sections
        .filter((section) => section.parent_department_id === profession.id)
        .map((section) => serializeDepartment(section, statsBySection.get(section.id) || {})),
      subcategories: sections
        .filter((section) => section.parent_department_id === profession.id)
        .map((section) => section.name),
    }));

    res.json(result);
  } catch (err) {
    sendServerError(res, err, '获取专业分类失败');
  }
};

const getDepartment = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const rows = await query(
      `${baseDepartmentSelect} WHERE d.id = ? ${companyId ? 'AND d.company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    const members = await query(
      `SELECT * FROM users
       WHERE (department = ? OR section = ?)
       ${companyId ? 'AND company_id = ?' : ''}
       ORDER BY created_at DESC`,
      companyId ? [rows[0].name, rows[0].name, companyId] : [rows[0].name, rows[0].name]
    );
    const rolesByUser = await loadRolesForUsers(members.map((member) => member.id));
    const managersByDepartment = await loadManagers([id]);

    res.json(serializeDepartment(rows[0], {
      managers: managersByDepartment.get(id) || [],
      members: members.map((member) => serializeUser(member, rolesByUser.get(member.id) || [])),
    }));
  } catch (err) {
    sendServerError(res, err, '获取部门详情失败');
  }
};

const saveManagers = async (connection, departmentId, managers = [], companyId = null) => {
  await connection.execute('DELETE FROM department_managers WHERE department_id = ?', [departmentId]);

  const managerIds = Array.from(new Set(managers.map(toId).filter(Boolean)));
  if (!managerIds.length) return;

  const scopedManagerRows = companyId
    ? await connection.execute(
      `SELECT id FROM users WHERE company_id = ? AND id IN (${placeholders(managerIds)})`,
      [companyId, ...managerIds]
    )
    : [managerIds.map((id) => ({ id }))];
  const scopedManagerIds = new Set(scopedManagerRows[0].map((row) => String(row.id)));

  for (const managerId of managerIds.filter((id) => scopedManagerIds.has(String(id)))) {
    await connection.execute(
      'INSERT IGNORE INTO department_managers (department_id, user_id) VALUES (?, ?)',
      [departmentId, managerId]
    );
  }
};

const createDepartment = async (req, res) => {
  try {
    const { name, description = '', type = 'department', parentDepartment = null, managers = [] } = req.body;
    if (!name) {
      return res.status(400).json({ message: '请输入部门名称' });
    }
    if (managers !== undefined && !Array.isArray(managers)) {
      return res.status(400).json({ message: '负责人列表必须是数组', field: 'managers' });
    }

    if (!DIRECTORY_TYPES.has(type)) {
      return res.status(400).json({ message: '目录类型只能是专业目录或科室目录' });
    }

    const departmentCompanyId = getScopedCompanyId(req.user, req.body.companyId);
    if (!departmentCompanyId) {
      return res.status(400).json({ message: '请先选择公司' });
    }

    const parentDepartmentId = type === 'section' ? toId(parentDepartment) : null;
    if (type === 'section' && !parentDepartmentId) {
      return res.status(400).json({ message: '请选择所属专业目录' });
    }

    if (parentDepartmentId) {
      const parentRows = await query(
        `SELECT id FROM departments
         WHERE id = ? AND type = 'profession' AND is_active = 1 AND company_id = ?`,
        [parentDepartmentId, departmentCompanyId]
      );
      if (!parentRows[0]) {
        return res.status(400).json({ message: '所属专业目录不存在或不属于当前公司' });
      }
    }

    const departmentId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO departments (company_id, name, description, type, parent_department_id)
         VALUES (?, ?, ?, ?, ?)`,
        [departmentCompanyId, name, description, type, parentDepartmentId]
      );
      await saveManagers(connection, result.insertId, managers, departmentCompanyId);
      return result.insertId;
    });

    const rows = await query(`${baseDepartmentSelect} WHERE d.id = ?`, [departmentId]);
    res.status(201).json({
      message: '部门创建成功',
      department: serializeDepartment(rows[0]),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '部门名称已存在' });
    }
    sendServerError(res, err, '部门创建失败');
  }
};

const updateDepartment = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const { name, description = '', managers, order, isActive } = req.body;
    if (managers !== undefined && !Array.isArray(managers)) {
      return res.status(400).json({ message: '负责人列表必须是数组', field: 'managers' });
    }
    const companyId = getScopedCompanyId(req.user, req.body.companyId || req.query.companyId);

    const existing = await query(
      `SELECT * FROM departments WHERE id = ? ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (!existing[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    await withTransaction(async (connection) => {
      await connection.execute(
        `UPDATE departments
         SET name = ?, description = ?, order_index = ?, is_active = ?
         WHERE id = ?`,
        [
          name || existing[0].name,
          description,
          order ?? existing[0].order_index,
          isActive === undefined ? existing[0].is_active : (isActive ? 1 : 0),
          id,
        ]
      );

      if (Array.isArray(managers)) {
        await saveManagers(connection, id, managers, companyId);
      }
    });

    const rows = await query(`${baseDepartmentSelect} WHERE d.id = ?`, [id]);
    res.json({
      message: '部门更新成功',
      department: serializeDepartment(rows[0]),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '部门名称已存在' });
    }
    sendServerError(res, err, '部门更新失败');
  }
};

const deleteDepartment = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const rows = await query(
      `SELECT * FROM departments WHERE id = ? ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    const children = await query('SELECT COUNT(*) AS total FROM departments WHERE parent_department_id = ?', [id]);
    if (children[0].total > 0) {
      return res.status(400).json({ message: '该部门下存在子部门，请先删除子部门' });
    }

    const members = await query(
      `SELECT COUNT(*) AS total FROM users
       WHERE (department = ? OR section = ?)
       ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [rows[0].name, rows[0].name, companyId] : [rows[0].name, rows[0].name]
    );
    if (members[0].total > 0) {
      return res.status(400).json({ message: '该部门下存在成员，请先转移成员' });
    }

    await query('DELETE FROM departments WHERE id = ?', [id]);
    res.json({ message: '部门删除成功' });
  } catch (err) {
    sendServerError(res, err, '部门删除失败');
  }
};

const getDepartmentMembers = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const rows = await query(
      `SELECT * FROM departments WHERE id = ? ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [id, companyId] : [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    const members = await query(
      `SELECT * FROM users
       WHERE (department = ? OR section = ?)
       ${companyId ? 'AND company_id = ?' : ''}
       ORDER BY created_at DESC`,
      companyId ? [rows[0].name, rows[0].name, companyId] : [rows[0].name, rows[0].name]
    );
    const rolesByUser = await loadRolesForUsers(members.map((member) => member.id));

    res.json(members.map((member) => serializeUser(member, rolesByUser.get(member.id) || [])));
  } catch (err) {
    sendServerError(res, err, '获取部门成员失败');
  }
};

const getSections = async (req, res) => {
  try {
    const params = [];
    const filters = [`d.type = 'section'`, 'd.is_active = 1'];
    const companyId = getScopedCompanyId(req.user, req.query.companyId);

    if (companyId) {
      filters.push('d.company_id = ?');
      params.push(companyId);
    }

    if (req.query.professionId) {
      filters.push('d.parent_department_id = ?');
      params.push(toId(req.query.professionId));
    }

    if (req.query.professionName) {
      filters.push('p.name = ?');
      params.push(req.query.professionName);
    }

    const rows = await query(
      `${baseDepartmentSelect}
       WHERE ${filters.join(' AND ')}
       ORDER BY d.order_index`,
      params
    );
    const statsBySection = await loadDepartmentContentStats(rows.map((row) => row.id), 'department_id', companyId);

    res.json(rows.map((row) => serializeDepartment(row, statsBySection.get(row.id) || {})));
  } catch (err) {
    sendServerError(res, err, '获取科室列表失败');
  }
};

const checkPermission = async (req, res) => {
  try {
    const departmentId = toId(req.query.departmentId);
    const action = req.query.action;
    const companyId = getScopedCompanyId(req.user, req.query.companyId);
    const rows = await query(
      `${baseDepartmentSelect} WHERE d.id = ? ${companyId ? 'AND d.company_id = ?' : ''}`,
      companyId ? [departmentId, companyId] : [departmentId]
    );
    if (!rows[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    if (req.user.isAdmin) {
      return res.json({ hasPermission: true, reason: 'admin' });
    }

    const department = rows[0];
    const sameDepartment = department.name === req.user.department || department.parent_department_name === req.user.department;
    const sameSection = department.name === req.user.section;

    if (action === 'view') {
      return res.json({ hasPermission: true, reason: 'public' });
    }

    if (action === 'download') {
      return res.json({ hasPermission: sameDepartment || sameSection, reason: sameDepartment || sameSection ? 'same_department' : 'no_permission' });
    }

    const manage = sameSection;
    res.json({ hasPermission: manage, reason: manage ? 'same_section' : 'no_permission' });
  } catch (err) {
    sendServerError(res, err, '权限检查失败');
  }
};

module.exports = {
  getDepartments,
  getProfessions,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentMembers,
  getSections,
  checkPermission,
};
