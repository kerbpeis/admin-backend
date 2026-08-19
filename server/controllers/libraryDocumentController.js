const path = require('path');
const { query, withTransaction } = require('../config/db');
const { stringifyTags, toId, placeholders, firstPresent, clampPageSize } = require('../utils/mysqlUtils');
const { PERMISSIONS, hasPermission } = require('../utils/authorization');
const { recordLibraryDocumentAudit } = require('../utils/auditLog');
const { indexFileContentSafely } = require('../utils/fileContentIndex');
const answerCache = require('../utils/agentAnswerCache');
const { sendServerError } = require('../utils/serverError');
const {
  buildCompanyFilter,
  buildVisibilityFilter,
  canReadScopedResource,
  canManageScopedResource,
  ensureWritableVisibility,
  resolveDepartmentIds,
  resolveWritableTarget,
  getScopedCompanyId,
} = require('../utils/resourceAccess');

const baseDocumentSelect = `
  SELECT f.*,
    u.name AS uploaded_by_name, u.email AS uploaded_by_email, u.department AS uploaded_by_department, u.section AS uploaded_by_section,
    d.name AS department_name, d.type AS department_type, dp.name AS department_parent_name,
    p.name AS profession_name, p.type AS profession_type,
    kp.name AS knowledge_point_name
  FROM files f
  LEFT JOIN users u ON u.id = f.uploaded_by
  LEFT JOIN departments d ON d.id = f.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = f.profession_id
  LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
`;

const countDocumentSelect = `
  SELECT COUNT(*) AS total
  FROM files f
  LEFT JOIN departments d ON d.id = f.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = f.profession_id
  LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
`;

const documentStatsFrom = `
  FROM files f
  LEFT JOIN departments d ON d.id = f.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = f.profession_id
  LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
`;

const categoryGroups = {
  regulation: ['国家规程', '企业标准'],
  template: ['措施模板', '验收清单'],
  procedure: ['操作流程'],
};

const fileTypeGroups = {
  pdf: ['pdf'],
  word: ['doc', 'docx'],
  spreadsheet: ['xls', 'xlsx', 'csv'],
  presentation: ['ppt', 'pptx'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
  text: ['txt', 'md', 'json', 'log'],
  archive: ['zip', 'rar', '7z'],
};

const knownFileExtensions = Object.values(fileTypeGroups).flat();

const formatDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const formatDateTime = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
};

const normalizeDate = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const parseTags = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value).split(',').map((tag) => tag.trim()).filter(Boolean);
  }
};

const parseJsonObject = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const trimText = (value, fallback = '') => String(value ?? fallback).trim();

const firstFilled = (source, keys, fallback = null) => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
};

const hasTargetOverride = (source) => (
  ['departmentId', 'sectionId', 'department', 'section', 'professionId', 'profession']
    .some((key) => Object.prototype.hasOwnProperty.call(source, key))
);

const resolveWritableTargetFromBody = async (user, body, fallback = {}) => {
  const sectionValue = firstFilled(
    body,
    ['departmentId', 'sectionId', 'department', 'section'],
    fallback.departmentId
  );
  const professionValue = firstFilled(
    body,
    ['professionId', 'profession'],
    fallback.professionId
  );
  const requestedCompanyId = firstFilled(body, ['companyId'], fallback.companyId);
  const companyId = getScopedCompanyId(user, requestedCompanyId);
  const sectionIds = sectionValue ? await resolveDepartmentIds(sectionValue, null, companyId) : [];
  const professionIds = professionValue ? await resolveDepartmentIds(professionValue, 'profession', companyId) : [];

  return resolveWritableTarget(user, {
    departmentId: sectionIds[0] || toId(sectionValue) || null,
    professionId: professionIds[0] || toId(professionValue) || null,
    companyId,
  });
};

const buildDocumentCapabilities = (user, row) => {
  const canReadScope = canReadScopedResource(user, row, 'uploaded_by');
  const canManageScope = canManageScopedResource(user, row, 'uploaded_by');
  const canRead = canReadScope && hasPermission(user, PERMISSIONS.FILE_READ);
  const canUpdate = canManageScope && hasPermission(user, PERMISSIONS.FILE_UPDATE);
  const canDelete = canManageScope && hasPermission(user, PERMISSIONS.FILE_DELETE);
  const canUploadVersion = canManageScope && hasPermission(user, PERMISSIONS.FILE_UPDATE);
  const canManage = canUpdate || canDelete || canUploadVersion;
  const allowedActions = [
    canRead ? 'read' : null,
    canRead ? 'download' : null,
    canUpdate ? 'update' : null,
    canUploadVersion ? 'uploadVersion' : null,
    canDelete ? 'delete' : null,
  ].filter(Boolean);

  return {
    canRead,
    canDownload: canRead,
    canManage,
    canUpdate,
    canDelete,
    canUploadVersion,
    scope: {
      canRead: canReadScope,
      canManage: canManageScope,
    },
    allowedActions,
  };
};

