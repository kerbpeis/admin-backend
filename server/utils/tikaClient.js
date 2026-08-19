const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getConfig: getRuntimeConfig } = require('./runtimeConfig');

const DEFAULT_TIKA_PORT = 9998;
const DEFAULT_TIKA_HOST = '127.0.0.1';
const TIKA_START_TIMEOUT_MS = 30000;

const getConfig = async () => {
  const runtime = await getRuntimeConfig();
  return {
    host: String(runtime.tikaHost || process.env.TIKA_HOST || DEFAULT_TIKA_HOST).trim(),
    port: Number(runtime.tikaPort || process.env.TIKA_PORT) || DEFAULT_TIKA_PORT,
    jarPath: String(runtime.tikaJarPath || process.env.TIKA_JAR_PATH || path.join(__dirname, '..', 'vendor', 'tika-server-standard-2.9.1.jar')).trim(),
    enabled: runtime.tikaEnabled !== false,
    autoStart: runtime.tikaAutoStart === true,
  };
};

const tikaUrl = (config) => `http://${config.host}:${config.port}`;

let tikaProcess = null;

// 检测 Tika Server 是否已可访问
const isRunning = async (config = null) => {
  const cfg = config || await getConfig();
  try {
    const response = await fetch(`${tikaUrl(cfg)}/`, { method: 'GET', signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
};

// 启动本地 Tika Server
const start = async (config = null) => {
  const cfg = config || await getConfig();
  if (!cfg.enabled) return false;
  if (await isRunning(cfg)) {
    console.log(`Tika Server already running at ${tikaUrl(cfg)}`);
    return true;
  }

  if (!cfg.autoStart) {
    console.warn('Tika Server 未运行且 TIKA_AUTO_START 未开启');
    return false;
  }

  if (!fs.existsSync(cfg.jarPath)) {
    console.warn(`Tika Server JAR 不存在: ${cfg.jarPath}`);
    return false;
  }

  console.log(`正在启动 Tika Server: ${cfg.jarPath} on port ${cfg.port}`);
  tikaProcess = spawn('java', ['-jar', cfg.jarPath, '-p', String(cfg.port)], {
    stdio: 'ignore',
    detached: false,
  });

  const startTime = Date.now();
  while (Date.now() - startTime < TIKA_START_TIMEOUT_MS) {
    if (await isRunning(cfg)) {
      console.log(`Tika Server 启动成功: ${tikaUrl(cfg)}`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.error('Tika Server 启动超时');
  return false;
};

// 停止本地启动的 Tika Server
const stop = () => {
  if (tikaProcess && !tikaProcess.killed) {
    tikaProcess.kill();
    tikaProcess = null;
    console.log('Tika Server 已停止');
  }
};

// 提取文件正文
const extractText = async (absolutePath, config = null) => {
  const cfg = config || await getConfig();
  if (!cfg.enabled) return null;
  if (!await isRunning(cfg)) {
    if (cfg.autoStart) {
      const started = await start(cfg);
      if (!started) return null;
    } else {
      return null;
    }
  }

  try {
    const fileBuffer = await fs.promises.readFile(absolutePath);
    const response = await fetch(`${tikaUrl(cfg)}/tika`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Accept: 'text/plain',
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Tika 解析失败 ${response.status}: ${body.slice(0, 200)}`);
    }

    const text = await response.text();
    return text;
  } catch (err) {
    console.warn(`Tika 提取失败 (${absolutePath}):`, err.message);
    return null;
  }
};

// 进程退出时关闭本地 Tika Server
process.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

module.exports = {
  getConfig,
  tikaUrl,
  isRunning,
  start,
  stop,
  extractText,
};
