const { query } = require('../config/db');
const { placeholders, toId } = require('./mysqlUtils');

const VALID_VISIBILITIES = new Set(['public', 'department', 'section', 'private']);

const normalizeVisibility = (visibility, fallback = 'department') => (
  VALID_VISIBILITIES.has(visibility) ? visibility : fallback
);

const resolveDepartmentIds = async (value, type = null) => {
  if (!value) return [];
  const id = toId(value);
  if (id) return [id];

  const params = [value];
  let sql = 'SELECT id FROM departments WHERE name = ? AND is_active = 1';
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  const rows = await query(sql, params);
  return rows.map((row) => row.id);
};

const getUserDepartmentScope = async (user) => {
  if (!user) {
    return {
      departmentRootIds: [],
      departmentScopeIds: [],
      sectionIds: [],
      defaultDepartmentId: null,
      defaultSectionId: null,
    };
  }

  const departmentRows = user.department
    ? await query('SELECT id FROM departments WHERE name = ? AND is_active = 1', [user.department])
    : [];
  const sectionRows = user.section
    ? await query('SELECT id FROM departments WHERE name = ? AND is_active = 1', [user.section])
    : [];

  const departmentRootIds = departmentRows.map((row) => row.id);
  const childRows = departmentRootIds.length
    ? await query(
      `SELECT id FROM departments WHERE parent_department_id IN (${placeholders(departmentRootIds)}) AND is_active = 1`,
      departmentRootIds
    )
    : [];

  const departmentScopeIds = Array.from(new Set([
    ...departmentRootIds,
    ...childRows.map((row) => row.id),
  ]));
  const sectionIds = Array.from(new Set(sectionRows.map((row) => row.id)));

  return {
    departmentRootIds,
    departmentScopeIds,
    sectionIds,
    defaultDepartmentId: departmentRootIds[0] || null,
    defaultSectionId: sectionIds[0] || null,
  };
};

const buildVisibilityFilter = async (user, alias, ownerColumn) => {
  if (user?.isAdmin) {
    return { sql: '1 = 1', params: [] };
  }

  const scope = await getUserDepartmentScope(user);
  const departmentIds = scope.departmentScopeIds.length ? scope.departmentScopeIds : [0];
  const sectionIds = scope.sectionIds.length ? scope.sectionIds : [0];

  return {
    sql: `(
      ${alias}.visibility = 'public'
      OR ${alias}.${ownerColumn} = ?
      OR (${alias}.visibility = 'department' AND (${alias}.profession_id IN (${placeholders(departmentIds)}) OR ${alias}.department_id IN (${placeholders(departmentIds)})))
      OR (${alias}.visibility = 'section' AND ${alias}.department_id IN (${placeholders(sectionIds)}))
    )`,
    params: [toId(user?.id), ...departmentIds, ...departmentIds, ...sectionIds],
  };
};

const sameDepartment = (user, row) => (
  row.profession_name === user.department ||
  row.department_name === user.department ||
  row.department_parent_name === user.department
);

const sameSection = (user, row) => row.department_name === user.section;

const canReadScopedResource = (user, row, ownerColumn) => {
  if (!row || !user) return false;
  if (user.isAdmin) return true;
  if (String(row[ownerColumn]) === String(user.id)) return true;
  if (row.visibility === 'public') return true;
  if (row.visibility === 'department') return sameDepartment(user, row);
  if (row.visibility === 'section') return sameSection(user, row);
  return false;
};

const canManageScopedResource = (user, row, ownerColumn) => {
  if (!row || !user) return false;
  if (user.isAdmin) return true;
  if (String(row[ownerColumn]) === String(user.id)) return true;
  return sameSection(user, row);
};

const ensureWritableVisibility = (user, visibility) => {
  const nextVisibility = normalizeVisibility(visibility);
  if (!user?.isAdmin && nextVisibility === 'public') {
    return {
      ok: false,
      message: '只有超级管理员可以发布公开资料',
    };
  }

  return { ok: true, visibility: nextVisibility };
};

const resolveWritableTarget = async (user, { departmentId, professionId } = {}) => {
  const scope = await getUserDepartmentScope(user);
  const targetDepartmentId = toId(departmentId) || scope.defaultSectionId;
  const targetProfessionId = toId(professionId) || scope.defaultDepartmentId;

  if (user?.isAdmin) {
    return {
      ok: true,
      departmentId: toId(departmentId) || null,
      professionId: toId(professionId) || null,
    };
  }

  if (!targetDepartmentId || !scope.sectionIds.includes(targetDepartmentId)) {
    return {
      ok: false,
      message: '只能在本科室范围内创建或维护资料',
    };
  }

  if (targetProfessionId && !scope.departmentRootIds.includes(targetProfessionId)) {
    return {
      ok: false,
      message: '资料所属专业必须与当前用户部门一致',
    };
  }

  return {
    ok: true,
    departmentId: targetDepartmentId,
    professionId: targetProfessionId,
  };
};

module.exports = {
  normalizeVisibility,
  resolveDepartmentIds,
  getUserDepartmentScope,
  buildVisibilityFilter,
  canReadScopedResource,
  canManageScopedResource,
  ensureWritableVisibility,
  resolveWritableTarget,
};
