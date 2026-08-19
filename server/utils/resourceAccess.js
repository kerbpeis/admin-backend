const { query } = require('../config/db');
const { placeholders, toId } = require('./mysqlUtils');

const VALID_VISIBILITIES = new Set(['public', 'department', 'section', 'private']);

const normalizeVisibility = (visibility, fallback = 'department') => (
  VALID_VISIBILITIES.has(visibility) ? visibility : fallback
);

const getUserCompanyId = (user) => toId(user?.companyId ?? user?.company_id);

const isPlatformAdmin = (user) => (
  Boolean(user?.isAdmin) && String(user?.platformRole || user?.platform_role || '') === 'super_admin'
);

const getScopedCompanyId = (user, requestedCompanyId = null) => {
  const requested = toId(requestedCompanyId);
  if (isPlatformAdmin(user) && requested) return requested;
  return getUserCompanyId(user);
};

const buildCompanyFilter = (user, alias, options = {}) => {
  const companyId = getScopedCompanyId(user, options.requestedCompanyId);
  const column = options.column || 'company_id';
  const includeGlobal = Boolean(options.includeGlobal);

  if (!companyId) {
    if (isPlatformAdmin(user)) {
      return { sql: '1 = 1', params: [] };
    }
    // 普通用户无 companyId 时不可见任何数据
    return { sql: '1 = 0', params: [] };
  }

  if (includeGlobal) {
    return { sql: `(${alias}.${column} IS NULL OR ${alias}.${column} = ?)`, params: [companyId] };
  }

  return { sql: `${alias}.${column} = ?`, params: [companyId] };
};

const resolveDepartmentIds = async (value, type = null, companyIdValue = null) => {
  if (!value) return [];
  const id = toId(value);
  if (id) return [id];

  const params = [value];
  let sql = 'SELECT id FROM departments WHERE name = ? AND is_active = 1';
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  const companyId = toId(companyIdValue);
  if (companyId) {
    sql += ' AND company_id = ?';
    params.push(companyId);
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

  const companyId = getUserCompanyId(user);
  const companySql = companyId ? ' AND company_id = ?' : '';
  const departmentRows = user.department
    ? await query(
      `SELECT id FROM departments WHERE name = ? AND is_active = 1${companySql}`,
      companyId ? [user.department, companyId] : [user.department]
    )
    : [];
  const sectionRows = user.section
    ? await query(
      `SELECT id FROM departments WHERE name = ? AND is_active = 1${companySql}`,
      companyId ? [user.section, companyId] : [user.section]
    )
    : [];

  const departmentRootIds = departmentRows.map((row) => row.id);
  const childRows = departmentRootIds.length
    ? await query(
      `SELECT id FROM departments
       WHERE parent_department_id IN (${placeholders(departmentRootIds)})
         AND is_active = 1
         ${companyId ? 'AND company_id = ?' : ''}`,
      companyId ? [...departmentRootIds, companyId] : departmentRootIds
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
  const companyId = getUserCompanyId(user);
  // 非平台超管且无 companyId 的用户不可读任何数据
  if (!isPlatformAdmin(user) && !companyId) return false;
  if (!isPlatformAdmin(user) && row.company_id && String(row.company_id) !== String(companyId)) return false;
  if (user.isAdmin) return true;
  if (String(row[ownerColumn]) === String(user.id)) return true;
  if (row.visibility === 'public') return true;
  if (row.visibility === 'department') return sameDepartment(user, row);
  if (row.visibility === 'section') return sameSection(user, row);
  return false;
};

const canManageScopedResource = (user, row, ownerColumn) => {
  if (!row || !user) return false;
  const companyId = getUserCompanyId(user);
  // 非平台超管且无 companyId 的用户不可管理任何数据
  if (!isPlatformAdmin(user) && !companyId) return false;
  if (!isPlatformAdmin(user) && row.company_id && String(row.company_id) !== String(companyId)) return false;
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

const resolveWritableTarget = async (user, { departmentId, professionId, companyId: requestedCompanyId } = {}) => {
  const scope = await getUserDepartmentScope(user);
  const targetDepartmentId = toId(departmentId) || scope.defaultSectionId;
  const targetProfessionId = toId(professionId) || scope.defaultDepartmentId;
  const companyId = getScopedCompanyId(user, requestedCompanyId);

  if (user?.isAdmin) {
    return {
      ok: true,
      companyId,
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
    companyId,
    departmentId: targetDepartmentId,
    professionId: targetProfessionId,
  };
};

module.exports = {
  getUserCompanyId,
  isPlatformAdmin,
  getScopedCompanyId,
  buildCompanyFilter,
  normalizeVisibility,
  resolveDepartmentIds,
  getUserDepartmentScope,
  buildVisibilityFilter,
  canReadScopedResource,
  canManageScopedResource,
  ensureWritableVisibility,
  resolveWritableTarget,
};
