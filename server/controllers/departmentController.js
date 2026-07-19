const { query, withTransaction, isDuplicateKeyError } = require('../config/db');
const { serializeDepartment, serializeUser, toId, placeholders } = require('../utils/mysqlUtils');
const { loadRolesForUsers } = require('./userController');

const baseDepartmentSelect = `
  SELECT d.*, p.name AS parent_department_name, p.type AS parent_department_type
  FROM departments d
  LEFT JOIN departments p ON p.id = d.parent_department_id
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

const loadDepartmentContentStats = async (departmentIds, scopeColumn = 'department_id') => {
  const ids = departmentIds.map(toId).filter(Boolean);
  const safeScopeColumn = scopeColumn === 'profession_id' ? 'profession_id' : 'department_id';
  const stats = new Map(ids.map((id) => [id, { knowledgePointCount: 0, fileCount: 0 }]));
  if (!ids.length) return stats;

  const knowledgeRows = await query(
    `SELECT ${safeScopeColumn} AS department_id, COUNT(*) AS total
     FROM knowledge_points
     WHERE ${safeScopeColumn} IN (${placeholders(ids)}) AND status = 'active'
     GROUP BY ${safeScopeColumn}`,
    ids
  );
  for (const row of knowledgeRows) {
    const id = toId(row.department_id);
    if (stats.has(id)) stats.get(id).knowledgePointCount = Number(row.total || 0);
  }

  const fileRows = await query(
    `SELECT ${safeScopeColumn} AS department_id, COUNT(*) AS total
     FROM files
     WHERE ${safeScopeColumn} IN (${placeholders(ids)}) AND status = 'active'
     GROUP BY ${safeScopeColumn}`,
    ids
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

    if (req.query.type) {
      filters.push('d.type = ?');
      params.push(req.query.type);
    }

    if (req.query.parentDepartment) {
      filters.push('d.parent_department_id = ?');
      params.push(toId(req.query.parentDepartment));
    }

    const rows = await query(
      `${baseDepartmentSelect}
       WHERE ${filters.join(' AND ')}
       ORDER BY d.order_index, d.created_at`,
      params
    );
    const managersByDepartment = await loadManagers(rows.map((department) => department.id));
    const statsByDepartment = await loadDepartmentContentStats(rows.map((department) => department.id), 'department_id');
    const statsByProfession = await loadDepartmentContentStats(rows.map((department) => department.id), 'profession_id');

    res.json(rows.map((department) => serializeDepartment(department, {
      managers: managersByDepartment.get(department.id) || [],
      ...(department.type === 'profession'
        ? statsByProfession.get(department.id)
        : statsByDepartment.get(department.id)),
    })));
  } catch (err) {
    res.status(500).json({ message: '获取部门列表失败', error: err.message });
  }
};

const getProfessions = async (req, res) => {
  try {
    const professions = await query(
      `${baseDepartmentSelect}
       WHERE d.type = 'profession' AND d.is_active = 1
       ORDER BY d.order_index`
    );

    const sections = await query(
      `SELECT * FROM departments
       WHERE type = 'section' AND is_active = 1
       ORDER BY order_index`
    );

    const statsByProfession = await loadDepartmentContentStats(professions.map((profession) => profession.id), 'profession_id');
    const statsBySection = await loadDepartmentContentStats(sections.map((section) => section.id), 'department_id');

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
    res.status(500).json({ message: '获取专业分类失败', error: err.message });
  }
};

const getDepartment = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const rows = await query(`${baseDepartmentSelect} WHERE d.id = ?`, [id]);
    if (!rows[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    const members = await query(
      `SELECT * FROM users WHERE department = ? OR section = ? ORDER BY created_at DESC`,
      [rows[0].name, rows[0].name]
    );
    const rolesByUser = await loadRolesForUsers(members.map((member) => member.id));
    const managersByDepartment = await loadManagers([id]);

    res.json(serializeDepartment(rows[0], {
      managers: managersByDepartment.get(id) || [],
      members: members.map((member) => serializeUser(member, rolesByUser.get(member.id) || [])),
    }));
  } catch (err) {
    res.status(500).json({ message: '获取部门详情失败', error: err.message });
  }
};

const saveManagers = async (connection, departmentId, managers = []) => {
  await connection.execute('DELETE FROM department_managers WHERE department_id = ?', [departmentId]);

  for (const managerId of managers.map(toId).filter(Boolean)) {
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

    const departmentId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO departments (name, description, type, parent_department_id)
         VALUES (?, ?, ?, ?)`,
        [name, description, type, toId(parentDepartment)]
      );
      await saveManagers(connection, result.insertId, managers);
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
    res.status(500).json({ message: '部门创建失败', error: err.message });
  }
};

const updateDepartment = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const { name, description = '', managers, order, isActive } = req.body;

    const existing = await query('SELECT * FROM departments WHERE id = ?', [id]);
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
        await saveManagers(connection, id, managers);
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
    res.status(500).json({ message: '部门更新失败', error: err.message });
  }
};

const deleteDepartment = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const rows = await query('SELECT * FROM departments WHERE id = ?', [id]);
    if (!rows[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    const children = await query('SELECT COUNT(*) AS total FROM departments WHERE parent_department_id = ?', [id]);
    if (children[0].total > 0) {
      return res.status(400).json({ message: '该部门下存在子部门，请先删除子部门' });
    }

    const members = await query('SELECT COUNT(*) AS total FROM users WHERE department = ? OR section = ?', [rows[0].name, rows[0].name]);
    if (members[0].total > 0) {
      return res.status(400).json({ message: '该部门下存在成员，请先转移成员' });
    }

    await query('DELETE FROM departments WHERE id = ?', [id]);
    res.json({ message: '部门删除成功' });
  } catch (err) {
    res.status(500).json({ message: '部门删除失败', error: err.message });
  }
};

const getDepartmentMembers = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const rows = await query('SELECT * FROM departments WHERE id = ?', [id]);
    if (!rows[0]) {
      return res.status(404).json({ message: '部门不存在' });
    }

    const members = await query(
      'SELECT * FROM users WHERE department = ? OR section = ? ORDER BY created_at DESC',
      [rows[0].name, rows[0].name]
    );
    const rolesByUser = await loadRolesForUsers(members.map((member) => member.id));

    res.json(members.map((member) => serializeUser(member, rolesByUser.get(member.id) || [])));
  } catch (err) {
    res.status(500).json({ message: '获取部门成员失败', error: err.message });
  }
};

const getSections = async (req, res) => {
  try {
    const params = [];
    const filters = [`d.type = 'section'`, 'd.is_active = 1'];

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
    const statsBySection = await loadDepartmentContentStats(rows.map((row) => row.id), 'department_id');

    res.json(rows.map((row) => serializeDepartment(row, statsBySection.get(row.id) || {})));
  } catch (err) {
    res.status(500).json({ message: '获取科室列表失败', error: err.message });
  }
};

const checkPermission = async (req, res) => {
  try {
    const departmentId = toId(req.query.departmentId);
    const action = req.query.action;
    const rows = await query(`${baseDepartmentSelect} WHERE d.id = ?`, [departmentId]);
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
    res.status(500).json({ message: '权限检查失败', error: err.message });
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
