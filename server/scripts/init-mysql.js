const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
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
  }
};

const ensureIndex = async (connection, tableName, indexName, indexDefinition) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [database, tableName, indexName]
  );

  if (Number(rows[0].count) === 0) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD ${indexDefinition}`);
  }
};

const dropIndexIfExists = async (connection, tableName, indexName) => {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [database, tableName, indexName]
  );

  if (Number(rows[0].count) > 0) {
    await connection.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``);
  }
};

const runMigrations = async (connection) => {
  await ensureColumn(connection, 'files', 'category', 'category VARCHAR(100) NULL');
  await ensureColumn(connection, 'files', 'version_label', "version_label VARCHAR(80) NOT NULL DEFAULT 'V1'");
  await ensureColumn(connection, 'files', 'effective_date', 'effective_date DATE NULL');
  await ensureColumn(connection, 'files', 'review_date', 'review_date DATE NULL');
  await ensureColumn(connection, 'files', 'issuer', 'issuer VARCHAR(100) NULL');
  await ensureColumn(connection, 'files', 'approver', 'approver VARCHAR(100) NULL');
  await ensureColumn(connection, 'files', 'icon', "icon VARCHAR(80) NOT NULL DEFAULT 'file-document-outline'");
  await ensureColumn(connection, 'files', 'color', "color VARCHAR(24) NOT NULL DEFAULT '#1F6F8B'");

  await ensureColumn(connection, 'file_versions', 'version_label', 'version_label VARCHAR(80) NULL');
  await ensureColumn(connection, 'file_versions', 'original_name', 'original_name VARCHAR(255) NULL');
  await ensureColumn(connection, 'file_versions', 'mime_type', 'mime_type VARCHAR(180) NULL');

  await ensureColumn(connection, 'private_share_requests', 'promoted_file_id', 'promoted_file_id BIGINT UNSIGNED NULL');
  await ensureIndex(connection, 'private_share_requests', 'idx_private_share_requests_promoted', 'INDEX idx_private_share_requests_promoted (promoted_file_id)');

  await ensureColumn(connection, 'audit_logs', 'generator', 'generator VARCHAR(40) NULL');
  await ensureColumn(connection, 'audit_logs', 'model', 'model VARCHAR(100) NULL');
  await ensureColumn(connection, 'audit_logs', 'prompt_tokens', 'prompt_tokens INT UNSIGNED NULL');
  await ensureColumn(connection, 'audit_logs', 'completion_tokens', 'completion_tokens INT UNSIGNED NULL');
  await ensureIndex(connection, 'audit_logs', 'idx_audit_logs_generator', 'INDEX idx_audit_logs_generator (actor_id, action, generator, created_at)');
  await ensureIndex(connection, 'audit_logs', 'idx_audit_logs_model', 'INDEX idx_audit_logs_model (actor_id, action, model, created_at)');

  await ensureColumn(connection, 'file_content_chunks', 'embedding', 'embedding JSON NULL');
  await ensureIndex(connection, 'file_content_chunks', 'idx_file_content_chunks_file', 'INDEX idx_file_content_chunks_file (file_id)');

  await dropIndexIfExists(connection, 'departments', 'uk_departments_name');
  await dropIndexIfExists(connection, 'departments', 'uk_departments_company_name');
  await ensureIndex(connection, 'departments', 'uk_departments_company_type_name', 'UNIQUE KEY uk_departments_company_type_name (company_id, type, name)');
};

const run = async () => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true,
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${database}\``);

    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await connection.query(schema);
    await runMigrations(connection);

    console.log(`MySQL schema initialized: ${database}`);
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('MySQL init failed:', error.message);
  process.exitCode = 1;
});
