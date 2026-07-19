const { query } = require('../config/db');
const { toId } = require('./mysqlUtils');

const pickIpAddress = (req) => {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req?.ip || req?.socket?.remoteAddress || null;
};

const normalizeMetadata = (metadata = {}) => {
  try {
    return JSON.stringify(metadata || {});
  } catch {
    return JSON.stringify({ serializationError: true });
  }
};

const execute = async (connection, sql, params) => {
  if (connection) return connection.execute(sql, params);
  return query(sql, params);
};

const recordAuditLog = async ({
  req,
  connection = null,
  actorId,
  action,
  resourceType,
  resourceId = null,
  resourceName = null,
  status = 'success',
  metadata = {},
}) => {
  if (!action || !resourceType) return false;

  try {
    await execute(
      connection,
      `INSERT INTO audit_logs
       (actor_id, action, resource_type, resource_id, resource_name, status, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        toId(actorId || req?.user?.id),
        action,
        resourceType,
        resourceId == null ? null : String(resourceId),
        resourceName || null,
        status,
        pickIpAddress(req),
        req?.headers?.['user-agent'] || null,
        normalizeMetadata(metadata),
      ]
    );
    return true;
  } catch (error) {
    console.warn('审计日志写入失败:', error.message);
    return false;
  }
};

const recordLibraryDocumentAudit = (req, action, document = {}, options = {}) => recordAuditLog({
  req,
  action,
  resourceType: 'library_document',
  resourceId: document.id || document._id,
  resourceName: document.name || document.title,
  status: options.status || 'success',
  metadata: {
    documentId: document.id || document._id,
    title: document.name || document.title,
    category: document.category,
    profession: document.profession_name || document.profession,
    section: document.department_name || document.section,
    ...options.metadata,
  },
  connection: options.connection || null,
});

module.exports = {
  recordAuditLog,
  recordLibraryDocumentAudit,
};
