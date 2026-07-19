const express = require('express');
const { connectDB, getDatabaseStatus } = require('./config/db');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 配置中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 上传文件必须通过 /api/files/:id/download 鉴权下载，不公开暴露 uploads 目录。

// 配置路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/library-documents', require('./routes/libraryDocuments'));
app.use('/api/files', require('./routes/files'));
app.use('/api/knowledge-points', require('./routes/knowledgePoints'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/partner-state', require('./routes/partnerState'));
app.use('/api/private-knowledge', require('./routes/privateKnowledge'));
app.use('/api/agent', require('./routes/agent'));

// 健康检查路由
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running',
    database: getDatabaseStatus()
  });
});

// 启动服务器
const PORT = process.env.PORT || 3001;

// 尝试连接数据库，但不阻止服务器启动
connectDB().then((connected) => {
  if (!connected) {
    console.log('Database-backed routes will return errors until MySQL is available.');
  }
}).catch(err => {
  console.log('MySQL connection error:', err.message);
  console.log('Server will start without MySQL connection...');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
