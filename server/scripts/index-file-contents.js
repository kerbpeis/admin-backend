require('dotenv').config();

const { query, pool } = require('../config/db');
const { indexFileContent } = require('../utils/fileContentIndex');

// 回填所有现行资料的正文分块索引（智能体检索依据）。
// 用法：node scripts/index-file-contents.js
const main = async () => {
  const files = await query(
    `SELECT id, name, path, extension, mime_type FROM files WHERE status = 'active' ORDER BY id`
  );

  let indexed = 0;
  let empty = 0;
  let failed = 0;
  const failures = [];

  for (const file of files) {
    try {
      const result = await indexFileContent(file.id, file.path, file.extension);
      if (result.chunks > 0) {
        indexed += 1;
      } else {
        empty += 1;
      }
    } catch (error) {
      failed += 1;
      failures.push({ id: file.id, name: file.name, error: error.message });
    }
  }

  const [stats] = await query(
    `SELECT COUNT(DISTINCT file_id) AS fileCount, COUNT(*) AS chunkCount FROM file_content_chunks`
  );

  console.log(JSON.stringify({
    ok: failed === 0,
    total: files.length,
    indexed,
    empty,
    failed,
    failures: failures.slice(0, 10),
    index: {
      files: Number(stats.fileCount),
      chunks: Number(stats.chunkCount),
    },
  }, null, 2));

  if (failed > 0) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error('正文索引回填失败:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
