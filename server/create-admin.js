const bcrypt = require('bcryptjs');
const { pool, query } = require('./config/db');
require('dotenv').config();

const createAdmin = async () => {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(password, 12);

  // 与 scripts/seed.js 的 upsertAdmin 对齐：关联现有 id 最小的公司，并设为平台超管
  const companyRows = await query('SELECT id FROM companies ORDER BY id LIMIT 1');
  const companyId = companyRows[0]?.id || null;

  await query(
    `INSERT INTO users (company_id, name, email, password_hash, department, section, is_admin, platform_role)
     VALUES (?, '管理员', ?, ?, '生产技术', '采煤管理室', 1, 'super_admin')
     ON DUPLICATE KEY UPDATE
       company_id = VALUES(company_id),
       name = VALUES(name),
       department = VALUES(department),
       section = VALUES(section),
       is_admin = 1,
       platform_role = 'super_admin'`,
    [companyId, email, passwordHash]
  );

  console.log('管理员账号已创建或更新');
  console.log(`账号: ${email}`);
  console.log(`密码: ${password}`);
};

createAdmin()
  .catch((error) => {
    console.error('创建管理员账号失败:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
