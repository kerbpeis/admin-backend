const { query } = require('../config/db');
const { toId } = require('../utils/mysqlUtils');
const { sendServerError } = require('../utils/serverError');
const { recordAuditLog } = require('../utils/auditLog');
const { chatJsonCompletion, isLlmConfigured } = require('../utils/llmClient');

const DAILY_DEFAULT_COUNT = 10;

const parseOptions = (value) => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
};

const serializeQuestion = (row, { withAnswer = false } = {}) => ({
  id: String(row.id),
  type: row.type,
  stem: row.stem,
  options: parseOptions(row.options),
  explanation: withAnswer ? row.explanation || '' : undefined,
  answer: withAnswer ? row.answer : undefined,
  source: row.source,
  sourceRef: row.source_ref || '',
});

// 题目归属范围：本公司题目 + 平台公共题库
const scopeSql = (companyId) => ({
  sql: '(company_id IS NULL OR company_id = ?)',
  params: [toId(companyId) || 0],
});

// 判分：单选/判断精确匹配；多选无序全对才算对
const isCorrect = (question, chosen) => {
  const norm = (v) => String(v || '').toUpperCase().replace(/[\s,、]/g, '').split('').sort().join('');
  return norm(question.answer) === norm(chosen);
};

// GET /api/quiz/daily — 今日刷题（本公司+公共题库随机 N 题）
const getDaily = async (req, res) => {
  try {
    const count = Math.min(Math.max(Number(req.query.count) || DAILY_DEFAULT_COUNT, 1), 50);
    const scope = scopeSql(req.user.companyId);
    const rows = await query(
      `SELECT * FROM quiz_questions WHERE status = 'active' AND ${scope.sql} ORDER BY RAND() LIMIT ?`,
      [...scope.params, count]
    );
    res.json({
      questions: rows.map((row) => serializeQuestion(row)),
      count: rows.length,
    });
  } catch (err) {
    sendServerError(res, err, '获取每日试题失败');
  }
};

// POST /api/quiz/answer — 提交答案，返回对错与解析
const submitAnswer = async (req, res) => {
  try {
    const questionId = toId(req.body?.questionId);
    const chosen = String(req.body?.chosen || '').trim();
    if (!questionId || !chosen) {
      return res.status(400).json({ message: '请提交题目和答案' });
    }

    const rows = await query('SELECT * FROM quiz_questions WHERE id = ? AND status = \'active\' LIMIT 1', [questionId]);
    const question = rows[0];
    if (!question) return res.status(404).json({ message: '题目不存在' });

    const correct = isCorrect(question, chosen);
    await query(
      'INSERT INTO quiz_attempts (user_id, question_id, chosen, correct) VALUES (?, ?, ?, ?)',
      [req.user.id, questionId, chosen.toUpperCase(), correct ? 1 : 0]
    );

    res.json({
      correct,
      answer: question.answer,
      explanation: question.explanation || '',
    });
  } catch (err) {
    sendServerError(res, err, '提交答案失败');
  }
};

// GET /api/quiz/stats — 今日进度 / 连续天数 / 错题数
const getStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const todayRows = await query(
      `SELECT COUNT(*) AS total, SUM(correct) AS correct FROM quiz_attempts
       WHERE user_id = ? AND created_at >= CURDATE()`,
      [userId]
    );

    // 连续学习天数：从今天往前数有答题记录的自然日
    const dayRows = await query(
      `SELECT DISTINCT DATE(created_at) AS day FROM quiz_attempts
       WHERE user_id = ? ORDER BY day DESC LIMIT 365`,
      [userId]
    );
    let streak = 0;
    const today = new Date();
    const daySet = new Set(dayRows.map((row) => new Date(row.day).toDateString()));
    for (let i = 0; i < 365; i += 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      // 今天还没答时不算断签，从昨天开始数
      if (i === 0 && !daySet.has(day.toDateString())) continue;
      if (!daySet.has(day.toDateString())) break;
      streak += 1;
    }

    const totalRows = await query(
      'SELECT COUNT(*) AS total, SUM(correct) AS correct FROM quiz_attempts WHERE user_id = ?',
      [userId]
    );

    // 错题数：最近一次答错且之后未答对过的题
    const wrongRows = await query(
      `SELECT COUNT(DISTINCT q.id) AS c FROM quiz_questions q
       JOIN quiz_attempts a ON a.question_id = q.id AND a.user_id = ?
       WHERE q.status = 'active'
       GROUP BY q.id
       HAVING SUBSTRING_INDEX(GROUP_CONCAT(a.correct ORDER BY a.created_at DESC), ',', 1) = '0'`,
      [userId]
    );

    res.json({
      today: {
        total: Number(todayRows[0]?.total) || 0,
        correct: Number(todayRows[0]?.correct) || 0,
      },
      streak,
      totalAnswered: Number(totalRows[0]?.total) || 0,
      totalCorrect: Number(totalRows[0]?.correct) || 0,
      wrongCount: wrongRows.length,
    });
  } catch (err) {
    sendServerError(res, err, '获取刷题统计失败');
  }
};