const buildLibraryCapabilities = (user) => ({
  canRead: hasPermission(user, PERMISSIONS.FILE_READ),
  canCreate: hasPermission(user, PERMISSIONS.FILE_CREATE),
  canUpdate: hasPermission(user, PERMISSIONS.FILE_UPDATE),
  canDelete: hasPermission(user, PERMISSIONS.FILE_DELETE),
  canUploadVersion: hasPermission(user, PERMISSIONS.FILE_UPDATE),
  canPublishPublic: Boolean(user?.isAdmin),
  defaultVisibility: 'department',
  visibilityOptions: [
    user?.isAdmin ? 'public' : null,
    'department',
    'section',
    'private',
  ].filter(Boolean),
  scope: {
    isAdmin: Boolean(user?.isAdmin),
    department: user?.department || '',
    section: user?.section || '',
  },
});

const fileExtension = (fileName = '') => {
  const ext = path.extname(fileName).replace('.', '').toLowerCase();
  return ext || null;
};

const getDocumentRow = async (id) => {
  const rows = await query(`${baseDocumentSelect} WHERE f.id = ? AND f.status = 'active'`, [toId(id)]);
  return rows[0] || null;
};

const getVersionRows = async (fileId) => query(
  `SELECT fv.*, u.name AS uploaded_by_name, u.email AS uploaded_by_email
   FROM file_versions fv
   LEFT JOIN users u ON u.id = fv.uploaded_by
   WHERE fv.file_id = ?
   ORDER BY fv.version DESC`,
  [toId(fileId)]
);

const serializeVersion = (row, document = {}) => ({
  _id: String(row.id),
  id: String(row.id),
  file: String(row.file_id),
  version: row.version_label || `V${row.version}`,
  versionNumber: row.version,
  date: formatDate(row.created_at),
  note: row.change_log || '',
  size: Number(row.size || 0),
  sourceFile: {
    name: row.original_name || document.original_name || document.name,
    mimeType: row.mime_type || document.mime_type,
    size: Number(row.size || 0),
  },
  uploadedBy: row.uploaded_by ? {
    _id: String(row.uploaded_by),
    id: String(row.uploaded_by),
    name: row.uploaded_by_name,
    email: row.uploaded_by_email,
  } : null,
  createdAt: row.created_at,
});

const serializeDocument = (row, user, extras = {}) => {
  const capabilities = buildDocumentCapabilities(user, row);
  const versionLabel = row.version_label || `V${row.current_version}`;
  const owner = row.issuer || row.department_parent_name || row.profession_name || row.uploaded_by_department || '';

  return {
    _id: String(row.id),
    id: String(row.id),
    title: row.name,
    name: row.name,
    owner,
    profession: row.profession_name || row.uploaded_by_department || '',
    section: row.department_name || row.uploaded_by_section || '',
    category: row.category || row.knowledge_point_name || row.extension || '资料',
    version: versionLabel,
    versionNumber: row.current_version,
    updatedAt: formatDate(row.updated_at),
    createdAt: row.created_at,
    status: row.status === 'active' ? '已生效' : row.status,
    effectiveDate: formatDate(row.effective_date),
    reviewDate: formatDate(row.review_date),
    issuer: row.issuer || owner,
    approver: row.approver || '',
    icon: row.icon || 'file-document-outline',
    color: row.color || '#1F6F8B',
    tags: parseTags(row.tags),
    summary: row.description || '',
    description: row.description || '',
    visibility: row.visibility,
    viewCount: row.view_count,
    downloadCount: row.download_count,
    canManage: capabilities.canManage,
    canUpdate: capabilities.canUpdate,
    canDelete: capabilities.canDelete,
    canUploadVersion: capabilities.canUploadVersion,
    canDownload: capabilities.canDownload,
    capabilities,
    access: capabilities.canManage ? 'manage' : 'read',
    sourceFile: {
      name: row.original_name,
      mimeType: row.mime_type,
      size: Number(row.size || 0),
      downloadUrl: `/api/library-documents/${row.id}/download`,
    },
    uploadedBy: row.uploaded_by ? {
      _id: String(row.uploaded_by),
      id: String(row.uploaded_by),
      name: row.uploaded_by_name,
      email: row.uploaded_by_email,
      department: row.uploaded_by_department,
      section: row.uploaded_by_section,
    } : null,
    ...extras,
  };
};

