const fs = require('fs/promises');
const path = require('path');
const { query, withTransaction } = require('../config/db');
const { PERMISSIONS, hasPermission } = require('../utils/authorization');
const { recordAuditLog } = require('../utils/auditLog');
const { getScopedCompanyId, getUserCompanyId, resolveDepartmentIds } = require('../utils/resourceAccess');
const { stringifyTags } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');

const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;
const MAX_BOOKMARKS = 100;
const MAX_FOLDERS = 300;
const MAX_ITEMS = 1000;
const MAX_READING_HISTORY = 50;
const MAX_DOWNLOAD_HISTORY = 80;
const MAX_ACTIVITY_HISTORY = 100;
const MAX_AGENT_INTERACTIONS = 100;
const MAX_AGENT_INTERACTION_BYTES = 200 * 1024;
const MAX_SHARE_REQUEST_BYTES = 160 * 1024;
const MAX_LEARNING_PROGRESS = 200;
const MAX_LEARNING_PROGRESS_BYTES = 240 * 1024;
const SHARE_REQUEST_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const LEARNING_STATUSES = new Set(['not_started', 'in_progress', 'completed', 'review_due']);

const ACTIVITY_ACTION_LABELS = {
  'library_document.create': '上传资料',
  'library_document.create_from_private_share': '共享入库',
  'library_document.view': '查看资料',
  'library_document.update': '更新资料',
  'library_document.version_upload': '上传新版本',
  'library_document.version_list': '查看版本记录',
  'library_document.download_link': '准备下载',
  'library_document.download_content': '下载资料',
  'library_document.delete': '删除资料',
  'private_share_request.create': '提交共享申请',
  'private_share_request.approved': '通过共享申请',
  'private_share_request.rejected': '拒绝共享申请',
  'private_share_request.cancelled': '取消共享申请',
};

const ACTIVITY_RESOURCE_LABELS = {
  library_document: '资料库',
  private_share_request: '共享申请',
};

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const limitString = (value, maxLength, fallback = '') => {
  if (value == null || value === '') return fallback;
  return String(value).slice(0, maxLength);
};

const normalizeLocalId = (value, prefix, index = 0) => (
  limitString(value, 120, `${prefix}-${index + 1}`)
    .replace(/[^\w:\-\u4e00-\u9fa5]/g, '-')
    .slice(0, 120)
);

const toJson = (value, fallback = []) => JSON.stringify(value == null ? fallback : value);

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const countPayloadBytes = (payload) => Buffer.byteLength(JSON.stringify(payload || {}), 'utf8');

const assertWorkspaceSize = (payload) => {
  if (countPayloadBytes(payload) > MAX_WORKSPACE_BYTES) {
    const error = new Error('个人知识空间数据过大，请清理后重试');
    error.status = 413;
    throw error;
  }
};

const assertAgentInteractionSize = (payload) => {
  if (countPayloadBytes(payload) > MAX_AGENT_INTERACTION_BYTES) {
    const error = new Error('智能体历史记录过大，请精简后重试');
    error.status = 413;
    throw error;
  }
};

const assertShareRequestSize = (payload) => {
  if (countPayloadBytes(payload) > MAX_SHARE_REQUEST_BYTES) {
    const error = new Error('共享申请内容过大，请精简后重试');
    error.status = 413;
    throw error;
  }
};

const assertLearningProgressSize = (payload) => {
  if (countPayloadBytes(payload) > MAX_LEARNING_PROGRESS_BYTES) {
    const error = new Error('学习进度数据过大，请精简后重试');
    error.status = 413;
    throw error;
  }
};

const clampPercent = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed, 100));
};

const sanitizeFilePart = (value, fallback = 'private-share') => {
  const cleaned = limitString(value, 80, fallback)
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
};

const uniqueStrings = (values = []) => Array.from(new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
));

const markdownLine = (label, value) => {
  const text = String(value || '').trim();
  return text ? `- ${label}: ${text}` : null;
};

