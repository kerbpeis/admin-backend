// AI 问答答案缓存：同一公司里相同问题在 TTL 内直接返回缓存，LLM 零调用。
// 单进程内存缓存（与限流器同一假设）；多实例部署时需换成 Redis 等共享存储。
//
// 成本逻辑：缓存命中的回答审计记为 generator='cache'，
// 不计入 countTodayLlmCalls 的每日 LLM 次数。

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天，覆盖大多数资料更新周期
const MAX_ENTRIES = 500;

const store = new Map(); // key -> { answer, meta, createdAt, expiresAt }

const getTtlMs = () => Number(process.env.AGENT_ANSWER_CACHE_TTL_MS) || DEFAULT_TTL_MS;

// 问题归一化：忽略大小写、空白和常见标点，让"过断层措施？"和"过断层措施"命中同一缓存
const normalizeKey = (text) => String(text || '')
  .toLowerCase()
  .replace(/[\s　]+/g, '')
  .replace(/[？?！!。.,，、；;：:"'「」()（）]/g, '');

const buildKey = ({ companyId, question, referencedDocumentId }) => [
  companyId || 'global',
  normalizeKey(question),
  referencedDocumentId || '',
].join('|');

const evictExpired = () => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
};

const get = (keyParts) => {
  const key = buildKey(keyParts);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry;
};

const set = (keyParts, value) => {
  evictExpired();
  // 超出容量时淘汰最旧的一批
  if (store.size >= MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    oldest.slice(0, Math.ceil(MAX_ENTRIES * 0.2)).forEach(([key]) => store.delete(key));
  }
  const now = Date.now();
  store.set(buildKey(keyParts), {
    ...value,
    createdAt: now,
    expiresAt: now + getTtlMs(),
  });
};

// 资料变更时冲刷该公司的缓存（上传/删除/新版本都会改变答案依据）
const flushCompany = (companyId) => {
  const prefix = `${companyId || 'global'}|`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
};

const stats = () => ({ entries: store.size });

module.exports = { get, set, flushCompany, stats };
