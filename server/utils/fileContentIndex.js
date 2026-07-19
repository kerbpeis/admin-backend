const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');

// 单份资料最多入库的字符/段落数，避免超大文件拖垮检索。
const MAX_EXTRACT_CHARS = 120000;
const MAX_CHUNKS_PER_FILE = 240;
const CHUNK_TARGET_CHARS = 480;
const CHUNK_MAX_CHARS = 640;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'log']);

const resolveStoredPath = (storedPath) => {
  if (!storedPath) return null;
  return path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(__dirname, '..', storedPath);
};

const normalizeExtractedText = (text) => String(text || '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, MAX_EXTRACT_CHARS);

const extractRawText = async (absolutePath, extension) => {
  const ext = String(extension || path.extname(absolutePath).replace('.', '')).toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    return fs.promises.readFile(absolutePath, 'utf8');
  }

  if (ext === 'docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: absolutePath });
    return result.value || '';
  }

  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = await fs.promises.readFile(absolutePath);
    const result = await pdfParse(buffer);
    return result.text || '';
  }

  return '';
};

// 按段落聚合成分块：每块约 480 字，上限 640 字，保持段落完整便于引用。
const chunkText = (text) => {
  const paragraphs = normalizeExtractedText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };

  paragraphs.forEach((paragraph) => {
    if (paragraph.length > CHUNK_MAX_CHARS) {
      flush();
      for (let index = 0; index < paragraph.length; index += CHUNK_TARGET_CHARS) {
        chunks.push(paragraph.slice(index, index + CHUNK_TARGET_CHARS));
      }
      return;
    }
    if (current && current.length + paragraph.length + 1 > CHUNK_TARGET_CHARS) {
      flush();
    }
    current = current ? `${current}\n${paragraph}` : paragraph;
  });
  flush();

  return chunks.slice(0, MAX_CHUNKS_PER_FILE);
};

// 提取资料正文并重建分块索引；提取不到文本（如扫描件、未知格式）时清空旧索引。
// 返回 { chunks, chars }；文件缺失或解析失败抛错，由调用方决定如何处理。
const indexFileContent = async (fileId, storedPath, extension) => {
  const absolutePath = resolveStoredPath(storedPath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(`源文件不存在: ${storedPath}`);
  }

  const rawText = await extractRawText(absolutePath, extension);
  const chunks = chunkText(rawText);

  await query('DELETE FROM file_content_chunks WHERE file_id = ?', [fileId]);
  if (chunks.length) {
    const values = chunks.map((content, index) => [fileId, index, content, content.length]);
    const placeholders = values.map(() => '(?, ?, ?, ?)').join(', ');
    await query(
      `INSERT INTO file_content_chunks (file_id, chunk_index, content, char_count) VALUES ${placeholders}`,
      values.flat()
    );
  }

  return { chunks: chunks.length, chars: chunks.reduce((sum, chunk) => sum + chunk.length, 0) };
};

// 上传流程调用：索引失败不阻断上传，只记录日志。
const indexFileContentSafely = async (fileId, storedPath, extension) => {
  try {
    return await indexFileContent(fileId, storedPath, extension);
  } catch (error) {
    console.warn(`资料正文索引失败 (file ${fileId}):`, error.message);
    return { chunks: 0, chars: 0, error: error.message };
  }
};

module.exports = {
  chunkText,
  extractRawText,
  indexFileContent,
  indexFileContentSafely,
  resolveStoredPath,
};