const buildPromotedDocumentContent = (shareRequest, reviewer) => {
  const payload = parseJson(shareRequest.payload, {});
  const item = payload.item || {};
  const target = payload.target || {};
  const reason = shareRequest.reason || payload.reason || '';
  const summary = item.summary || item.description || item.excerpt || '';
  const body = item.content || item.note || item.body || '';
  const snapshot = JSON.stringify({
    item,
    target,
    reason,
  }, null, 2).replace(/```/g, '` ` `');

  const sections = [
    `# ${shareRequest.title}`,
    [
      markdownLine('来源', shareRequest.source_title || item.sourceTitle),
      markdownLine('资料类型', shareRequest.item_type || item.type),
      markdownLine('目标专业', shareRequest.target_profession || target.profession),
      markdownLine('目标科室', shareRequest.target_section || target.section),
      markdownLine('资料分类', shareRequest.target_category || target.category),
      markdownLine('申请人', payload.createdBy?.name),
      markdownLine('审核人', reviewer?.name),
      markdownLine('审核时间', new Date().toISOString()),
    ].filter(Boolean).join('\n'),
    reason ? `## 共享理由\n\n${reason}` : null,
    summary ? `## 摘要\n\n${summary}` : null,
    body ? `## 内容\n\n${body}` : null,
    `## 申请快照\n\n\`\`\`json\n${snapshot}\n\`\`\``,
  ];

  return sections.filter(Boolean).join('\n\n');
};

const resolveShareTargetIds = async (shareRequest, companyId) => {
  const payload = parseJson(shareRequest.payload, {});
  const target = payload.target || {};
  const sectionName = shareRequest.target_section || target.section;
  const professionName = shareRequest.target_profession || target.profession;
  const sectionIds = sectionName ? await resolveDepartmentIds(sectionName, null, companyId) : [];
  let professionIds = professionName ? await resolveDepartmentIds(professionName, 'profession', companyId) : [];
  if (!professionIds.length && professionName) {
    professionIds = await resolveDepartmentIds(professionName, null, companyId);
  }

  return {
    departmentId: sectionIds[0] || null,
    professionId: professionIds[0] || null,
  };
};

const writePromotedShareFile = async (shareRequest, reviewer) => {
  const dateDir = new Date().toISOString().slice(0, 10);
  const uploadDir = path.join(__dirname, '..', 'uploads', 'private-share', dateDir);
  const slug = sanitizeFilePart(shareRequest.title, 'private-share');
  const fileName = `${shareRequest.id}-${Date.now()}-${slug}.md`;
  const filePath = path.join(uploadDir, fileName);
  const content = buildPromotedDocumentContent(shareRequest, reviewer);

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');

  return {
    filePath,
    originalName: limitString(`${slug}.md`, 255, 'private-share.md'),
    size: Buffer.byteLength(content, 'utf8'),
  };
};

const promoteShareRequestToLibraryDocument = async (connection, req, shareRequest, reviewNote) => {
  if (shareRequest.promoted_file_id) {
    await connection.execute(
      `UPDATE private_share_requests
       SET status = 'approved', reviewer_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id, reviewNote, shareRequest.id]
    );
    return { promotedFileId: shareRequest.promoted_file_id, filePath: null, reused: true };
  }

  let writtenFile = null;
  try {
    const payload = parseJson(shareRequest.payload, {});
    const item = payload.item || {};
    const target = payload.target || {};
    const targetCategory = limitString(shareRequest.target_category || target.category || item.category || '个人共享', 100, '个人共享');
    const requesterRows = await connection.execute('SELECT company_id FROM users WHERE id = ? LIMIT 1', [shareRequest.user_id]);
    const companyId = getScopedCompanyId(req.user, requesterRows[0][0]?.company_id);
    const targetIds = await resolveShareTargetIds(shareRequest, companyId);
    const tags = uniqueStrings([
      ...toArray(item.tags),
      targetCategory,
      '个人共享',
    ]).slice(0, 20);
    const description = limitString(
      [
        item.summary || item.description || '',
        shareRequest.reason ? `共享理由：${shareRequest.reason}` : '',
      ].filter(Boolean).join('\n\n'),
      4000,
      '个人资料共享申请晋级生成'
    );
    writtenFile = await writePromotedShareFile(shareRequest, req.user);
    const visibility = targetIds.departmentId ? 'section' : 'department';
    const issuer = limitString(shareRequest.source_title || item.sourceTitle || '个人资料共享', 100, '个人资料共享');

    const [fileResult] = await connection.execute(
      `INSERT INTO files
       (company_id, name, original_name, path, size, mime_type, extension, description, category, department_id, profession_id,
        uploaded_by, current_version, version_label, visibility, tags, issuer, approver, icon, color)
       VALUES (?, ?, ?, ?, ?, 'text/markdown', 'md', ?, ?, ?, ?, ?, 1, 'V1', ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        shareRequest.title,
        writtenFile.originalName,
        writtenFile.filePath,
        writtenFile.size,
        description,
        targetCategory,
        targetIds.departmentId,
        targetIds.professionId,
        shareRequest.user_id,
        visibility,
        stringifyTags(tags),
        issuer,
        limitString(req.user.name, 100, null),
        limitString(item.icon, 80, item.type === 'note' ? 'note-text-outline' : 'file-document-outline'),
        limitString(item.color, 24, '#1F6F8B'),
      ]
    );

    await connection.execute(
      `INSERT INTO file_versions
       (file_id, version, version_label, path, size, original_name, mime_type, uploaded_by, change_log)
       VALUES (?, 1, 'V1', ?, ?, ?, 'text/markdown', ?, ?)`,
      [
        fileResult.insertId,
        writtenFile.filePath,
        writtenFile.size,
        writtenFile.originalName,
        req.user.id,
        limitString(reviewNote, 4000, '共享申请审核通过，生成初始版本') || '共享申请审核通过，生成初始版本',
      ]
    );

    await connection.execute(
      `UPDATE private_share_requests
       SET status = 'approved', reviewer_id = ?, promoted_file_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id, fileResult.insertId, reviewNote, shareRequest.id]
    );

    await recordAuditLog({
      req,
      connection,
      action: 'library_document.create_from_private_share',
      resourceType: 'library_document',
      resourceId: fileResult.insertId,
      resourceName: shareRequest.title,
      metadata: {
        shareRequestId: String(shareRequest.id),
        targetCategory,
        targetDepartmentId: targetIds.departmentId,
        targetProfessionId: targetIds.professionId,
      },
    });

    return { promotedFileId: fileResult.insertId, filePath: writtenFile.filePath, reused: false };
  } catch (error) {
    if (writtenFile?.filePath) {
      await fs.unlink(writtenFile.filePath).catch(() => {});
    }
    throw error;
  }
};

const deleteMissingRows = async (connection, tableName, userId, ids) => {
  if (!ids.length) {
    await connection.query(`DELETE FROM ${tableName} WHERE user_id = ?`, [userId]);
    return;
  }

  const placeholders = ids.map(() => '?').join(',');
  await connection.query(
    `DELETE FROM ${tableName} WHERE user_id = ? AND local_id NOT IN (${placeholders})`,
    [userId, ...ids]
  );
};

const serializeBookmark = (row) => ({
  ...parseJson(row.payload, {}),
  id: row.local_id,
  name: row.name,
  icon: row.icon,
  color: row.color,
  system: Boolean(Number(row.is_system)),
  createdAt: parseJson(row.payload, {})?.createdAt || row.source_created_at || row.created_at,
  updatedAt: parseJson(row.payload, {})?.updatedAt || row.source_updated_at || row.updated_at,
});

const serializeFolder = (row) => ({
  ...parseJson(row.payload, {}),
  id: row.local_id,
  bookmarkId: row.bookmark_local_id,
  name: row.name,
  createdAt: parseJson(row.payload, {})?.createdAt || row.source_created_at || row.created_at,
  updatedAt: parseJson(row.payload, {})?.updatedAt || row.source_updated_at || row.updated_at,
});

const serializeKnowledgeItem = (row) => ({
  ...parseJson(row.payload, {}),
  id: row.local_id,
  type: row.type,
  title: row.title,
  sourceTitle: row.source_title || undefined,
  referenceKind: row.reference_kind || undefined,
  documentId: row.document_id || undefined,
  groupId: row.group_id || undefined,
  fileId: row.file_id || undefined,
  bookmarkIds: toArray(parseJson(row.bookmark_ids, [])),
  folderIds: toArray(parseJson(row.folder_ids, [])),
  tags: toArray(parseJson(row.tags, [])),
  pinned: Boolean(Number(row.pinned)),
  createdAt: parseJson(row.payload, {})?.createdAt || row.source_created_at || row.created_at,
  updatedAt: parseJson(row.payload, {})?.updatedAt || row.source_updated_at || row.updated_at,
});

const serializeReadingRecord = (row) => ({
  ...parseJson(row.payload, {}),
  id: row.local_id,
  title: row.title,
  owner: row.owner || undefined,
  category: row.category || undefined,
  openedAt: row.opened_at || parseJson(row.payload, {})?.openedAt || undefined,
  page: row.progress_page ?? parseJson(row.payload, {})?.page,
  totalPages: row.progress_total_pages ?? parseJson(row.payload, {})?.totalPages,
});

const isDueDate = (value) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now();
};

const serializeLearningProgress = (row) => {
  const payload = parseJson(row.payload, {});
  const reviewAt = row.review_at || payload?.reviewAt || undefined;
  const status = row.status === 'completed' && isDueDate(reviewAt) ? 'review_due' : row.status;

  return {
    ...payload,
    id: row.document_id,
    documentId: row.document_id,
    title: row.title,
    status,
    progressPercent: Number(row.progress_percent || 0),
    dueAt: row.due_at || payload?.dueAt || undefined,
    lastStudiedAt: row.last_studied_at || payload?.lastStudiedAt || undefined,
    reviewAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const serializeDownloadRecord = (row) => {
  const metadata = parseJson(row.metadata, {});
  return {
    id: String(row.id),
    documentId: row.resource_id || undefined,
    title: row.resource_name || row.document_name || metadata?.fileName || '未命名资料',
    fileName: metadata?.fileName || row.original_name || row.resource_name || undefined,
    action: row.action,
    status: row.status,
    category: row.category || undefined,
    version: row.version_label || metadata?.version || undefined,
    downloadedAt: row.created_at,
    createdAt: row.created_at,
    metadata,
  };
};

const serializeActivityRecord = (row) => {
  const metadata = parseJson(row.metadata, {});
  const resourceName = row.resource_name
    || row.document_name
    || metadata?.title
    || metadata?.fileName
    || '未命名记录';

  return {
    id: String(row.id),
    action: row.action,
    actionLabel: ACTIVITY_ACTION_LABELS[row.action] || row.action,
    resourceType: row.resource_type,
    resourceTypeLabel: ACTIVITY_RESOURCE_LABELS[row.resource_type] || row.resource_type,
    resourceId: row.resource_id || undefined,
    resourceName,
    title: resourceName,
    status: row.status,
    category: row.category || metadata?.category || metadata?.targetCategory || undefined,
    version: row.version_label || metadata?.version || undefined,
    occurredAt: row.created_at,
    createdAt: row.created_at,
    metadata,
  };
};

const serializeAgentInteraction = (row) => ({
  ...parseJson(row.payload, {}),
  id: row.local_id,
  type: row.type,
  question: row.question || parseJson(row.payload, {})?.question || '',
  title: row.title || parseJson(row.payload, {})?.title || '',
  status: row.status,
  referencedDocumentId: row.referenced_document_id || parseJson(row.payload, {})?.referencedDocumentId,
  createdAt: row.source_created_at || parseJson(row.payload, {})?.createdAt || row.created_at,
  updatedAt: row.updated_at,
});

const serializeShareRequest = (row) => ({
  id: String(row.id),
  privateItemId: row.private_item_local_id || undefined,
  title: row.title,
  sourceTitle: row.source_title || undefined,
  itemType: row.item_type,
  targetProfession: row.target_profession || undefined,
  targetSection: row.target_section || undefined,
  targetCategory: row.target_category || undefined,
  reason: row.reason || '',
  status: row.status,
  reviewerId: row.reviewer_id ? String(row.reviewer_id) : undefined,
  reviewerName: row.reviewer_name || undefined,
  promotedDocumentId: row.promoted_file_id ? String(row.promoted_file_id) : undefined,
  reviewNote: row.review_note || '',
  reviewedAt: row.reviewed_at || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  requester: row.requester_name ? {
    id: String(row.user_id),
    name: row.requester_name,
    email: row.requester_email || undefined,
    department: row.requester_department || undefined,
    section: row.requester_section || undefined,
  } : undefined,
  payload: parseJson(row.payload, {}),
});

const readPrivateWorkspace = async (userId) => {
  const [bookmarkRows, folderRows, itemRows, readingRows] = await Promise.all([
    query(
      `SELECT * FROM private_bookmarks
       WHERE user_id = ?
       ORDER BY order_index ASC, created_at ASC, local_id ASC`,
      [userId]
    ),
    query(
      `SELECT * FROM private_folders
       WHERE user_id = ?
       ORDER BY order_index ASC, created_at ASC, local_id ASC`,
      [userId]
    ),
    query(
      `SELECT * FROM private_knowledge_items
       WHERE user_id = ?
       ORDER BY pinned DESC, COALESCE(source_updated_at, updated_at) DESC, local_id ASC`,
      [userId]
    ),
    query(
      `SELECT * FROM private_reading_history
       WHERE user_id = ?
       ORDER BY COALESCE(opened_at, updated_at) DESC, local_id ASC
       LIMIT ?`,
      [userId, MAX_READING_HISTORY]
    ),
  ]);

  return {
    bookmarks: bookmarkRows.map(serializeBookmark),
    folders: folderRows.map(serializeFolder),
    items: itemRows.map(serializeKnowledgeItem),
    readingHistory: readingRows.map(serializeReadingRecord),
  };
};

const readAgentInteractions = async (userId, options = {}) => {
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit) || MAX_AGENT_INTERACTIONS, 1), MAX_AGENT_INTERACTIONS);
  const offset = (page - 1) * limit;

  const countRows = await query('SELECT COUNT(*) AS total FROM agent_interactions WHERE user_id = ?', [userId]);
  const total = countRows[0]?.total || 0;

  const rows = await query(
    `SELECT * FROM agent_interactions
     WHERE user_id = ?
     ORDER BY COALESCE(source_created_at, created_at) DESC, local_id ASC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return { interactions: rows.map(serializeAgentInteraction), total };
};

const readLearningProgress = async (userId, options = {}) => {
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit) || MAX_LEARNING_PROGRESS, 1), MAX_LEARNING_PROGRESS);
  const offset = (page - 1) * limit;
  const status = LEARNING_STATUSES.has(String(options.status || '')) ? String(options.status) : null;
  const reviewDue = ['1', 'true', 'yes'].includes(String(options.reviewDue || '').toLowerCase());
  const where = ['user_id = ?'];
  const params = [userId];

  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  if (reviewDue) {
    where.push("(status = 'review_due' OR (status = 'completed' AND review_at IS NOT NULL AND review_at <= CURRENT_TIMESTAMP))");
  }

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM private_learning_progress WHERE ${where.join(' AND ')}`,
    params
  );
  const total = countRows[0]?.total || 0;

  const rows = await query(
    `SELECT * FROM private_learning_progress
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE status
         WHEN 'review_due' THEN 1
         WHEN 'in_progress' THEN 2
         WHEN 'not_started' THEN 3
         WHEN 'completed' THEN 4
         ELSE 5
       END,
       COALESCE(review_at, due_at, updated_at) ASC,
       updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { progress: rows.map(serializeLearningProgress), total };
};

