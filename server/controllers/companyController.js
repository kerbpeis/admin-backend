const crypto = require('crypto');
const { query, isDuplicateKeyError } = require('../config/db');
const { serializeCompany, parseTags, toId } = require('../utils/mysqlUtils');
const { isPlatformAdmin } = require('../utils/resourceAccess');
const { sendServerError } = require('../utils/serverError');

const generateInviteCode = (length = 12) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }
  return code;
};

const canManageCompanies = (user) => isPlatformAdmin(user);

const normalizeEmailDomains = (value) => {
  if (!value) return null;
  const domains = parseTags(value)
    .map((domain) => String(domain || '').trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return domains.length ? JSON.stringify(Array.from(new Set(domains))) : null;
};

const loadCompanyStats = async (companyIds) => {
  const ids = companyIds.map(toId).filter(Boolean);
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const [userRows, departmentRows, fileRows] = await Promise.all([
    query(`SELECT company_id, COUNT(*) AS total FROM users WHERE company_id IN (${placeholders}) GROUP BY company_id`, ids),
    query(`SELECT company_id, COUNT(*) AS total FROM departments WHERE company_id IN (${placeholders}) AND is_active = 1 GROUP BY company_id`, ids),
    query(`SELECT company_id, COUNT(*) AS total FROM files WHERE company_id IN (${placeholders}) AND status = 'active' GROUP BY company_id`, ids),
  ]);
  const map = new Map(ids.map((id) => [id, { userCount: 0, directoryCount: 0, documentCount: 0 }]));
  userRows.forEach((row) => {
    const stats = map.get(toId(row.company_id));
    if (stats) stats.userCount = Number(row.total || 0);
  });
  departmentRows.forEach((row) => {
    const stats = map.get(toId(row.company_id));
    if (stats) stats.directoryCount = Number(row.total || 0);
  });
  fileRows.forEach((row) => {
    const stats = map.get(toId(row.company_id));
    if (stats) stats.documentCount = Number(row.total || 0);
  });
  return map;
};

exports.getCompanies = async (req, res) => {
  try {
    const params = [];
    const filters = [];

    if (!canManageCompanies(req.user)) {
      filters.push('id = ?');
      params.push(toId(req.user.companyId));
    }

    if (req.query.status && req.query.status !== 'all') {
      filters.push('status = ?');
      params.push(req.query.status);
    }

    if (req.query.search) {
      filters.push('name LIKE ?');
      params.push(`%${req.query.search}%`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await query(`SELECT * FROM companies ${where} ORDER BY created_at DESC`, params);
    const stats = await loadCompanyStats(rows.map((row) => row.id));
    res.json({
      companies: rows.map((row) => ({
        ...serializeCompany(row),
        ...(stats.get(toId(row.id)) || {}),
      })),
    });
  } catch (err) {
    sendServerError(res, err, '获取公司列表失败');
  }
};

exports.createCompany = async (req, res) => {
  try {
    if (!canManageCompanies(req.user)) {
      return res.status(403).json({ message: '只有平台管理员可以创建公司' });
    }

    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: '请输入公司名称' });

    const result = await query(
      `INSERT INTO companies (name, invite_code, email_domains, status)
       VALUES (?, ?, ?, 'active')`,
      [name, generateInviteCode(), normalizeEmailDomains(req.body.emailDomains)]
    );
    const rows = await query('SELECT * FROM companies WHERE id = ?', [result.insertId]);
    res.status(201).json({ message: '公司已创建', company: serializeCompany(rows[0]) });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(400).json({ message: '公司邀请码已存在，请重试' });
    }
    sendServerError(res, err, '创建公司失败');
  }
};

exports.updateCompany = async (req, res) => {
  try {
    if (!canManageCompanies(req.user)) {
      return res.status(403).json({ message: '只有平台管理员可以更新公司' });
    }

    const id = toId(req.params.id);
    const rows = await query('SELECT * FROM companies WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: '公司不存在' });

    await query(
      `UPDATE companies
       SET name = ?, email_domains = ?, status = ?
       WHERE id = ?`,
      [
        String(req.body?.name || rows[0].name).trim(),
        Object.prototype.hasOwnProperty.call(req.body || {}, 'emailDomains')
          ? normalizeEmailDomains(req.body.emailDomains)
          : rows[0].email_domains,
        ['active', 'disabled'].includes(req.body?.status) ? req.body.status : rows[0].status,
        id,
      ]
    );
    const updated = await query('SELECT * FROM companies WHERE id = ?', [id]);
    res.json({ message: '公司已更新', company: serializeCompany(updated[0]) });
  } catch (err) {
    sendServerError(res, err, '更新公司失败');
  }
};

exports.refreshInviteCode = async (req, res) => {
  try {
    if (!canManageCompanies(req.user)) {
      return res.status(403).json({ message: '只有平台管理员可以刷新邀请码' });
    }

    const id = toId(req.params.id);
    const rows = await query('SELECT * FROM companies WHERE id = ?', [id]);
    if (!rows[0]) return res.status(404).json({ message: '公司不存在' });

    await query('UPDATE companies SET invite_code = ? WHERE id = ?', [generateInviteCode(), id]);
    const updated = await query('SELECT * FROM companies WHERE id = ?', [id]);
    res.json({ message: '邀请码已刷新', company: serializeCompany(updated[0]) });
  } catch (err) {
    sendServerError(res, err, '刷新邀请码失败');
  }
};