const buildDocumentFilters = async (req) => {
  const {
    access = 'all',
    category,
    department,
    departmentId,
    fileType,
    profession,
    professionId,
    review,
    search,
    section,
    sectionId,
    status,
    updated,
  } = req.query;

  const filters = [`f.status = 'active'`];
  const params = [];

  const companyFilter = buildCompanyFilter(req.user, 'f', { requestedCompanyId: req.query.companyId });
  filters.push(companyFilter.sql);
  params.push(...companyFilter.params);

  const visibilityFilter = await buildVisibilityFilter(req.user, 'f', 'uploaded_by');
  filters.push(visibilityFilter.sql);
  params.push(...visibilityFilter.params);
  const companyId = getScopedCompanyId(req.user, req.query.companyId);

  const sectionValue = [sectionId, section, departmentId, department].find((value) => value && value !== 'all');
  if (sectionValue) {
    const ids = await resolveDepartmentIds(sectionValue, null, companyId);
    filters.push(`f.department_id IN (${placeholders(ids.length ? ids : [0])})`);
    params.push(...(ids.length ? ids : [0]));
  }

  const professionValue = [professionId, profession].find((value) => value && value !== 'all');
  if (professionValue) {
    const ids = await resolveDepartmentIds(professionValue, 'profession', companyId);
    filters.push(`f.profession_id IN (${placeholders(ids.length ? ids : [0])})`);
    params.push(...(ids.length ? ids : [0]));
  }

  if (category && category !== 'all') {
    const categories = categoryGroups[category] || [category];
    filters.push(`COALESCE(f.category, '') IN (${placeholders(categories)})`);
    params.push(...categories);
  }

  if (status && status !== 'all') {
    if (['effective', 'active'].includes(status)) {
      filters.push(`f.status = 'active'`);
    } else if (['pending', 'inactive'].includes(status)) {
      filters.push('1 = 0');
    }
  }

  if (fileType && fileType !== 'all') {
    const extensions = fileTypeGroups[fileType];
    if (extensions) {
      filters.push(`LOWER(COALESCE(f.extension, '')) IN (${placeholders(extensions)})`);
      params.push(...extensions);
    } else if (fileType === 'other') {
      filters.push(`(f.extension IS NULL OR LOWER(COALESCE(f.extension, '')) NOT IN (${placeholders(knownFileExtensions)}))`);
      params.push(...knownFileExtensions);
    }
  }

  if (updated && updated !== 'all') {
    const ranges = {
      '30d': 30,
      '90d': 90,
      year: 365,
    };
    const days = ranges[updated];
    if (days) {
      filters.push(`f.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`);
      params.push(days);
    }
  }

  if (review && review !== 'all') {
    if (review === 'due') {
      filters.push(`f.review_date IS NOT NULL AND f.review_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)`);
    } else if (review === 'overdue') {
      filters.push(`f.review_date IS NOT NULL AND f.review_date < CURDATE()`);
    } else if (review === 'current') {
      filters.push(`(f.review_date IS NULL OR f.review_date > DATE_ADD(CURDATE(), INTERVAL 60 DAY))`);
    } else if (review === 'none') {
      filters.push(`f.review_date IS NULL`);
    }
  }

  if (access === 'manage' && !req.user.isAdmin) {
    filters.push('(f.uploaded_by = ? OR d.name = ?)');
    params.push(toId(req.user.id), req.user.section || '');
  } else if (access === 'read' && !req.user.isAdmin) {
    filters.push('NOT (f.uploaded_by = ? OR d.name = ?)');
    params.push(toId(req.user.id), req.user.section || '');
  }

  if (search) {
    filters.push(`(
      f.name LIKE ?
      OR f.description LIKE ?
      OR f.tags LIKE ?
      OR f.category LIKE ?
      OR f.issuer LIKE ?
      OR f.approver LIKE ?
      OR d.name LIKE ?
      OR p.name LIKE ?
      OR f.id IN (SELECT file_id FROM file_content_chunks WHERE content LIKE ?)
    )`);
    const keyword = `%${search}%`;
    params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
  }

  return { where: `WHERE ${filters.join(' AND ')}`, params };
};

