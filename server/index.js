const express = require('express');
const { connectDB, getDatabaseStatus, pool, requireDatabase } = require('./config/db');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { sanitize } = require('./utils/sanitizeLog');
require('dotenv').config();

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

// 生产环境必须显式配置 JWT_SECRET，缺失时拒绝启动
if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('生产环境必须配置 JWT_SECRET 环境变量');
}

// 部署在 Nginx 等反向代理之后时设为 true，req.ip 与限流才能按真实客户端 IP 统计
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// 安全响应头与响应压缩
app.use(helmet());
app.use(compression());

// CORS 白名单：CORS_ORIGINS 逗号分隔；未配置时开发环境放行全部，生产环境拒绝跨域
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : (isProduction ? false : true),
}));

// 配置中间件
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// 上传文件必须通过 /api/files/:id/download 鉴权下载，不公开暴露 uploads 目录。

// 请求响应时间日志：便于排查慢接口和高频请求
// 设置 DEBUG_LOG_BODY=true 时会在日志末尾追加脱敏后的请求体
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const contentLength = res.getHeader('content-length') || '-';
    const parts = [`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms ${contentLength}b`];
    if (process.env.DEBUG_LOG_BODY === 'true' && req.body && Object.keys(req.body).length) {
      parts.push(JSON.stringify(sanitize(req.body)));
    }
    console.log(parts.join(' | '));
  });
  next();
});

// 数据库连接检查：所有 /api 路由在数据库不可用时直接返回 503
app.use('/api', requireDatabase);

// 配置路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', require('./routes/companies'));
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
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/config', require('./routes/config'));

// 健康检查路由：数据库异常时返回 503，便于负载均衡/监控识别
app.get('/health', (req, res) => {
  const dbStatus = getDatabaseStatus();
  const healthy = dbStatus === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    message: healthy ? 'Server is running' : 'Server running, database unavailable',
    database: dbStatus
  });
});

// 未匹配到的接口统一返回 JSON 404
app.use((req, res) => {
  res.status(404).json({ message: '接口不存在' });
});

// 全局错误处理：JSON 解析失败、请求体超限等返回 JSON 而非默认 HTML 错误页
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: '请求体过大' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: '请求体 JSON 格式不正确' });
  }
  const requestContext = {
    method: req.method,
    url: req.originalUrl,
    body: req.body && Object.keys(req.body).length ? sanitize(req.body) : undefined,
  };
  console.error(`未处理的服务器错误 [${req.method} ${req.originalUrl}]:`, err, requestContext);
  return res.status(err.status || 500).json({ message: '服务器内部错误' });
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

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 未捕获的 Promise 异常：记录日志，避免静默失败
process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 异常:', reason);
});

// 优雅关闭：停止接收新连接，等待存量请求完成后关闭数据库连接池
const shutdown = (signal) => {
  console.log(`收到 ${signal}，正在优雅关闭...`);
  server.close(async () => {
    try {
      await pool.end();
    } catch (err) {
      console.error('关闭数据库连接池失败:', err.message);
    } finally {
      process.exit(0);
    }
  });
  // 10 秒兜底，防止存量请求一直不结束
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
