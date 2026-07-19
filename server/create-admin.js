const bcrypt = require('bcryptjs');
const { pool, query } = require('./config/db');
require('dotenv').config();

const createAdmin = async () => {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO users (name, email, password_hash, department, section, is_admin)
     VALUES ('管理员', ?, ?, '生产技术', '采煤管理室', 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), department = VALUES(department), section = VALUES(section), is_admin = 1`,
    [email, passwordHash]
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
