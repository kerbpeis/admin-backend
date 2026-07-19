export const PERMISSIONS = {
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_ASSIGN_ROLE: 'user:assign_role',
  USER_GRANT_ADMIN: 'user:grant_admin',

  ROLE_READ: 'role:read',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  ROLE_ASSIGN_PERMISSION: 'role:assign_permission',

  PERMISSION_READ: 'permission:read',
  PERMISSION_CREATE: 'permission:create',
  PERMISSION_UPDATE: 'permission:update',
  PERMISSION_DELETE: 'permission:delete',
  PERMISSION_BATCH_CREATE: 'permission:batch_create',
  AUDIT_READ: 'audit:read',

  DEPARTMENT_READ: 'department:read',
  DEPARTMENT_CREATE: 'department:create',
  DEPARTMENT_UPDATE: 'department:update',
  DEPARTMENT_DELETE: 'department:delete',
  DEPARTMENT_MANAGE_MEMBERS: 'department:manage_members',

  FILE_READ: 'file:read',
  FILE_CREATE: 'file:create',
  FILE_UPDATE: 'file:update',
  FILE_DELETE: 'file:delete',

  FOLDER_READ: 'folder:read',
  FOLDER_CREATE: 'folder:create',
  FOLDER_UPDATE: 'folder:update',
  FOLDER_DELETE: 'folder:delete',
};

export const getPermissionNames = (user) => {
  if (!user) return [];
  if (Array.isArray(user.permissionNames)) return user.permissionNames;

  const names = new Set();
  for (const role of user.roles || []) {
    for (const permission of role.permissions || []) {
      if (permission?.name) names.add(permission.name);
    }
  }

  return Array.from(names);
};

export const hasPermission = (user, permissionName) => {
  if (!user || !permissionName) return false;
  if (user.isAdmin) return true;
  return getPermissionNames(user).includes(permissionName);
};

export const hasAnyPermission = (user, permissionNames = []) => (
  permissionNames.some((permissionName) => hasPermission(user, permissionName))
);
