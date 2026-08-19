// OpenAI 兼容协议的 Embedding 客户端（DeepSeek / OpenAI / 自建服务均可）。
// 未配置 EMBEDDING_API_KEY 时视为未启用，调用方应回退到关键词检索。

const DEFAULT_API_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-embed';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BATCH_SIZE = 16;

const getConfig = () => ({
  apiKey: String(process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || '').trim(),
  apiBase: String(process.env.EMBEDDING_API_BASE || process.env.LLM_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, ''),
  model: String(process.env.EMBEDDING_MODEL || DEFAULT_MODEL).trim(),
  timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  batchSize: Number(process.env.EMBEDDING_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
});

const isEmbeddingConfigured = () => Boolean(getConfig().apiKey);

const getEmbeddingModel = () => (isEmbeddingConfigured() ? getConfig().model : null);

// 计算两个一维向量的余弦相似度
const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

// 调用 Embedding API 批量生成向量
const fetchEmbeddings = async (texts) => {
  const config = getConfig();
  if (!config.apiKey) throw new Error('未配置 EMBEDDING_API_KEY');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.apiBase}/embeddings`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: texts,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Embedding 服务返回 ${response.status}：${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const items = data?.data || [];
    // 按 index 排序，确保输出顺序与输入一致
    items.sort((x, y) => x.index - y.index);
    return items.map((item) => item.embedding);
  } finally {
    clearTimeout(timer);
  }
};

// 分批生成 embedding，避免单次请求过长
const generateEmbeddings = async (texts) => {
  const config = getConfig();
  const batchSize = config.batchSize;
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await fetchEmbeddings(batch);
    results.push(...batchEmbeddings);
  }
  return results;
};

// 为单个文本生成 embedding
const generateEmbedding = async (text) => {
  const embeddings = await generateEmbeddings([text]);
  return embeddings[0] || null;
};

module.exports = {
  getConfig,
  isEmbeddingConfigured,
  getEmbeddingModel,
  cosineSimilarity,
  generateEmbeddings,
  generateEmbedding,
};