const serializeDistributionRow = (row) => ({
  key: row.key || 'unknown',
  label: row.label || '未归属',
  total: Number(row.total || 0),
  downloadCount: Number(row.download_count || 0),
  viewCount: Number(row.view_count || 0),
});

const serializeRecentActivity = (row) => ({
  _id: String(row.id),
  id: String(row.id),
  action: row.action,
  status: row.audit_status,
  resourceId: row.resource_id,
  resourceName: row.resource_name || row.document_name,
  metadata: parseJsonObject(row.metadata),
  actor: row.actor_id ? {
    _id: String(row.actor_id),
    id: String(row.actor_id),
    name: row.actor_name,
    email: row.actor_email,
    department: row.actor_department,
    section: row.actor_section,
  } : null,
  createdAt: formatDateTime(row.created_at),
});

exports.getLibraryDocuments = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page || '1', 10), 1);
    const limit = clampPageSize(req.query.limit);
    const { sort = 'title', sortBy = sort, sortOrder = 'asc' } = req.query;
    const sortable = {
      title: 'f.name',
      name: 'f.name',
      category: 'f.category',
      updatedAt: 'f.updated_at',
      effectiveDate: 'f.effective_date',
      reviewDate: 'f.review_date',
      version: 'f.current_version',
    };
    const sortColumn = sortable[sortBy] || 'f.name';
    const direction = sortOrder === 'desc' ? 'DESC' : 'ASC';
    const { where, params } = await buildDocumentFilters(req);

    const countRows = await query(`${countDocumentSelect} ${where}`, params);
    const total = Number(countRows[0]?.total || 0);
    const rows = await query(
      `${baseDocumentSelect}
       ${where}
       ORDER BY ${sortColumn} ${direction}, f.id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );

    res.json({
      documents: rows.map((row) => serializeDocument(row, req.user)),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '获取资料清单失败');
  }
};

exports.getLibraryDocumentAccess = async (req, res) => {
  res.json({
    capabilities: buildLibraryCapabilities(req.user),
  });
};

exports.getLibraryDocumentStats = async (req, res) => {
  try {
    const { where, params } = await buildDocumentFilters(req);
    const recentLimit = Math.min(clampPageSize(req.query.recentLimit || 5), 20);
    const activityLimit = Math.min(clampPageSize(req.query.activityLimit || 8), 20);
    const canManageAny = hasPermission(req.user, PERMISSIONS.FILE_UPDATE)
      || hasPermission(req.user, PERMISSIONS.FILE_DELETE);
    const manageScopeSql = req.user.isAdmin
      ? '1 = 1'
      : '(f.uploaded_by = ? OR d.name = ?)';
    const manageScopeParams = req.user.isAdmin ? [] : [toId(req.user.id), req.user.section || ''];

    const [summaryRows, manageableRows, versionRows, categoryRows, professionRows, sectionRows, recentRows, activityRows] = await Promise.all([
      query(
        `SELECT
          COUNT(*) AS total,
          COALESCE(SUM(f.download_count), 0) AS download_count,
          COALESCE(SUM(f.view_count), 0) AS view_count,
          COALESCE(SUM(CASE WHEN f.updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) AS updated_last_30_days,
          COALESCE(SUM(CASE WHEN f.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) AS created_last_30_days,
          COALESCE(SUM(CASE WHEN f.review_date IS NOT NULL AND f.review_date < CURDATE() THEN 1 ELSE 0 END), 0) AS review_overdue,
          COALESCE(SUM(CASE WHEN f.review_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END), 0) AS review_due_soon
         ${documentStatsFrom}
         ${where}`,
        params
      ),
      canManageAny
        ? query(
          `SELECT COUNT(*) AS total
           ${documentStatsFrom}
           ${where} AND ${manageScopeSql}`,
          [...params, ...manageScopeParams]
        )
        : Promise.resolve([{ total: 0 }]),
      query(
        `SELECT COUNT(fv.id) AS total
         FROM file_versions fv
         INNER JOIN files f ON f.id = fv.file_id
         LEFT JOIN departments d ON d.id = f.department_id
         LEFT JOIN departments dp ON dp.id = d.parent_department_id
         LEFT JOIN departments p ON p.id = f.profession_id
         LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
         ${where}`,
        params
      ),
      query(
        `SELECT
          COALESCE(f.category, '资料') AS \`key\`,
          COALESCE(f.category, '资料') AS label,
          COUNT(*) AS total,
          COALESCE(SUM(f.download_count), 0) AS download_count,
          COALESCE(SUM(f.view_count), 0) AS view_count
         ${documentStatsFrom}
         ${where}
         GROUP BY COALESCE(f.category, '资料')
         ORDER BY total DESC, label ASC`,
        params
      ),
      query(
        `SELECT
          COALESCE(p.name, '未归属专业') AS \`key\`,
          COALESCE(p.name, '未归属专业') AS label,
          COUNT(*) AS total,
          COALESCE(SUM(f.download_count), 0) AS download_count,
          COALESCE(SUM(f.view_count), 0) AS view_count
         ${documentStatsFrom}
         ${where}
         GROUP BY COALESCE(p.name, '未归属专业')
         ORDER BY total DESC, label ASC`,
        params
      ),
      query(
        `SELECT
          COALESCE(d.name, '未归属科室') AS \`key\`,
          COALESCE(d.name, '未归属科室') AS label,
          COUNT(*) AS total,
          COALESCE(SUM(f.download_count), 0) AS download_count,
          COALESCE(SUM(f.view_count), 0) AS view_count
         ${documentStatsFrom}
         ${where}
         GROUP BY COALESCE(d.name, '未归属科室')
         ORDER BY total DESC, label ASC`,
        params
      ),
      query(
        `${baseDocumentSelect}
         ${where}
         ORDER BY f.updated_at DESC, f.id DESC
         LIMIT ?`,
        [...params, recentLimit]
      ),
      query(
        `SELECT al.*, al.status AS audit_status,
          u.name AS actor_name, u.email AS actor_email, u.department AS actor_department, u.section AS actor_section,
          f.name AS document_name
         FROM audit_logs al
         INNER JOIN files f ON f.id = CAST(al.resource_id AS UNSIGNED)
         LEFT JOIN users u ON u.id = al.actor_id
         LEFT JOIN departments d ON d.id = f.department_id
         LEFT JOIN departments dp ON dp.id = d.parent_department_id
         LEFT JOIN departments p ON p.id = f.profession_id
         LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
         ${where} AND al.resource_type = 'library_document'
         ORDER BY al.created_at DESC, al.id DESC
         LIMIT ?`,
        [...params, activityLimit]
      ),
    ]);

    const summary = summaryRows[0] || {};
    res.json({
      summary: {
        totalDocuments: Number(summary.total || 0),
        manageableDocuments: Number(manageableRows[0]?.total || 0),
        totalVersions: Number(versionRows[0]?.total || 0),
        totalDownloads: Number(summary.download_count || 0),
        totalViews: Number(summary.view_count || 0),
        updatedLast30Days: Number(summary.updated_last_30_days || 0),
        createdLast30Days: Number(summary.created_last_30_days || 0),
        reviewOverdue: Number(summary.review_overdue || 0),
        reviewDueSoon: Number(summary.review_due_soon || 0),
      },
      distributions: {
        byCategory: categoryRows.map(serializeDistributionRow),
        byProfession: professionRows.map(serializeDistributionRow),
        bySection: sectionRows.map(serializeDistributionRow),
      },
      recentDocuments: recentRows.map((row) => serializeDocument(row, req.user)),
      recentActivities: activityRows.map(serializeRecentActivity),
      capabilities: buildLibraryCapabilities(req.user),
    });
  } catch (err) {
    sendServerError(res, err, '获取资料库统计失败');
  }
};