// GET /api/quiz/wrong — 错题本（最近答错且未翻正的题）
const getWrongBook = async (req, res) => {
  try {
    const rows = await query(
      `SELECT q.*, MAX(a.created_at) AS last_wrong_at FROM quiz_questions q
       JOIN quiz_attempts a ON a.question_id = q.id AND a.user_id = ?
       WHERE q.status = 'active'
       GROUP BY q.id
       HAVING SUBSTRING_INDEX(GROUP_CONCAT(a.correct ORDER BY a.created_at DESC), ',', 1) = '0'
       ORDER BY last_wrong_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json({
      questions: rows.map((row) => serializeQuestion(row, { withAnswer: true })),
    });
  } catch (err) {
    sendServerError(res, err, '获取错题本失败');
  }
};

const VALID_TYPES = new Set(['single', 'multi', 'judge']);

const validateQuestion = (item) => {
  const type = VALID_TYPES.has(item.type) ? item.type : null;
  const stem = String(item.stem || '').trim();
  const answer = String(item.answer || '').trim().toUpperCase();
  if (!type || !stem || !answer) return null;

  if (type === 'judge') {
    const normalized = answer === '正确' ? '对' : answer === '错误' ? '错' : answer;
    if (!['对', '错'].includes(normalized)) return null;
    return { type, stem, options: [], answer: normalized };
  }

  const options = (Array.isArray(item.options) ? item.options : [])
    .map((option) => String(option || '').trim())
    .filter(Boolean);
  if (options.length < 2) return null;

  const letters = new Set(options.map((_, index) => String.fromCharCode(65 + index)));
  const answerLetters = answer.replace(/[\s,、]/g, '').split('');
  if (!answerLetters.length || !answerLetters.every((letter) => letters.has(letter))) return null;
  if (type === 'single' && answerLetters.length !== 1) return null;
  if (type === 'multi' && answerLetters.length < 2) return null;

  return { type, stem, options, answer: answerLetters.sort().join('') };
};

const insertQuestions = async (items, { companyId, source, sourceRef, createdBy }) => {
  let inserted = 0;
  for (const item of items) {
    const valid = validateQuestion(item);
    if (!valid) continue;
    await query(
      `INSERT INTO quiz_questions (company_id, type, stem, options, answer, explanation, source, source_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        valid.type,
        valid.stem,
        JSON.stringify(valid.options),
        valid.answer,
        String(item.explanation || '').trim() || null,
        source,
        sourceRef || null,
        createdBy,
      ]
    );
    inserted += 1;
  }
  return inserted;
};

// POST /api/quiz/questions — 用户上传题目（单个或批量）
const uploadQuestions = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.questions) ? req.body.questions : [req.body];
    if (!items.length || !items[0]) {
      return res.status(400).json({ message: '请提交题目内容' });
    }
    const inserted = await insertQuestions(items, {
      companyId: toId(req.user.companyId),
      source: 'upload',
      sourceRef: String(req.body?.sourceRef || '').slice(0, 255),
      createdBy: req.user.id,
    });
    if (!inserted) return res.status(400).json({ message: '没有可入库的有效题目，请检查格式' });

    await recordAuditLog({
      req,
      action: 'quiz.upload',
      resourceType: 'quiz_question',
      resourceName: `上传 ${inserted} 道题`,
      metadata: { inserted },
    });
    res.status(201).json({ message: `已入库 ${inserted} 道题`, inserted });
  } catch (err) {
    sendServerError(res, err, '上传题目失败');
  }
};

// 解析粘贴的题库的文本，支持：
// 【单选】/【多选】/【判断】题干  A. 选项  B. 选项  答案：A  解析：...
const parseQuizText = (text) => {
  const blocks = String(text || '').split(/(?=【(?:单选|多选|判断)】)/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const typeMatch = block.match(/^【(单选|多选|判断)】/);
    if (!typeMatch) return null;
    const type = { 单选: 'single', 多选: 'multi', 判断: 'judge' }[typeMatch[1]];
    const answerMatch = block.match(/答案[:：]\s*([A-E对错正确错误]+)/);
    const explanationMatch = block.match(/解析[:：]\s*([\s\S]+)$/);
    const stemPart = block
      .replace(/^【(单选|多选|判断)】/, '')
      .split(/\n(?=[A-E][.、])|\n(?=答案[:：])|\n(?=解析[:：])/)[0]
      .trim();

    if (type === 'judge') {
      return { type, stem: stemPart, options: [], answer: answerMatch?.[1] || '', explanation: explanationMatch?.[1]?.trim() || '' };
    }

    const options = [];
    const optionRegex = /([A-E])[.、]\s*([^\n]+)/g;
    let optionMatch;
    while ((optionMatch = optionRegex.exec(block))) {
      options.push(optionMatch[2].trim());
    }
    return { type, stem: stemPart, options, answer: answerMatch?.[1] || '', explanation: explanationMatch?.[1]?.trim() || '' };
  }).filter(Boolean);
};

