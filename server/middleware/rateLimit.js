// 内存滑动窗口限流中间件（单进程部署适用）。
// 注意：多实例/多进程部署时计数不共享，需替换为 Redis 等集中式计数。
const createRateLimiter = ({ windowMs, max, keyFn, message = '请求过于频繁，请稍后再试' } = {}) => {
  const hits = new Map(); // key -> number[]（窗口内的时间戳）

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const alive = timestamps.filter((ts) => ts > cutoff);
      if (alive.length) hits.set(key, alive);
      else hits.delete(key);
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