exports.getLibraryDocument = async (req, res) => {
  try {
    const document = await getDocumentRow(req.params.id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    if (!canReadScopedResource(req.user, document, 'uploaded_by')) {
      await recordLibraryDocumentAudit(req, 'library_document.view', document, {
        status: 'denied',
        metadata: { reason: 'scope_denied' },
      });
      return res.status(403).json({ message: '没有权限查看此资料' });
    }

    await query('UPDATE files SET view_count = view_count + 1 WHERE id = ?', [document.id]);
    await recordLibraryDocumentAudit(req, 'library_document.view', document, {
      metadata: { viewCount: Number(document.view_count || 0) + 1 },
    });
    const versions = await getVersionRows(document.id);

    res.json(serializeDocument(
      { ...document, view_count: document.view_count + 1 },
      req.user,
      { versionHistory: versions.map((version) => serializeVersion(version, document)) }
    ));
  } catch (err) {
    sendServerError(res, err, '获取资料详情失败');
  }
};

exports.createLibraryDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择资料源文件' });
    }

    const {
      visibility = 'department',
    } = req.body;
    const title = trimText(firstPresent(req.body, ['title', 'name'], req.file.originalname));
    const versionLabel = trimText(firstPresent(req.body, ['versionLabel', 'version'], 'V1'), 'V1') || 'V1';
    const description = trimText(firstPresent(req.body, ['summary', 'description'], ''));
    const changeLog = trimText(firstPresent(req.body, ['note', 'changeLog'], '初始版本'), '初始版本') || '初始版本';
    const visibilityCheck = ensureWritableVisibility(req.user, visibility);

    if (!title) {
      return res.status(400).json({ message: '资料名称不能为空' });
    }

    if (!visibilityCheck.ok) {
      await recordLibraryDocumentAudit(req, 'library_document.create', { name: title }, {
        status: 'denied',
        metadata: { reason: visibilityCheck.message, visibility },
      });
      return res.status(403).json({ message: visibilityCheck.message });
    }

    const target = await resolveWritableTargetFromBody(req.user, req.body);
    if (!target.ok) {
      await recordLibraryDocumentAudit(req, 'library_document.create', { name: title }, {
        status: 'denied',
        metadata: { reason: target.message },
      });
      return res.status(403).json({ message: target.message });
    }

    const insertedId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO files
         (company_id, name, original_name, path, size, mime_type, extension, description, category, department_id, profession_id,
          uploaded_by, current_version, version_label, visibility, tags, effective_date, review_date, issuer, approver, icon, color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          target.companyId,
          title,
          req.file.originalname,
          req.file.path,
          req.file.size,
          req.file.mimetype,
          fileExtension(req.file.originalname),
          description,
          firstPresent(req.body, ['category'], null),
          target.departmentId,
          target.professionId,
          toId(req.user.id),
          versionLabel,
          visibilityCheck.visibility,
          stringifyTags(req.body.tags),
          normalizeDate(req.body.effectiveDate),
          normalizeDate(req.body.reviewDate),
          firstPresent(req.body, ['issuer'], null),
          firstPresent(req.body, ['approver'], null),
          firstPresent(req.body, ['icon'], 'file-document-outline'),
          firstPresent(req.body, ['color'], '#1F6F8B'),
        ]
      );

      await connection.execute(
        `INSERT INTO file_versions
         (file_id, version, version_label, path, size, original_name, mime_type, uploaded_by, change_log)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, versionLabel, req.file.path, req.file.size, req.file.originalname, req.file.mimetype, toId(req.user.id), changeLog]
      );

      return result.insertId;
    });

    await indexFileContentSafely(insertedId, req.file.path, fileExtension(req.file.originalname));

    const createdDocument = await getDocumentRow(insertedId);
    await recordLibraryDocumentAudit(req, 'library_document.create', createdDocument, {
      metadata: {
        versionLabel,
        visibility: visibilityCheck.visibility,
        fileName: req.file.originalname,
        size: req.file.size,
      },
    });

    res.status(201).json({
      message: '资料创建成功',
      document: serializeDocument(createdDocument, req.user),
    });
    answerCache.flushCompany(req.user.companyId);
  } catch (err) {
    sendServerError(res, err, '创建资料失败');
  }
};

exports.updateLibraryDocument = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const document = await getDocumentRow(id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    if (!canManageScopedResource(req.user, document, 'uploaded_by')) {
      await recordLibraryDocumentAudit(req, 'library_document.update', document, {
        status: 'denied',
        metadata: { reason: 'scope_denied' },
      });
      return res.status(403).json({ message: '没有权限编辑此资料' });
    }

    const visibilityCheck = ensureWritableVisibility(req.user, req.body.visibility || document.visibility);
    if (!visibilityCheck.ok) {
      await recordLibraryDocumentAudit(req, 'library_document.update', document, {
        status: 'denied',
        metadata: { reason: visibilityCheck.message, visibility: req.body.visibility },
      });
      return res.status(403).json({ message: visibilityCheck.message });
    }

    const nextTitle = trimText(firstPresent(req.body, ['title', 'name'], document.name));
    if (!nextTitle) {
      return res.status(400).json({ message: '资料名称不能为空' });
    }

    let target = { ok: true, departmentId: document.department_id, professionId: document.profession_id };
    if (hasTargetOverride(req.body)) {
      target = await resolveWritableTargetFromBody(req.user, req.body, {
        departmentId: document.department_id,
        professionId: document.profession_id,
      });
      if (!target.ok) {
        await recordLibraryDocumentAudit(req, 'library_document.update', document, {
          status: 'denied',
          metadata: { reason: target.message },
        });
        return res.status(403).json({ message: target.message });
      }
    }

    await query(
      `UPDATE files
       SET name = ?, description = ?, category = ?, department_id = ?, profession_id = ?, visibility = ?,
           tags = ?, effective_date = ?, review_date = ?, issuer = ?, approver = ?, icon = ?, color = ?
       WHERE id = ?`,
      [
        nextTitle,
        trimText(firstPresent(req.body, ['summary', 'description'], document.description || '')),
        firstPresent(req.body, ['category'], document.category),
        target.departmentId,
        target.professionId,
        visibilityCheck.visibility,
        Object.prototype.hasOwnProperty.call(req.body, 'tags') ? stringifyTags(req.body.tags) : document.tags,
        Object.prototype.hasOwnProperty.call(req.body, 'effectiveDate') ? normalizeDate(req.body.effectiveDate) : formatDate(document.effective_date),
        Object.prototype.hasOwnProperty.call(req.body, 'reviewDate') ? normalizeDate(req.body.reviewDate) : formatDate(document.review_date),
        firstPresent(req.body, ['issuer'], document.issuer),
        firstPresent(req.body, ['approver'], document.approver),
        firstPresent(req.body, ['icon'], document.icon),
        firstPresent(req.body, ['color'], document.color),
        id,
      ]
    );

    const updatedDocument = await getDocumentRow(id);
    await recordLibraryDocumentAudit(req, 'library_document.update', updatedDocument, {
      metadata: {
        changedFields: Object.keys(req.body || {}),
        previous: {
          title: document.name,
          category: document.category,
          departmentId: document.department_id,
          professionId: document.profession_id,
          visibility: document.visibility,
        },
      },
    });

    res.json({
      message: '资料更新成功',
      document: serializeDocument(updatedDocument, req.user),
    });
  } catch (err) {
    sendServerError(res, err, '更新资料失败');
  }
};

exports.deleteLibraryDocument = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const document = await getDocumentRow(id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    if (!canManageScopedResource(req.user, document, 'uploaded_by')) {
      await recordLibraryDocumentAudit(req, 'library_document.delete', document, {
        status: 'denied',
        metadata: { reason: 'scope_denied' },
      });
      return res.status(403).json({ message: '没有权限删除此资料' });
    }

    await query(`UPDATE files SET status = 'deleted' WHERE id = ?`, [id]);
    await recordLibraryDocumentAudit(req, 'library_document.delete', document);
    res.json({ message: '资料删除成功' });
    answerCache.flushCompany(req.user.companyId);
  } catch (err) {
    sendServerError(res, err, '删除资料失败');
  }
};

exports.getLibraryDocumentCapabilities = async (req, res) => {
  try {
    const document = await getDocumentRow(req.params.id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    const capabilities = buildDocumentCapabilities(req.user, document);
    if (!capabilities.canRead) {
      return res.status(403).json({ message: '没有权限查看此资料' });
    }

    res.json({
      documentId: String(document.id),
      capabilities,
    });
  } catch (err) {
    sendServerError(res, err, '获取资料权限失败');
  }
};

exports.getLibraryDocumentVersions = async (req, res) => {
  try {
    const document = await getDocumentRow(req.params.id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    if (!canReadScopedResource(req.user, document, 'uploaded_by')) {
      await recordLibraryDocumentAudit(req, 'library_document.version_list', document, {
        status: 'denied',
        metadata: { reason: 'scope_denied' },
      });
      return res.status(403).json({ message: '没有权限查看此资料版本' });
    }

    const versions = await getVersionRows(document.id);
    await recordLibraryDocumentAudit(req, 'library_document.version_list', document, {
      metadata: { versionCount: versions.length },
    });
    res.json({ versions: versions.map((version) => serializeVersion(version, document)) });
  } catch (err) {
    sendServerError(res, err, '获取资料版本失败');
  }
};

exports.uploadLibraryDocumentVersion = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择新版本文件' });
    }

    const id = toId(req.params.id);
    const document = await getDocumentRow(id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    if (!canManageScopedResource(req.user, document, 'uploaded_by')) {
      await recordLibraryDocumentAudit(req, 'library_document.version_upload', document, {
        status: 'denied',
        metadata: { reason: 'scope_denied' },
      });
      return res.status(403).json({ message: '没有权限上传新版本' });
    }

    const nextVersion = Number(document.current_version || 1) + 1;
    const versionLabel = firstPresent(req.body, ['versionLabel', 'version'], `V${nextVersion}`);
    const changeLog = firstPresent(req.body, ['note', 'changeLog'], `发布 ${versionLabel}`);

    const versionId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO file_versions
         (file_id, version, version_label, path, size, original_name, mime_type, uploaded_by, change_log)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, nextVersion, versionLabel, req.file.path, req.file.size, req.file.originalname, req.file.mimetype, toId(req.user.id), changeLog]
      );

      await connection.execute(
        `UPDATE files
         SET path = ?, size = ?, original_name = ?, mime_type = ?, extension = ?, current_version = ?, version_label = ?
         WHERE id = ?`,
        [req.file.path, req.file.size, req.file.originalname, req.file.mimetype, fileExtension(req.file.originalname), nextVersion, versionLabel, id]
      );

      return result.insertId;
    });

    await indexFileContentSafely(id, req.file.path, fileExtension(req.file.originalname));

    const versionRows = await query(
      `SELECT fv.*, u.name AS uploaded_by_name, u.email AS uploaded_by_email
       FROM file_versions fv
       LEFT JOIN users u ON u.id = fv.uploaded_by
       WHERE fv.id = ?`,
      [versionId]
    );

    const updatedDocument = await getDocumentRow(id);
    await recordLibraryDocumentAudit(req, 'library_document.version_upload', updatedDocument, {
      metadata: {
        versionLabel,
        versionNumber: nextVersion,
        fileName: req.file.originalname,
        size: req.file.size,
      },
    });

    res.json({
      message: '新版本发布成功',
      version: serializeVersion(versionRows[0], document),
      document: serializeDocument(updatedDocument, req.user),
    });
    answerCache.flushCompany(req.user.companyId);
  } catch (err) {
    sendServerError(res, err, '上传资料新版本失败');
  }
};

exports.getLibraryDocumentDownload = async (req, res) => {
  try {
    const document = await getDocumentRow(req.params.id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    if (!canReadScopedResource(req.user, document, 'uploaded_by')) {
      await recordLibraryDocumentAudit(req, 'library_document.download_link', document, {
        status: 'denied',
        metadata: { reason: 'scope_denied' },
      });
      return res.status(403).json({ message: '没有权限下载此资料' });
    }

    await query('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [document.id]);
    await recordLibraryDocumentAudit(req, 'library_document.download_link', document, {
      metadata: { downloadCount: Number(document.download_count || 0) + 1 },
    });
    res.json({
      downloadUrl: `/api/library-documents/${document.id}/download/content`,
      file: {
        _id: String(document.id),
        id: String(document.id),
        name: document.original_name,
        size: Number(document.size || 0),
        mimeType: document.mime_type,
      },
    });
  } catch (err) {
    sendServerError(res, err, '生成资料下载地址失败');
  }
};

exports.downloadLibraryDocumentContent = async (req, res) => {
  try {
    const document = await getDocumentRow(req.params.id);
    if (!document) {
      return res.status(404).json({ message: '资料不存在' });
    }

    if (!canReadScopedResource(req.user, document, 'uploaded_by')) {
      await recordLibraryDocumentAudit(req, 'library_document.download_content', document, {
        status: 'denied',
        metadata: { reason: 'scope_denied' },
      });
      return res.status(403).json({ message: '没有权限下载此资料' });
    }

    await query('UPDATE files SET download_count = download_count + 1 WHERE id = ?', [document.id]);
    await recordLibraryDocumentAudit(req, 'library_document.download_content', document, {
      metadata: {
        fileName: document.original_name,
        downloadCount: Number(document.download_count || 0) + 1,
      },
    });
    return res.download(document.path, document.original_name);
  } catch (err) {
    sendServerError(res, err, '下载资料失败');
  }
};