// POST /api/quiz/import-text — 粘贴文本批量导入（管理员/有上传权限的用户）
const importText = async (req, res) => {
  try {
    const items = parseQuizText(req.body?.text);
    if (!items.length) {
      return res.status(400).json({ message: '没有解析到题目，格式示例：【单选】题干 A. 选项 答案：A' });
    }
    const inserted = await insertQuestions(items, {
      companyId: toId(req.user.companyId),
      source: 'import',
      sourceRef: String(req.body?.sourceRef || '').slice(0, 255) || '文本导入',
      createdBy: req.user.id,
    });

    await recordAuditLog({
      req,
      action: 'quiz.import',
      resourceType: 'quiz_question',
      resourceName: `导入 ${inserted} 道题`,
      metadata: { parsed: items.length, inserted },
    });
    res.status(201).json({
      message: `解析 ${items.length} 道，入库 ${inserted} 道`,
      parsed: items.length,
      inserted,
    });
  } catch (err) {
    sendServerError(res, err, '导入题库失败');
  }
};

// POST /api/quiz/generate — AI 从资料库文档生成试题（需资料创建权限）
const generateFromDocument = async (req, res) => {
  try {
    if (!isLlmConfigured()) {
      return res.status(400).json({ message: '未配置 LLM_API_KEY，无法 AI 出题' });
    }
    const documentId = toId(req.body?.documentId);
    const count = Math.min(Math.max(Number(req.body?.count) || 5, 1), 20);
    if (!documentId) return res.status(400).json({ message: '请指定资料' });

    const docRows = await query(
      `SELECT id, name, description FROM files WHERE id = ? AND status = 'active' LIMIT 1`,
      [documentId]
    );
    const document = docRows[0];
    if (!document) return res.status(404).json({ message: '资料不存在' });

    const chunks = await query(
      'SELECT content FROM file_content_chunks WHERE file_id = ? ORDER BY chunk_index LIMIT 12',
      [documentId]
    );
    const material = chunks.map((chunk) => chunk.content).join('\n').slice(0, 6000);
    if (!material) {
      return res.status(400).json({ message: '该资料还没有正文索引，请先执行文件内容索引' });
    }

    const prompt = [
      `根据以下资料内容出 ${count} 道煤矿安全培训题，题型混合单选、多选、判断。`,
      '输出一个 JSON 对象，格式：{"questions":[...]}，每个元素：',
      '{"type":"single|multi|judge","stem":"题干","options":["选项A内容","选项B内容"],"answer":"A 或 AB 或 对/错","explanation":"解析"}',
      '判断题 options 给空数组。不要输出 JSON 以外的任何内容。',
      '',
      '资料内容：',
      material,
    ].join('\n');

    const llmResult = await chatJsonCompletion({
      system: '你是煤矿安全培训出题专家，只输出符合要求的 JSON。',
      user: prompt,
    });
    const parsed = llmResult?.content;
    const items = Array.isArray(parsed) ? parsed : (parsed?.questions || []);
    if (!items.length) {
      return res.status(502).json({ message: 'AI 返回格式异常，请重试' });
    }

    const inserted = await insertQuestions(Array.isArray(items) ? items : [], {
      companyId: toId(req.user.companyId),
      source: 'ai',
      sourceRef: document.name.slice(0, 255),
      createdBy: req.user.id,
    });
    if (!inserted) return res.status(502).json({ message: 'AI 出题未通过格式校验，请重试' });

    await recordAuditLog({
      req,
      action: 'quiz.generate',
      resourceType: 'quiz_question',
      resourceName: `AI 出题 ${inserted} 道（${document.name}）`,
      metadata: { documentId, inserted },
    });
    res.status(201).json({ message: `AI 已生成 ${inserted} 道题`, inserted });
  } catch (err) {
    sendServerError(res, err, 'AI 出题失败');
  }
};

module.exports = {
  getDaily,
  submitAnswer,
  getStats,
  getWrongBook,
  uploadQuestions,
  importText,
  generateFromDocument,
};