const readDownloadHistory = async (userId, options = {}) => {
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit) || MAX_DOWNLOAD_HISTORY, 1), MAX_DOWNLOAD_HISTORY);
  const offset = (page - 1) * limit;

  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM audit_logs al
     WHERE al.actor_id = ?
       AND al.resource_type = 'library_document'
       AND al.action = 'library_document.download_content'
       AND al.status = 'success'`,
    [userId]
  );
  const total = countRows[0]?.total || 0;

  const rows = await query(
    `SELECT al.*, f.name AS document_name, f.original_name, f.category, f.version_label
     FROM audit_logs al
     LEFT JOIN files f ON f.id = CAST(al.resource_id AS UNSIGNED)
     WHERE al.actor_id = ?
       AND al.resource_type = 'library_document'
       AND al.action = 'library_document.download_content'
       AND al.status = 'success'
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return { downloads: rows.map(serializeDownloadRecord), total };
};

const readActivityHistory = async (userId, options = {}) => {
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit) || MAX_ACTIVITY_HISTORY, 1), MAX_ACTIVITY_HISTORY);
  const offset = (page - 1) * limit;

  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM audit_logs al
     WHERE al.actor_id = ?
       AND al.action <> 'library_document.download_link'`,
    [userId]
  );
  const total = countRows[0]?.total || 0;

  const rows = await query(
    `SELECT al.*, f.name AS document_name, f.category, f.version_label
     FROM audit_logs al
     LEFT JOIN files f ON al.resource_type = 'library_document' AND f.id = CAST(al.resource_id AS UNSIGNED)
     WHERE al.actor_id = ?
       AND al.action <> 'library_document.download_link'
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return { activities: rows.map(serializeActivityRecord), total };
};

