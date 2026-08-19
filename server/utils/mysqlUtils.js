const toId = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const idString = (value) => (value == null ? null : String(value));

const toBoolean = (value) => Boolean(Number(value));

const parseTags = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return String(value).split(',').map((tag) => tag.trim()).filter(Boolean);
  }
};

// 取请求体中第一个出现（且非 undefined）的字段，未传时回退到 fallback（保持原值）
const firstPresent = (source, keys, fallback = null) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      return source[key];
    }
  }
  return fallback;
};

// 分页大小统一封顶，避免客户端传入超大 limit 打满数据库
const clampPageSize = (value, fallback = 20, max = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const stringifyTags = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  if (typeof value === 'string') {
    return JSON.stringify(value.split(',').map((tag) => tag.trim()).filter(Boolean));
  }
  return null;
};

const createdUpdated = (row) => ({
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatDateOnly = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const serializePermission = (row) => row && ({
  _id: idString(row.id),
  id: idString(row.id),
  name: row.name,
  description: row.description || '',
  type: row.type,
  ...createdUpdated(row),
});

const serializeRole = (row, permissions = []) => row && ({
  _id: idString(row.id),
  id: idString(row.id),
  name: row.name,
  description: row.description || '',
  permissions,
  ...createdUpdated(row),
});

const collectUserPermissions = (roles = []) => {
  const map = new Map();

  for (const role of roles) {
    for (const permission of role.permissions || []) {
      if (permission?.name && !map.has(permission.name)) {
        map.set(permission.name, permission);
      }
    }
  }

  return Array.from(map.values());
};

const serializeUser = (row, roles = []) => row && ({
  _id: idString(row.id),
  id: idString(row.id),
  name: row.name,
  email: row.email,
  department: row.department,
  section: row.section,
  isAdmin: toBoolean(row.is_admin),
  platformRole: row.platform_role || 'member',
  companyId: idString(row.company_id),
  companyName: row.company_name || '',
  roles,
  permissions: collectUserPermissions(roles),
  permissionNames: collectUserPermissions(roles).map((permission) => permission.name),
  ...createdUpdated(row),
});

const serializeDepartment = (row, extras = {}) => row && ({
  _id: idString(row.id),
  id: idString(row.id),
  companyId: idString(row.company_id),
  companyName: row.company_name || '',
  name: row.name,
  description: row.description || '',
  type: row.type,
  parentDepartment: row.parent_department_id ? {
    _id: idString(row.parent_department_id),
    id: idString(row.parent_department_id),
    name: row.parent_department_name,
    type: row.parent_department_type,
  } : null,
  order: row.order_index,
  isActive: toBoolean(row.is_active),
  ...extras,
  ...createdUpdated(row),
});

const serializeKnowledgePoint = (row, extras = {}) => row && ({
  _id: idString(row.id),
  id: idString(row.id),
  companyId: idString(row.company_id),
  name: row.name,
  description: row.description || '',
  department: row.department_id ? {
    _id: idString(row.department_id),
    id: idString(row.department_id),
    name: row.department_name,
    type: row.department_type,
  } : null,
  profession: row.profession_id ? {
    _id: idString(row.profession_id),
    id: idString(row.profession_id),
    name: row.profession_name,
    type: row.profession_type,
  } : null,
  createdBy: row.created_by ? {
    _id: idString(row.created_by),
    id: idString(row.created_by),
    name: row.created_by_name,
    email: row.created_by_email,
    department: row.created_by_department,
    section: row.created_by_section,
  } : null,
  fileCount: row.file_count,
  icon: row.icon,
  category: row.category || '',
  tags: parseTags(row.tags),
  visibility: row.visibility,
  viewCount: row.view_count,
  status: row.status,
  ...extras,
  ...createdUpdated(row),
});

const serializeFile = (row, extras = {}) => row && ({
  _id: idString(row.id),
  id: idString(row.id),
  companyId: idString(row.company_id),
  name: row.name,
  originalName: row.original_name,
  size: Number(row.size || 0),
  mimeType: row.mime_type,
  extension: row.extension,
  description: row.description || '',
  knowledgePoint: row.knowledge_point_id ? {
    _id: idString(row.knowledge_point_id),
    id: idString(row.knowledge_point_id),
    name: row.knowledge_point_name,
  } : null,
  department: row.department_id ? {
    _id: idString(row.department_id),
    id: idString(row.department_id),
    name: row.department_name,
    type: row.department_type,
  } : null,
  profession: row.profession_id ? {
    _id: idString(row.profession_id),
    id: idString(row.profession_id),
    name: row.profession_name,
    type: row.profession_type,
  } : null,
  uploadedBy: row.uploaded_by ? {
    _id: idString(row.uploaded_by),
    id: idString(row.uploaded_by),
    name: row.uploaded_by_name,
    email: row.uploaded_by_email,
    department: row.uploaded_by_department,
    section: row.uploaded_by_section,
  } : null,
  currentVersion: row.current_version,
  version: row.version_label || `V${row.current_version}`,
  category: row.category || '',
  effectiveDate: formatDateOnly(row.effective_date),
  reviewDate: formatDateOnly(row.review_date),
  issuer: row.issuer || '',
  approver: row.approver || '',
  icon: row.icon || 'file-document-outline',
  color: row.color || '#1F6F8B',
  status: row.status,
  visibility: row.visibility,
  downloadCount: row.download_count,
  viewCount: row.view_count,
  tags: parseTags(row.tags),
  ...extras,
  ...createdUpdated(row),
});

const serializeCompany = (row) => row && ({
  _id: idString(row.id),
  id: idString(row.id),
  name: row.name,
  inviteCode: row.invite_code,
  emailDomains: parseTags(row.email_domains),
  status: row.status,
  ...createdUpdated(row),
});

const placeholders = (values) => values.map(() => '?').join(', ');

module.exports = {
  toId,
  idString,
  toBoolean,
  parseTags,
  firstPresent,
  clampPageSize,
  stringifyTags,
  serializePermission,
  serializeRole,
  serializeUser,
  serializeCompany,
  serializeDepartment,
  serializeKnowledgePoint,
  serializeFile,
  placeholders,
};
