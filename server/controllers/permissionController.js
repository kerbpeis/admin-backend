const { query, isDuplicateKeyError } = require('../config/db');
const { serializePermission, toId, placeholders } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');

const getPermissions = async (req, res) => {
  try {
    const params = [];
    let sql = 'SELECT * FROM permissions';

    if (req.query.type) {
      sql += ' WHERE type = ?';
      params.push(req.query.type);
    }

    sql += ' ORDER BY id';
    const permissions = await query(sql, params);
    res.json({ permissions: permissions.map(serializePermission) });
  } catch (err) {
    sendServerError(res, err, '获取权限列表失败');
  }
};

const createPermission = async (req, res) => {
  try {
    const { name, description = '', type = 'file' } = req.body;
    if (!name) {
      return res.status(400).json({ message: '请输入权限名称' });
    }

    const result = await query(
      'INSERT INTO permissions (name, description, type) VALUES (?, ?, ?)',
      [name, description, type]
    );
    const rows = await query('SELECT * FROM permissions WHERE id = ?', [result.insertId]);

    res.status(201).json({
      message: '权限创建成功',
      permission: serializePermission(rows[0]),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该权限已存在' });
    }
    sendServerError(res, err, '权限创建失败');
  }
};

const batchCreatePermissions = async (req, res) => {
  try {
    const permissions = req.body.permissions;
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({ message: '请提供权限列表' });
    }

    const names = permissions.map((permission) => permission.name).filter(Boolean);
    if (!names.length) {
      return res.status(400).json({ message: '请提供有效权限名称' });
    }

    const existing = await query(
      `SELECT name FROM permissions WHERE name IN (${placeholders(names)})`,
      names
    );
    const existingNames = existing.map((permission) => permission.name);
    const newPermissions = permissions.filter((permission) => permission.name && !existingNames.includes(permission.name));

    for (const permission of newPermissions) {
      await query(
        'INSERT INTO permissions (name, description, type) VALUES (?, ?, ?)',
        [permission.name, permission.description || '', permission.type || 'file']
      );
    }

    const created = newPermissions.length
      ? await query(`SELECT * FROM permissions WHERE name IN (${placeholders(newPermissions.map((permission) => permission.name))})`, newPermissions.map((permission) => permission.name))
      : [];

    res.status(201).json({
      message: `成功创建 ${created.length} 个权限`,
      permissions: created.map(serializePermission),
      existing: existingNames,
    });
  } catch (err) {
    sendServerError(res, err, '批量创建权限失败');
  }
};

const getPermission = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const rows = await query('SELECT * FROM permissions WHERE id = ?', [id]);
    if (!rows[0]) {
      return res.status(404).json({ message: '权限不存在' });
    }

    res.json({ permission: serializePermission(rows[0]) });
  } catch (err) {
    sendServerError(res, err, '获取权限信息失败');
  }
};

const updatePermission = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const { name, description = '', type = 'file' } = req.body;

    const existing = await query('SELECT * FROM permissions WHERE id = ?', [id]);
    if (!existing[0]) {
      return res.status(404).json({ message: '权限不存在' });
    }

    await query(
      'UPDATE permissions SET name = ?, description = ?, type = ? WHERE id = ?',
      [name, description, type, id]
    );

    const rows = await query('SELECT * FROM permissions WHERE id = ?', [id]);
    res.json({
      message: '权限更新成功',
      permission: serializePermission(rows[0]),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '该权限名已被使用' });
    }
    sendServerError(res, err, '权限更新失败');
  }
};

const deletePermission = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const used = await query('SELECT COUNT(*) AS total FROM role_permissions WHERE permission_id = ?', [id]);
    if (used[0].total > 0) {
      return res.status(400).json({ message: '该权限正在被角色使用，无法删除' });
    }

    const result = await query('DELETE FROM permissions WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '权限不存在' });
    }

    res.json({ message: '权限删除成功' });
  } catch (err) {
    sendServerError(res, err, '权限删除失败');
  }
};

module.exports = {
  getPermissions,
  createPermission,
  batchCreatePermissions,
  getPermission,
  updatePermission,
  deletePermission,
};
