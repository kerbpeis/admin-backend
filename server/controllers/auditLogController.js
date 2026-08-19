const { query } = require('../config/db');
const { toId, parsePageAndLimit } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');

const parseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const formatDateTime = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
};

const serializeAuditLog = (row) => ({
  _id: String(row.id),
  id: String(row.id),
  action: row.action,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  resourceName: row.resource_name,
  status: row.status,
  ipAddress: row.ip_address,
  userAgent: row.user_agent,
  metadata: parseMetadata(row.metadata),
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

exports.getAuditLogs = async (req, res) => {
  try {
    const { page, limit } = parsePageAndLimit(req.query, 20, 100);
    const {
      action,
      actorId,
      dateFrom,
      dateTo,
      resourceId,
      resourceType,
      status,
    } = req.query;

    const filters = ['1 = 1'];
    const params = [];

    if (action) {
      filters.push('al.action = ?');
      params.push(action);
    }

    if (actorId) {
      filters.push('al.actor_id = ?');
      params.push(toId(actorId) || 0);
    }

    if (resourceType) {
      filters.push('al.resource_type = ?');
      params.push(resourceType);
    }

    if (resourceId) {
      filters.push('al.resource_id = ?');
      params.push(String(resourceId));
    }

    if (status) {
      filters.push('al.status = ?');
      params.push(status);
    }

    if (dateFrom) {
      filters.push('al.created_at >= ?');
      params.push(dateFrom);
    }

    if (dateTo) {
      filters.push('al.created_at <= ?');
      params.push(dateTo);
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const countRows = await query(`SELECT COUNT(*) AS total FROM audit_logs al ${where}`, params);
    const total = Number(countRows[0]?.total || 0);
    const rows = await query(
      `SELECT al.*,
        u.name AS actor_name, u.email AS actor_email, u.department AS actor_department, u.section AS actor_section
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ${where}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );

    res.json({
      logs: rows.map(serializeAuditLog),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    sendServerError(res, err, '获取审计日志失败');
  }
};

exports.getAuditLog = async (req, res) => {
  try {
    const rows = await query(
      `SELECT al.*,
        u.name AS actor_name, u.email AS actor_email, u.department AS actor_department, u.section AS actor_section
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.id = ?`,
      [toId(req.params.id) || 0]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: '审计日志不存在' });
    }

    res.json({ log: serializeAuditLog(rows[0]) });
  } catch (err) {
    sendServerError(res, err, '获取审计日志失败');
  }
};
