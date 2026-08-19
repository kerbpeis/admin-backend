// 历史 audit_logs 回填：将 metadata 中的 generator / llmUsage tokens 写入独立列，
// 使新增索引生效，避免 JSON_EXTRACT 全表扫描。
// 仅运行一次：node scripts/migrate-audit-logs.js

const { pool, query } = require('../config/db');

const BATCH_SIZE = 500;

const run = async () => {
  let migrated = 0;
  let offset = 0;

  while (true) {
    const rows = await query(
      `SELECT id, metadata FROM audit_logs
       WHERE generator IS NULL AND metadata IS NOT NULL
       LIMIT ? OFFSET ?`,
      [BATCH_SIZE, offset]
    );
    if (!rows.length) break;

    for (const row of rows) {
      let metadata;
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = {};
      }

      const generator = metadata?.generator || null;
      const model = metadata?.model || null;
      const promptTokens = metadata?.llmUsage?.promptTokens ?? null;
      const completionTokens = metadata?.llmUsage?.completionTokens ?? null;

      if (generator || promptTokens != null || completionTokens != null) {
        await query(
          `UPDATE audit_logs
           SET generator = ?, model = ?, prompt_tokens = ?, completion_tokens = ?
           WHERE id = ?`,
          [generator, model, promptTokens, completionTokens, row.id]
        );
        migrated += 1;
      }
    }

    offset += BATCH_SIZE;
    console.log(`已迁移 ${migrated} 条，当前偏移 ${offset}`);
  }

  console.log(`历史 audit_logs 回填完成，共 ${migrated} 条`);
};

run()
  .catch((error) => {
    console.error('回填失败:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