const normalizeLearningProgress = (progress = {}, fallbackDocumentId = null) => {
  const documentId = limitString(progress.documentId || progress.id || fallbackDocumentId, 120, '').trim();
  const title = limitString(progress.title, 255, '未命名资料').trim();
  const rawStatus = String(progress.status || '').trim();
  const status = LEARNING_STATUSES.has(rawStatus) ? rawStatus : 'not_started';
  const progressPercent = status === 'completed' ? 100 : clampPercent(progress.progressPercent ?? progress.progress);
  const now = new Date().toISOString();
  const payload = {
    ...progress,
    id: documentId,
    documentId,
    title,
    status,
    progressPercent,
    updatedAt: progress.updatedAt || now,
  };

  return {
    documentId,
    title,
    status,
    progressPercent,
    dueAt: toDateOrNull(progress.dueAt),
    lastStudiedAt: toDateOrNull(progress.lastStudiedAt),
    reviewAt: toDateOrNull(progress.reviewAt),
    payload,
  };
};

const upsertLearningProgress = async (connection, userId, records = []) => {
  const limited = toArray(records).slice(0, MAX_LEARNING_PROGRESS);
  assertLearningProgressSize({ progress: limited });

  for (const item of limited) {
    const progress = normalizeLearningProgress(item);
    if (!progress.documentId || !progress.title) continue;
    await connection.query(
      `INSERT INTO private_learning_progress
        (user_id, document_id, title, status, progress_percent, due_at, last_studied_at, review_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         status = VALUES(status),
         progress_percent = VALUES(progress_percent),
         due_at = VALUES(due_at),
         last_studied_at = VALUES(last_studied_at),
         review_at = VALUES(review_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        progress.documentId,
        progress.title,
        progress.status,
        progress.progressPercent,
        progress.dueAt,
        progress.lastStudiedAt,
        progress.reviewAt,
        JSON.stringify(progress.payload),
      ]
    );
  }
};

const canReviewShareRequests = (user) => (
  Boolean(user?.isAdmin)
  || hasPermission(user, PERMISSIONS.FILE_CREATE)
  || hasPermission(user, PERMISSIONS.FILE_UPDATE)
);

const readPrivateShareRequests = async (user, options = {}) => {
  const status = SHARE_REQUEST_STATUSES.has(String(options.status || '')) ? String(options.status) : null;
  const canReview = canReviewShareRequests(user);
  const reviewScope = options.scope === 'review' && canReview;
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const offset = (page - 1) * limit;
  const companyId = getScopedCompanyId(user, options.companyId);

  const where = reviewScope ? ['1 = 1'] : ['psr.user_id = ?'];
  const params = reviewScope ? [] : [user.id];
  if (reviewScope && companyId) {
    where.push('requester.company_id = ?');
    params.push(companyId);
  }
  if (status) {
    where.push('psr.status = ?');
    params.push(status);
  }

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM private_share_requests psr
     LEFT JOIN users requester ON requester.id = psr.user_id
     WHERE ${where.join(' AND ')}`,
    params
  );
  const total = countRows[0]?.total || 0;

  const rows = await query(
    `SELECT psr.*,
       requester.name AS requester_name,
       requester.email AS requester_email,
       requester.department AS requester_department,
       requester.section AS requester_section,
       reviewer.name AS reviewer_name
     FROM private_share_requests psr
     LEFT JOIN users requester ON requester.id = psr.user_id
     LEFT JOIN users reviewer ON reviewer.id = psr.reviewer_id
     WHERE ${where.join(' AND ')}
     ORDER BY psr.created_at DESC, psr.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { shareRequests: rows.map(serializeShareRequest), total };
};

const findPrivateKnowledgeItemSnapshot = async (userId, privateItemId) => {
  const localId = normalizeLocalId(privateItemId, 'knowledge-item');
  const rows = await query(
    `SELECT * FROM private_knowledge_items
     WHERE user_id = ? AND local_id = ?
     LIMIT 1`,
    [userId, localId]
  );
  return rows[0] ? serializeKnowledgeItem(rows[0]) : null;
};

const getShareRequestPayload = (req) => {
  const body = req.body?.request && typeof req.body.request === 'object' && !Array.isArray(req.body.request)
    ? req.body.request
    : req.body || {};
  const item = body.item && typeof body.item === 'object' && !Array.isArray(body.item) ? body.item : {};
  return { body, item };
};

const upsertBookmarks = async (connection, userId, bookmarks) => {
  const limited = toArray(bookmarks).slice(0, MAX_BOOKMARKS);
  const ids = limited.map((bookmark, index) => normalizeLocalId(bookmark?.id, 'bookmark', index));
  await deleteMissingRows(connection, 'private_bookmarks', userId, ids);

  for (let index = 0; index < limited.length; index += 1) {
    const bookmark = limited[index] || {};
    const localId = ids[index];
    const payload = { ...bookmark, id: localId };
    await connection.query(
      `INSERT INTO private_bookmarks
        (user_id, local_id, name, icon, color, is_system, order_index, source_created_at, source_updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         icon = VALUES(icon),
         color = VALUES(color),
         is_system = VALUES(is_system),
         order_index = VALUES(order_index),
         source_created_at = VALUES(source_created_at),
         source_updated_at = VALUES(source_updated_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        limitString(bookmark.name, 80, '未命名书签'),
        limitString(bookmark.icon, 80, 'folder-outline'),
        limitString(bookmark.color, 24, '#2F9E7E'),
        Boolean(bookmark.system) ? 1 : 0,
        index,
        toDateOrNull(bookmark.createdAt),
        toDateOrNull(bookmark.updatedAt || bookmark.createdAt),
        JSON.stringify(payload),
      ]
    );
  }
};

const upsertFolders = async (connection, userId, folders) => {
  const limited = toArray(folders).slice(0, MAX_FOLDERS);
  const ids = limited.map((folder, index) => normalizeLocalId(folder?.id, 'folder', index));
  await deleteMissingRows(connection, 'private_folders', userId, ids);

  for (let index = 0; index < limited.length; index += 1) {
    const folder = limited[index] || {};
    const localId = ids[index];
    const payload = { ...folder, id: localId };
    await connection.query(
      `INSERT INTO private_folders
        (user_id, local_id, bookmark_local_id, name, order_index, source_created_at, source_updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bookmark_local_id = VALUES(bookmark_local_id),
         name = VALUES(name),
         order_index = VALUES(order_index),
         source_created_at = VALUES(source_created_at),
         source_updated_at = VALUES(source_updated_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        folder.bookmarkId ? normalizeLocalId(folder.bookmarkId, 'bookmark') : null,
        limitString(folder.name, 120, '未命名文件夹'),
        index,
        toDateOrNull(folder.createdAt),
        toDateOrNull(folder.updatedAt || folder.createdAt),
        JSON.stringify(payload),
      ]
    );
  }
};

const upsertKnowledgeItems = async (connection, userId, items) => {
  const limited = toArray(items).slice(0, MAX_ITEMS);
  const ids = limited.map((item, index) => normalizeLocalId(item?.id, 'knowledge-item', index));
  await deleteMissingRows(connection, 'private_knowledge_items', userId, ids);

  for (let index = 0; index < limited.length; index += 1) {
    const item = limited[index] || {};
    const localId = ids[index];
    const payload = { ...item, id: localId };
    await connection.query(
      `INSERT INTO private_knowledge_items
        (user_id, local_id, type, title, source_title, reference_kind, document_id, group_id, file_id,
         bookmark_ids, folder_ids, tags, pinned, source_created_at, source_updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         type = VALUES(type),
         title = VALUES(title),
         source_title = VALUES(source_title),
         reference_kind = VALUES(reference_kind),
         document_id = VALUES(document_id),
         group_id = VALUES(group_id),
         file_id = VALUES(file_id),
         bookmark_ids = VALUES(bookmark_ids),
         folder_ids = VALUES(folder_ids),
         tags = VALUES(tags),
         pinned = VALUES(pinned),
         source_created_at = VALUES(source_created_at),
         source_updated_at = VALUES(source_updated_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        limitString(item.type, 40, 'reference'),
        limitString(item.title, 255, '未命名资料'),
        limitString(item.sourceTitle, 255, null),
        limitString(item.referenceKind, 60, null),
        limitString(item.documentId, 120, null),
        limitString(item.groupId, 120, null),
        limitString(item.fileId, 120, null),
        toJson(item.bookmarkIds, []),
        toJson(item.folderIds, []),
        toJson(item.tags, []),
        Boolean(item.pinned) ? 1 : 0,
        toDateOrNull(item.createdAt),
        toDateOrNull(item.updatedAt || item.createdAt),
        JSON.stringify(payload),
      ]
    );
  }
};

const upsertReadingHistory = async (connection, userId, history) => {
  const limited = toArray(history).slice(0, MAX_READING_HISTORY);
  const ids = limited.map((record, index) => normalizeLocalId(record?.id, 'reading', index));
  await deleteMissingRows(connection, 'private_reading_history', userId, ids);

  for (let index = 0; index < limited.length; index += 1) {
    const record = limited[index] || {};
    const localId = ids[index];
    const payload = { ...record, id: localId };
    await connection.query(
      `INSERT INTO private_reading_history
        (user_id, local_id, title, owner, category, opened_at, progress_page, progress_total_pages, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         owner = VALUES(owner),
         category = VALUES(category),
         opened_at = VALUES(opened_at),
         progress_page = VALUES(progress_page),
         progress_total_pages = VALUES(progress_total_pages),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        limitString(record.title, 255, '未命名资料'),
        limitString(record.owner, 160, null),
        limitString(record.category, 120, null),
        toDateOrNull(record.openedAt || record.updatedAt || record.createdAt),
        Number.isFinite(Number(record.page)) ? Number(record.page) : null,
        Number.isFinite(Number(record.totalPages)) ? Number(record.totalPages) : null,
        JSON.stringify(payload),
      ]
    );
  }
};

const getWorkspacePayload = (req) => {
  if (req.body?.workspace && typeof req.body.workspace === 'object' && !Array.isArray(req.body.workspace)) {
    return req.body.workspace;
  }
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
};

exports.getPrivateWorkspace = async (req, res) => {
  try {
    const workspace = await readPrivateWorkspace(req.user.id);
    const exists = workspace.bookmarks.length > 0
      || workspace.folders.length > 0
      || workspace.items.length > 0
      || workspace.readingHistory.length > 0;
    res.json({ exists, workspace });
  } catch (err) {
    sendServerError(res, err, '读取个人知识空间失败');
  }
};

exports.savePrivateWorkspace = async (req, res) => {
  try {
    const workspace = getWorkspacePayload(req);
    assertWorkspaceSize(workspace);

    await withTransaction(async (connection) => {
      await upsertBookmarks(connection, req.user.id, workspace.bookmarks);
      await upsertFolders(connection, req.user.id, workspace.folders);
      await upsertKnowledgeItems(connection, req.user.id, workspace.items || workspace.knowledgeItems);
      await upsertReadingHistory(connection, req.user.id, workspace.readingHistory);
    });
    const savedWorkspace = await readPrivateWorkspace(req.user.id);

    res.json({
      message: '个人知识空间已同步',
      exists: true,
      workspace: savedWorkspace,
    });
  } catch (err) {
    console.error('同步个人知识空间失败:', err);
    res.status(err.status || 500).json({ message: err.message || '同步个人知识空间失败' });
  }
};

exports.getReadingHistory = async (req, res) => {
  try {
    const workspace = await readPrivateWorkspace(req.user.id);
    res.json({ readingHistory: workspace.readingHistory });
  } catch (err) {
    sendServerError(res, err, '读取最近阅读失败');
  }
};

exports.saveReadingHistory = async (req, res) => {
  try {
    const readingHistory = toArray(req.body?.readingHistory || req.body?.history);
    assertWorkspaceSize({ readingHistory });
    await withTransaction(async (connection) => {
      await upsertReadingHistory(connection, req.user.id, readingHistory);
    });
    const saved = await readPrivateWorkspace(req.user.id);
    res.json({ message: '最近阅读已同步', readingHistory: saved.readingHistory });
  } catch (err) {
    console.error('同步最近阅读失败:', err);
    res.status(err.status || 500).json({ message: err.message || '同步最近阅读失败' });
  }
};

exports.getLearningProgress = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const { progress, total } = await readLearningProgress(req.user.id, {
      status: req.query.status,
      reviewDue: req.query.reviewDue,
      page,
      limit,
    });
    res.json({
      progress,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '读取学习进度失败');
  }
};

exports.getDownloadHistory = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const { downloads, total } = await readDownloadHistory(req.user.id, { page, limit });
    res.json({
      downloads,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '读取下载历史失败');
  }
};

exports.getActivityHistory = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const { activities, total } = await readActivityHistory(req.user.id, { page, limit });
    res.json({
      activities,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '读取最近活动失败');
  }
};

exports.saveLearningProgress = async (req, res) => {
  try {
    const progress = toArray(req.body?.progress || req.body?.learningProgress);
    await withTransaction(async (connection) => {
      await upsertLearningProgress(connection, req.user.id, progress);
    });
    const { progress: savedProgress } = await readLearningProgress(req.user.id);
    res.json({
      message: '学习进度已同步',
      progress: savedProgress,
    });
  } catch (err) {
    console.error('同步学习进度失败:', err);
    res.status(err.status || 500).json({ message: err.message || '同步学习进度失败' });
  }
};

exports.updateLearningProgress = async (req, res) => {
  try {
    const documentId = limitString(req.params.documentId, 120, '').trim();
    if (!documentId) return res.status(400).json({ message: '资料 ID 不正确' });

    const currentRows = await query(
      'SELECT * FROM private_learning_progress WHERE user_id = ? AND document_id = ? LIMIT 1',
      [req.user.id, documentId]
    );
    const current = currentRows[0] ? serializeLearningProgress(currentRows[0]) : {};
    const next = {
      ...current,
      ...req.body,
      documentId,
      id: documentId,
      title: req.body?.title || current.title || '未命名资料',
    };

    await withTransaction(async (connection) => {
      await upsertLearningProgress(connection, req.user.id, [next]);
    });

    const rows = await query(
      'SELECT * FROM private_learning_progress WHERE user_id = ? AND document_id = ? LIMIT 1',
      [req.user.id, documentId]
    );
    res.json({
      message: '学习进度已更新',
      progress: rows[0] ? serializeLearningProgress(rows[0]) : null,
    });
  } catch (err) {
    console.error('更新学习进度失败:', err);
    res.status(err.status || 500).json({ message: err.message || '更新学习进度失败' });
  }
};

exports.deletePrivateWorkspace = async (req, res) => {
  try {
    await withTransaction(async (connection) => {
      await connection.query('DELETE FROM private_learning_progress WHERE user_id = ?', [req.user.id]);
      await connection.query('DELETE FROM private_reading_history WHERE user_id = ?', [req.user.id]);
      await connection.query('DELETE FROM private_knowledge_items WHERE user_id = ?', [req.user.id]);
      await connection.query('DELETE FROM private_folders WHERE user_id = ?', [req.user.id]);
      await connection.query('DELETE FROM private_bookmarks WHERE user_id = ?', [req.user.id]);
    });
    res.json({ message: '个人知识空间已清空', exists: false });
  } catch (err) {
    sendServerError(res, err, '清空个人知识空间失败');
  }
};

exports.getShareRequests = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const { shareRequests, total } = await readPrivateShareRequests(req.user, {
      status: req.query.status,
      scope: req.query.scope,
      page,
      limit,
      companyId: req.query.companyId,
    });
    res.json({
      canReview: canReviewShareRequests(req.user),
      shareRequests,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '读取共享申请失败');
  }
};

exports.createShareRequest = async (req, res) => {
  try {
    const { body, item } = getShareRequestPayload(req);
    const requestedPrivateItemId = body.privateItemId || item.id;
    const storedItem = requestedPrivateItemId
      ? await findPrivateKnowledgeItemSnapshot(req.user.id, requestedPrivateItemId)
      : null;
    const itemSnapshot = storedItem || item;
    const title = limitString(body.title || itemSnapshot.title, 255, '').trim();

    if (!title) {
      return res.status(400).json({ message: '共享申请缺少资料标题' });
    }

    const privateItemId = requestedPrivateItemId
      ? normalizeLocalId(requestedPrivateItemId, 'knowledge-item')
      : null;
    if (privateItemId) {
      const duplicateRows = await query(
        `SELECT * FROM private_share_requests
         WHERE user_id = ? AND private_item_local_id = ? AND status IN ('pending', 'approved')
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [req.user.id, privateItemId]
      );
      if (duplicateRows[0]) {
        const existingShareRequest = serializeShareRequest(duplicateRows[0]);
        return res.status(409).json({
          message: existingShareRequest.status === 'approved'
            ? '这条资料已通过共享审核并进入资料库'
            : '这条资料已有待审核共享申请',
          shareRequest: existingShareRequest,
          shareRequests: (await readPrivateShareRequests(req.user)).shareRequests,
        });
      }
    }

    const createdAt = new Date().toISOString();
    const payload = {
      item: itemSnapshot,
      target: {
        profession: limitString(body.targetProfession || itemSnapshot.profession || req.user.department, 120, ''),
        section: limitString(body.targetSection || itemSnapshot.section || req.user.section, 120, ''),
        category: limitString(body.targetCategory || itemSnapshot.category || '个人沉淀', 120, ''),
      },
      reason: limitString(body.reason, 4000, ''),
      createdBy: {
        id: String(req.user.id),
        name: req.user.name,
        department: req.user.department,
        section: req.user.section,
      },
      createdAt,
    };
    assertShareRequestSize(payload);

    const result = await query(
      `INSERT INTO private_share_requests
       (user_id, private_item_local_id, title, source_title, item_type,
        target_profession, target_section, target_category, reason, status, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        req.user.id,
        privateItemId,
        title,
        limitString(body.sourceTitle || itemSnapshot.sourceTitle, 255, null),
        limitString(itemSnapshot.type || body.itemType, 40, 'reference'),
        limitString(body.targetProfession || itemSnapshot.profession || req.user.department, 120, null),
        limitString(body.targetSection || itemSnapshot.section || req.user.section, 120, null),
        limitString(body.targetCategory || itemSnapshot.category || '个人沉淀', 120, null),
        limitString(body.reason, 4000, null),
        JSON.stringify(payload),
      ]
    );

    const rows = await query('SELECT * FROM private_share_requests WHERE id = ? AND user_id = ?', [result.insertId, req.user.id]);
    const shareRequest = rows[0] ? serializeShareRequest(rows[0]) : null;
    await recordAuditLog({
      req,
      action: 'private_share_request.create',
      resourceType: 'private_share_request',
      resourceId: shareRequest?.id || result.insertId,
      resourceName: title,
      metadata: {
        privateItemId,
        targetProfession: payload.target.profession,
        targetSection: payload.target.section,
        targetCategory: payload.target.category,
      },
    });

    res.status(201).json({
      message: '共享申请已提交',
      shareRequest,
      shareRequests: (await readPrivateShareRequests(req.user)).shareRequests,
    });
  } catch (err) {
    console.error('提交共享申请失败:', err);
    res.status(err.status || 500).json({ message: err.message || '提交共享申请失败' });
  }
};

exports.updateShareRequest = async (req, res) => {
  let promotedFilePath = null;
  try {
    const requestId = Number(req.params.requestId);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ message: '共享申请 ID 不正确' });
    }

    const status = String(req.body?.status || '').trim();
    if (!SHARE_REQUEST_STATUSES.has(status)) {
      return res.status(400).json({ message: '共享申请状态不正确' });
    }

    const rows = await query('SELECT * FROM private_share_requests WHERE id = ? LIMIT 1', [requestId]);
    const existing = rows[0];
    if (!existing) {
      return res.status(404).json({ message: '共享申请不存在' });
    }

    const isOwner = String(existing.user_id) === String(req.user.id);
    const canReview = req.user.isAdmin || hasPermission(req.user, PERMISSIONS.FILE_CREATE) || hasPermission(req.user, PERMISSIONS.FILE_UPDATE);
    const requesterRows = await query('SELECT company_id FROM users WHERE id = ? LIMIT 1', [existing.user_id]);
    const requesterCompanyId = requesterRows[0]?.company_id;

    if (status === 'cancelled') {
      if (!isOwner) return res.status(403).json({ message: '只能取消自己的共享申请' });
      if (existing.status !== 'pending') return res.status(400).json({ message: '只能取消待审核申请' });
      await query(
        `UPDATE private_share_requests
         SET status = 'cancelled', review_note = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [limitString(req.body?.reviewNote || req.body?.note, 4000, null), requestId]
      );
    } else {
      if (!canReview) return res.status(403).json({ message: '没有审核共享申请的权限' });
      if (isOwner) return res.status(403).json({ message: '不能审核自己提交的共享申请' });
      const scopedCompanyId = getScopedCompanyId(req.user, req.body?.companyId || req.query.companyId);
      if (scopedCompanyId && requesterCompanyId && String(scopedCompanyId) !== String(requesterCompanyId)) {
        return res.status(403).json({ message: '不能审核其他公司的共享申请' });
      }
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ message: '审核状态不正确' });
      }
      if (existing.status === 'cancelled' && status === 'approved') {
        return res.status(400).json({ message: '已取消的共享申请不能审核通过' });
      }
      if (existing.promoted_file_id && status !== 'approved') {
        return res.status(400).json({ message: '已进入资料库的共享申请不能退回或拒绝' });
      }

      const reviewNote = limitString(req.body?.reviewNote || req.body?.note, 4000, null);
      if (status === 'approved') {
        const promotion = await withTransaction(async (connection) => {
          const result = await promoteShareRequestToLibraryDocument(connection, req, existing, reviewNote);
          promotedFilePath = result.filePath;
          return result;
        });
        if (promotion.reused) promotedFilePath = null;
      } else {
        await query(
          `UPDATE private_share_requests
           SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ?
           WHERE id = ?`,
          [
            status,
            status === 'pending' ? null : req.user.id,
            reviewNote,
            status === 'pending' ? null : new Date(),
            requestId,
          ]
        );
      }
    }

    const updatedRows = await query('SELECT * FROM private_share_requests WHERE id = ? LIMIT 1', [requestId]);
    const shareRequest = serializeShareRequest(updatedRows[0]);
    await recordAuditLog({
      req,
      action: `private_share_request.${status}`,
      resourceType: 'private_share_request',
      resourceId: shareRequest.id,
      resourceName: shareRequest.title,
      metadata: {
        previousStatus: existing.status,
        status,
      },
    });

    res.json({ message: '共享申请已更新', shareRequest });
  } catch (err) {
    if (promotedFilePath) {
      await fs.unlink(promotedFilePath).catch(() => {});
    }
    sendServerError(res, err, '更新共享申请失败');
  }
};

