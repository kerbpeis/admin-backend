const { isEmbeddingConfigured, generateEmbedding, cosineSimilarity } = require('./embeddingClient');
const { query } = require('../config/db');

const parseEmbedding = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// 对候选 chunks 做向量相似度重排。
// 先按关键词/LIKE召回候选（粗排），再对候选计算问题与 chunk 的 embedding 余弦相似度（精排）。
// 未配置 embedding 时直接返回原候选。
const rerankChunksByEmbedding = async (question, candidateChunks) => {
  if (!(await isEmbeddingConfigured()) || !candidateChunks.length) return candidateChunks;

  try {
    const questionEmbedding = await generateEmbedding(question);
    if (!questionEmbedding) return candidateChunks;

    return candidateChunks
      .map((chunk) => ({
        ...chunk,
        vectorScore: cosineSimilarity(questionEmbedding, chunk.embedding || []),
      }))
      .sort((a, b) => b.vectorScore - a.vectorScore);
  } catch (err) {
    console.warn('向量重排失败:', err.message);
    return candidateChunks;
  }
};

// 直接从数据库加载指定 fileId 列表的 chunks 及其 embedding
const loadChunkEmbeddings = async (fileIds) => {
  if (!fileIds.length) return new Map();
  const placeholders = fileIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT id, file_id, chunk_index, content, embedding FROM file_content_chunks
     WHERE file_id IN (${placeholders}) AND embedding IS NOT NULL`,
    fileIds
  );

  const byFile = new Map();
  rows.forEach((row) => {
    const parsed = parseEmbedding(row.embedding);
    if (!parsed) return;
    const chunk = {
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      embedding: parsed,
    };
    if (!byFile.has(row.file_id)) byFile.set(row.file_id, []);
    byFile.get(row.file_id).push(chunk);
  });
  return byFile;
};

module.exports = {
  rerankChunksByEmbedding,
  loadChunkEmbeddings,
  cosineSimilarity,
};
