const crypto = require('crypto');
const { pool } = require('../config/db');
require('dotenv').config();

const database = process.env.MYSQL_DATABASE || 'admin_backend';

const ensureColumn = async (connection, tableName, columnName, columnDefinition) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [database, tableName, columnName]
  );

  if (Number(rows[0].count) === 0) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefinition}`);
    console.log(`Added column: ${tableName}.${columnName}`);
  }
};

const indexExists = async (connection, tableName, indexName) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [database, tableName, indexName]
  );

  return Number(rows[0].count) > 0;
};

const ensureIndex = async (connection, tableName, indexName, indexDefinition) => {
  if (!(await indexExists(connection, tableName, indexName))) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD ${indexDefinition}`);
    console.log(`Added index: ${tableName}.${indexName}`);
  }
};

const dropIndexIfExists = async (connection, tableName, indexName) => {
  if (await indexExists(connection, tableName, indexName)) {
    await connection.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``);
    console.log(`Dropped index: ${tableName}.${indexName}`);
  }
};

const generateInviteCode = (length = 12) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
};

const ensureSchema = async (connection) => {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS companies (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      invite_code VARCHAR(64) NOT NULL,
      email_domains JSON NULL,
      status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_companies_invite_code (invite_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureColumn(connection, 'departments', 'company_id', 'company_id BIGINT UNSIGNED NULL');
  await ensureColumn(connection, 'users', 'company_id', 'company_id BIGINT UNSIGNED NULL');
  await ensureColumn(connection, 'users', 'platform_role', "platform_role VARCHAR(20) NOT NULL DEFAULT 'member'");
  await ensureColumn(connection, 'files', 'company_id', 'company_id BIGINT UNSIGNED NULL');
  await ensureColumn(connection, 'knowledge_points', 'company_id', 'company_id BIGINT UNSIGNED NULL');

  await ensureIndex(connection, 'users', 'idx_users_company', 'INDEX idx_users_company (company_id)');
  await ensureIndex(connection, 'files', 'idx_files_company', 'INDEX idx_files_company (company_id)');
  await ensureIndex(connection, 'knowledge_points', 'idx_knowledge_points_company', 'INDEX idx_knowledge_points_company (company_id)');
  await ensureIndex(connection, 'departments', 'idx_departments_company', 'INDEX idx_departments_company (company_id)');

  // 目录唯一约束从单列 name 换成 (company_id, type, name)，专业和科室都属于公司。
  await dropIndexIfExists(connection, 'departments', 'uk_departments_name');
  await dropIndexIfExists(connection, 'departments', 'uk_departments_company_name');
  await ensureIndex(connection, 'departments', 'uk_departments_company_type_name', 'UNIQUE KEY uk_departments_company_type_name (company_id, type, name)');
};

const ensureDefaultCompany = async (connection) => {
  const [rows] = await connection.query('SELECT id, name, invite_code FROM companies ORDER BY id LIMIT 1');
  if (rows[0]) return rows[0];

  const name = process.env.DEFAULT_COMPANY_NAME || '默认煤矿公司';
  const inviteCode = generateInviteCode();
  const [result] = await connection.query(
    'INSERT INTO companies (name, invite_code) VALUES (?, ?)',
    [name, inviteCode]
  );
  console.log(`Created default company: ${name} (id: ${result.insertId})`);
  return { id: result.insertId, name, invite_code: inviteCode };
};

const backfill = async (connection, companyId) => {
  const run = async (label, sql, params) => {
    const [result] = await connection.query(sql, params);
    console.log(`${label}: ${result.affectedRows} row(s) updated`);
    return result.affectedRows;
  };

  await run(
    'users.company_id',
    'UPDATE users SET company_id = ? WHERE company_id IS NULL',
    [companyId]
  );

  await run(
    'users.platform_role (super_admin)',
    "UPDATE users SET platform_role = 'super_admin' WHERE is_admin = 1 AND platform_role <> 'super_admin'",
    []
  );

  await run(
    'departments.company_id',
    'UPDATE departments SET company_id = ? WHERE company_id IS NULL',
    [companyId]
  );

  await run(
    'files.company_id',
    `UPDATE files f JOIN users u ON u.id = f.uploaded_by
     SET f.company_id = u.company_id
     WHERE f.company_id IS NULL`,
    []
  );

  await run(
    'knowledge_points.company_id',
    `UPDATE knowledge_points kp JOIN users u ON u.id = kp.created_by
     SET kp.company_id = u.company_id
     WHERE kp.company_id IS NULL`,
    []
  );
};

const run = async () => {
  const connection = await pool.getConnection();

  try {
    await ensureSchema(connection);
    const company = await ensureDefaultCompany(connection);
    await backfill(connection, company.id);

    console.log('Multi-company migration completed.');
    console.log(`Default company: ${company.name}`);
    console.log(`Invite code: ${company.invite_code}`);
  } finally {
    connection.release();
  }
};

run()
  .catch((error) => {
    console.error('Multi-company migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
