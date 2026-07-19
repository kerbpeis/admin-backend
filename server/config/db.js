const mysql = require('mysql2/promise');
require('dotenv').config();

let databaseStatus = 'disconnected';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'admin_backend',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

const query = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows;
};

const withTransaction = async (callback) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const connectDB = async () => {
  try {
    await query('SELECT 1');
    databaseStatus = 'connected';
    console.log('MySQL Connected...');
    return true;
  } catch (err) {
    databaseStatus = 'disconnected';
    console.error('MySQL connection error:', err.message);
    console.error('Server will continue running without MySQL connection...');
    return false;
  }
};

const getDatabaseStatus = () => databaseStatus;

const isDuplicateKeyError = (error) => error && error.code === 'ER_DUP_ENTRY';

module.exports = {
  pool,
  query,
  withTransaction,
  connectDB,
  getDatabaseStatus,
  isDuplicateKeyError,
};
