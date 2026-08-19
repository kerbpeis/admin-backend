// 内存滑动窗口限流中间件（单进程部署适用）。
// 注意：多实例/多进程部署时计数不共享，需替换为 Redis 等集中式计数。
const DEFAULT_MAX_KEYS = 10000;

const createRateLimiter = ({ windowMs, max, keyFn, message = '请求过于频繁，请稍后再试', maxKeys = DEFAULT_MAX_KEYS } = {}) => {
  const hits = new Map(); // key -> number[]（窗口内的时间戳）

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const alive = timestamps.filter((ts) => ts > cutoff);
      if (alive.length) hits.set(key, alive);
      else hits.delete(key);
    }

    // 防止大量不同 key 导致内存无限增长：按最早时间戳淘汰最老的 key
    if (hits.size > maxKeys) {
      const entries = Array.from(hits.entries())
        .map(([key, timestamps]) => ({ key, oldest: timestamps[0] || 0 }))
        .sort((a, b) => a.oldest - b.oldest);
      const evictCount = Math.max(1, Math.floor(entries.length * 0.2));
      for (let i = 0; i < evictCount; i += 1) {
        hits.delete(entries[i].key);
      }
    }
  }, Math.max(windowMs, 60000));
  cleanup.unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(key) || []).filter((ts) => ts > cutoff);

    if (timestamps.length >= max) {
      const retryAfterSeconds = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ message, retryAfterSeconds });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
};

module.exports = { createRateLimiter };
