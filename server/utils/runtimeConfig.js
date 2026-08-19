const { query } = require('../config/db');

const CACHE_TTL_MS = 30 * 1000;

let cache = null;
let cacheExpiresAt = 0;

const DEFAULTS = {
  // LLM
  llmEnabled: true,
  llmApiBase: 'https://api.deepseek.com/v1',
  llmModel: 'deepseek-chat',
  llmTimeoutMs: 20000,
  llmMaxTokens: 1200,
  // Embedding
  embeddingEnabled: false,
  embeddingApiBase: 'https://api.deepseek.com/v1',
  embeddingModel: 'deepseek-embed',
  embeddingTimeoutMs: 30000,
  embeddingBatchSize: 16,
  // Tika
  tikaEnabled: true,
  tikaAutoStart: false,
  tikaHost: '127.0.0.1',
  tikaPort: 9998,
  tikaJarPath: 'vendor/tika-server-standard-2.9.1.jar',
  // Agent
  agentLlmDailyLimit: 0,
  agentLlmHardTimeoutMs: 8000,
  agentAnswerCacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  agentLlmSkipOnClauseHit: true,
};

const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return Boolean(value);
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeValue = (key, value) => {
  if (value == null) return undefined;
  if (key.endsWith('Enabled') || key.startsWith('agentLlmSkipOnClauseHit')) {
    return toBoolean(value);
  }
  if (key.endsWith('TimeoutMs') || key.endsWith('MaxTokens') || key.endsWith('BatchSize') || key.endsWith('TtlMs') || key.endsWith('DailyLimit') || key.endsWith('Port')) {
    return toNumber(value, DEFAULTS[key]);
  }
  return value;
};

const loadFromDatabase = async () => {
  const rows = await query('SELECT config_key, config_value FROM runtime_settings');
  const config = {};
  rows.forEach((row) => {
    const key = row.config_key;
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      config[key] = normalizeValue(key, row.config_value);
    }
  });
  return { ...DEFAULTS, ...config };
};

const getConfig = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && cache && cacheExpiresAt > now) {
    return cache;
  }

  try {
    cache = await loadFromDatabase();
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cache;
  } catch (err) {
    console.warn('加载运行时配置失败:', err.message);
    return cache || DEFAULTS;
  }
};

const getValue = async (key, fallback = undefined) => {
  const config = await getConfig();
  return config[key] !== undefined ? config[key] : fallback;
};

const setValue = async (key, value, { updatedBy = null, description = '' } = {}) => {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new Error(`未知配置项: ${key}`);
  }
  const normalized = normalizeValue(key, value);
  const storedValue = normalized !== undefined ? normalized : null;

  await query(
    `INSERT INTO runtime_settings (config_key, config_value, description, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       config_value = VALUES(config_value),
       description = VALUES(description),
       updated_by = VALUES(updated_by)`,
    [key, JSON.stringify(storedValue), description, updatedBy]
  );

  cache = null;
  return normalized;
};

const setMany = async (items, { updatedBy = null } = {}) => {
  const results = {};
  for (const [key, value] of Object.entries(items)) {
    results[key] = await setValue(key, value, { updatedBy });
  }
  return results;
};

const getAll = async () => getConfig(true);

const getPublicConfig = async () => {
  const config = await getConfig();
  // 不返回 API Key 等敏感字段的 key 列表（当前运行时配置不包含密钥，仅包含开关和参数）
  return config;
};

module.exports = {
  DEFAULTS,
  getConfig,
  getValue,
  setValue,
  setMany,
  getAll,
  getPublicConfig,
};