exports.getAgentInteractions = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const { interactions, total } = await readAgentInteractions(req.user.id, { page, limit });
    res.json({
      interactions,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '读取智能体历史失败');
  }
};

exports.createAgentInteraction = async (req, res) => {
  try {
    const interaction = req.body?.interaction && typeof req.body.interaction === 'object' && !Array.isArray(req.body.interaction)
      ? req.body.interaction
      : req.body;
    if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) {
      return res.status(400).json({ message: '智能体历史记录格式不正确' });
    }

    assertAgentInteractionSize(interaction);
    const createdAt = interaction.createdAt || new Date().toISOString();
    const localId = normalizeLocalId(interaction.id, 'agent-interaction');
    const payload = {
      ...interaction,
      id: localId,
      createdAt,
    };

    await query(
      `INSERT INTO agent_interactions
        (user_id, local_id, type, question, title, status, referenced_document_id, source_created_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         type = VALUES(type),
         question = VALUES(question),
         title = VALUES(title),
         status = VALUES(status),
         referenced_document_id = VALUES(referenced_document_id),
         source_created_at = VALUES(source_created_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        req.user.id,
        localId,
        limitString(interaction.type, 40, 'question'),
        interaction.question == null ? null : String(interaction.question).slice(0, 4000),
        limitString(interaction.title, 255, null),
        limitString(interaction.status, 60, 'answered'),
        limitString(interaction.referencedDocumentId || interaction.referencedDocument?.id, 120, null),
        toDateOrNull(createdAt),
        JSON.stringify(payload),
      ]
    );

    const { interactions } = await readAgentInteractions(req.user.id);
    const saved = interactions.find((item) => item.id === localId) || interactions[0];
    res.status(201).json({ message: '智能体历史已保存', interaction: saved, interactions });
  } catch (err) {
    console.error('保存智能体历史失败:', err);
    res.status(err.status || 500).json({ message: err.message || '保存智能体历史失败' });
  }
};

exports.deleteAgentInteractions = async (req, res) => {
  try {
    if (req.params.interactionId) {
      await query(
        'DELETE FROM agent_interactions WHERE user_id = ? AND local_id = ?',
        [req.user.id, normalizeLocalId(req.params.interactionId, 'agent-interaction')]
      );
      return res.json({ message: '智能体历史已删除' });
    }

    await query('DELETE FROM agent_interactions WHERE user_id = ?', [req.user.id]);
    return res.json({ message: '智能体历史已清空' });
  } catch (err) {
    sendServerError(res, err, '删除智能体历史失败');
  }
};
