// 日志脱敏：打印请求体前隐藏敏感字段
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'jwt',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
]);

const maskValue = () => '***';

const sanitize = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);

  const result = {};
  for (const [key, val] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    result[key] = SENSITIVE_KEYS.has(lowerKey) || SENSITIVE_KEYS.has(key) ? maskValue() : sanitize(val);
  }
  return result;
};

module.exports = { sanitize };
