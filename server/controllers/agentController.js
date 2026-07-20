const { query } = require('../config/db');
const { PERMISSIONS, hasPermission } = require('../utils/authorization');
const { buildVisibilityFilter } = require('../utils/resourceAccess');
const { toId } = require('../utils/mysqlUtils');
const { recordAuditLog } = require('../utils/auditLog');
const { clauseNumberToInt } = require('../utils/fileContentIndex');

const MAX_QUESTION_LENGTH = 1200;
const MAX_CONTEXT_TEXT_LENGTH = 900;
const MAX_LIBRARY_SOURCES = 5;
const MAX_PRIVATE_SOURCES = 4;
const MAX_TOTAL_SOURCES = 6;
const MAX_TERM_COUNT = 24;
const MAX_PASSAGE_FILES = 4;
const MAX_PASSAGES_PER_FILE = 2;
const PASSAGE_SNIPPET_CHARS = 180;

const baseDocumentSelect = `
  SELECT f.*,
    u.name AS uploaded_by_name, u.email AS uploaded_by_email, u.department AS uploaded_by_department, u.section AS uploaded_by_section,
    d.name AS department_name, d.type AS department_type, dp.name AS department_parent_name,
    p.name AS profession_name, p.type AS profession_type,
    kp.name AS knowledge_point_name
  FROM files f
  LEFT JOIN users u ON u.id = f.uploaded_by
  LEFT JOIN departments d ON d.id = f.department_id
  LEFT JOIN departments dp ON dp.id = d.parent_department_id
  LEFT JOIN departments p ON p.id = f.profession_id
  LEFT JOIN knowledge_points kp ON kp.id = f.knowledge_point_id
`;

const domainTerms = [
  '综采', '工作面', '断层', '构造', '过构造', '地质', '支护', '超前', '会审',
  '瓦斯', '抽采', '通风', '超限', '传感器', '停电', '撤人',
  '动火', '检维修', '监护', '审批', '气体检测', '消防',
  '探放水', '水害', '钻孔', '验收', '涌水', '排水',
  '规程', '措施', '清单', '记录', '复审', '版本', '执行',
];

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const formatDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const parseTags = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value).split(',').map((tag) => tag.trim()).filter(Boolean);
  }
};

const normalizeQuestion = (value) => String(value || '').trim().slice(0, MAX_QUESTION_LENGTH);

const normalizeContextText = (value) => String(value || '').trim().slice(0, MAX_CONTEXT_TEXT_LENGTH);

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const extractTerms = (question) => {
  const normalized = question.toLowerCase();
  const terms = domainTerms.filter((term) => normalized.includes(term.toLowerCase()));
  const tokens = normalized.match(/[a-z0-9_#.-]{2,}|[\u4e00-\u9fa5]{2,}/gi) || [];

  tokens.forEach((token) => {
    if (/^[\u4e00-\u9fa5]+$/.test(token) && token.length > 8) {
      for (let index = 0; index < token.length - 1 && terms.length < 18; index += 2) {
        terms.push(token.slice(index, index + 2));
      }
      return;
    }
    terms.push(token);
  });

  return unique(terms)
    .filter((term) => term.length >= 2)
    .slice(0, MAX_TERM_COUNT);
};

const normalizeContextSource = (source = {}) => ({
  sourceType: String(source.sourceType || ''),
  documentId: source.documentId || (source.sourceType === 'library_document' ? source.id : null),
  privateItemId: source.privateItemId,
  readingId: source.readingId,
  title: normalizeContextText(source.title).slice(0, 120),
  summary: normalizeContextText(source.summary).slice(0, 260),
  owner: normalizeContextText(source.owner).slice(0, 80),
  category: normalizeContextText(source.category).slice(0, 80),
  tags: Array.isArray(source.tags) ? source.tags.slice(0, 6).map((tag) => String(tag).slice(0, 40)) : [],
});

const normalizeAgentContext = (context = {}) => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {
      isFollowup: false,
      previousQuestion: '',
      previousConclusion: '',
      previousSummary: '',
      previousSources: [],
      queryTerms: [],
    };
  }

  return {
    isFollowup: Boolean(context.isFollowup),
    referencedDocumentId: context.referencedDocumentId,
    previousQuestion: normalizeContextText(context.previousQuestion),
    previousConclusion: normalizeContextText(context.previousConclusion),
    previousSummary: normalizeContextText(context.previousSummary),
    previousSources: Array.isArray(context.previousSources)
      ? context.previousSources.slice(0, 6).map(normalizeContextSource)
      : [],
    queryTerms: Array.isArray(context.queryTerms)
      ? context.queryTerms.slice(0, 12).map((term) => String(term || '').trim()).filter(Boolean)
      : [],
  };
};

const extractContextTerms = (context) => {
  if (!context?.isFollowup) return [];
  const sourceText = context.previousSources
    .map((source) => [source.title, source.summary, source.owner, source.category, ...(source.tags || [])].filter(Boolean).join(' '))
    .join(' ');
  return unique([
    ...context.queryTerms,
    ...extractTerms(context.previousQuestion),
    ...extractTerms(context.previousConclusion),
    ...extractTerms(context.previousSummary),
    ...extractTerms(sourceText),
  ]).slice(0, MAX_TERM_COUNT);
};

const mergeTerms = (questionTerms, contextTerms) => unique([...questionTerms, ...contextTerms]).slice(0, MAX_TERM_COUNT);

const sourceText = (source) => [
  source.title,
  source.summary,
  source.owner,
  source.profession,
  source.section,
  source.category,
  ...(source.tags || []),
].filter(Boolean).join(' ').toLowerCase();

const scoreSource = (source, terms) => {
  if (!terms.length) return source.sourceType === 'library_document' ? 1 : 0.6;
  const title = String(source.title || '').toLowerCase();
  const text = sourceText(source);
  return terms.reduce((score, term) => {
    const normalized = term.toLowerCase();
    if (!normalized) return score;
    return score
      + (title.includes(normalized) ? 4 : 0)
      + (text.includes(normalized) ? 2 : 0);
  }, source.pinned ? 1.5 : 0);
};

const serializeDocumentSource = (row, score = 0) => ({
  id: String(row.id),
  documentId: String(row.id),
  sourceType: 'library_document',
  typeLabel: '资料库',
  title: row.name,
  owner: row.issuer || row.department_parent_name || row.profession_name || row.uploaded_by_department || '资料库',
  profession: row.profession_name || row.uploaded_by_department || '',
  section: row.department_name || row.uploaded_by_section || '',
  category: row.category || row.knowledge_point_name || row.extension || '资料',
  version: row.version_label || `V${row.current_version || 1}`,
  updatedAt: formatDate(row.updated_at),
  effectiveDate: formatDate(row.effective_date),
  reviewDate: formatDate(row.review_date),
  tags: parseTags(row.tags),
  summary: row.description || '',
  icon: row.icon || 'file-document-outline',
  color: row.color || '#1F6F8B',
  sourceFile: {
    name: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size || 0),
    downloadUrl: `/api/library-documents/${row.id}/download`,
  },
  score,
});

const serializePrivateItemSource = (row, score = 0) => {
  const payload = parseJson(row.payload, {});
  return {
    ...payload,
    id: `private-${row.local_id}`,
    privateItemId: row.local_id,
    sourceType: 'private_knowledge',
    typeLabel: '我的资料',
    title: row.title || payload.title || '个人知识',
    owner: row.source_title || payload.sourceTitle || '我的',
    profession: payload.profession || '',
    section: payload.section || '',
    category: payload.category || row.type || '个人资料',
    version: payload.fileName || payload.groupName || '个人知识',
    updatedAt: formatDate(row.source_updated_at || row.updated_at),
    tags: toArray(parseJson(row.tags, payload.tags || [])),
    summary: payload.summary || '',
    icon: payload.icon || 'file-link-outline',
    color: payload.color || '#2F9E7E',
    pinned: Boolean(Number(row.pinned)),
    score,
  };
};

const serializeReadingSource = (row, score = 0) => {
  const payload = parseJson(row.payload, {});
  return {
    ...payload,
    id: `reading-${row.local_id}`,
    readingId: row.local_id,
    sourceType: 'reading_history',
    typeLabel: '最近阅读',
    title: row.title || payload.title || '最近阅读资料',
    owner: row.owner || payload.owner || '最近阅读',
    category: row.category || payload.category || '最近阅读',
    version: payload.version || '阅读记录',
    updatedAt: formatDate(row.opened_at || row.updated_at),
    tags: toArray(payload.tags),
    summary: payload.summary || '',
    icon: payload.icon || 'book-open-page-variant-outline',
    color: payload.color || '#1F6F8B',
    score,
  };
};

const buildLikeFilter = (terms, fields) => {
  if (!terms.length) return { sql: '', params: [] };
  const clauses = [];
  const params = [];
  terms.slice(0, 8).forEach((term) => {
    fields.forEach((field) => {
      clauses.push(`${field} LIKE ?`);
      params.push(`%${term}%`);
    });
  });
  return {
    sql: ` AND (${clauses.join(' OR ')})`,
    params,
  };
};

const trimPassage = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, PASSAGE_SNIPPET_CHARS);

const CLAUSE_QUERY_RE = /第\s*([0-9零一二两三四五六七八九十百千]+)\s*条/g;
const MAX_CLAUSE_MATCHES = 6;

// 从问题中提取“第X条”引用，返回条款数值（去重，最多 4 个）
const extractClauseNumbers = (question) => {
  const numbers = [];
  const regex = new RegExp(CLAUSE_QUERY_RE.source, 'g');
  let match = regex.exec(question);
  while (match && numbers.length < 4) {
    const value = clauseNumberToInt(match[1]);
    if (value) numbers.push(value);
    match = regex.exec(question);
  }
  return unique(numbers);
};

// 按条款号直接命中资料正文条款，按资料标题与问题的相关度排序
const fetchClauseMatches = async (user, clauseNumbers, terms) => {
  if (!clauseNumbers.length || !hasPermission(user, PERMISSIONS.FILE_READ)) return [];
  const visibilityFilter = await buildVisibilityFilter(user, 'f', 'uploaded_by');
  const rows = await query(
    `SELECT fc.file_id, fc.clause_no, fc.clause_no_num, fc.content,
       f.name AS file_name, f.version_label, f.current_version, f.updated_at
     FROM file_clauses fc
     JOIN files f ON f.id = fc.file_id
     WHERE f.status = 'active' AND ${visibilityFilter.sql}
       AND fc.clause_no_num IN (${clauseNumbers.map(() => '?').join(',')})
     ORDER BY f.updated_at DESC, fc.clause_no_num ASC
     LIMIT 24`,
    [...visibilityFilter.params, ...clauseNumbers]
  );

  const titleRelevance = (title) => {
    const lower = String(title || '').toLowerCase();
    return terms.reduce((score, term) => score + (lower.includes(String(term).toLowerCase()) ? 1 : 0), 0);
  };

  return rows
    .map((row) => ({
      fileId: String(row.file_id),
      documentTitle: row.file_name,
      version: row.version_label || `V${row.current_version || 1}`,
      clauseNo: row.clause_no,
      clauseNoNum: Number(row.clause_no_num),
      text: trimPassage(row.content),
      relevance: titleRelevance(row.file_name),
    }))
    .sort((a, b) => b.relevance - a.relevance || a.clauseNoNum - b.clauseNoNum)
    .slice(0, MAX_CLAUSE_MATCHES);
};

const scoreChunkContent = (content, terms) => {
  const lower = String(content || '').toLowerCase();
  if (!lower) return 0;
  return terms.reduce((score, term) => {
    const normalized = String(term || '').toLowerCase();
    if (!normalized) return score;
    const hits = lower.split(normalized).length - 1;
    return score + Math.min(hits, 4);
  }, 0);
};

// 在资料正文分块索引中检索命中段落，返回 Map: fileId -> { score, passages }
const fetchContentPassages = async (user, terms) => {
  const passages = new Map();
  if (!terms.length || !hasPermission(user, PERMISSIONS.FILE_READ)) return passages;

  const visibilityFilter = await buildVisibilityFilter(user, 'f', 'uploaded_by');
  const likeFilter = buildLikeFilter(terms, ['c.content']);
  if (!likeFilter.sql) return passages;

  const rows = await query(
    `SELECT c.file_id, c.chunk_index, c.content
     FROM file_content_chunks c
     JOIN files f ON f.id = c.file_id
     WHERE f.status = 'active' AND ${visibilityFilter.sql}${likeFilter.sql}
     ORDER BY c.file_id, c.chunk_index
     LIMIT 400`,
    [...visibilityFilter.params, ...likeFilter.params]
  );

  const byFile = new Map();
  rows.forEach((row) => {
    const key = String(row.file_id);
    const entry = byFile.get(key) || { fileId: row.file_id, score: 0, chunks: [] };
    const chunkScore = scoreChunkContent(row.content, terms);
    entry.score += chunkScore;
    entry.chunks.push({ chunkIndex: row.chunk_index, text: row.content, score: chunkScore });
    byFile.set(key, entry);
  });

  Array.from(byFile.values())
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PASSAGE_FILES)
    .forEach((entry) => {
      const topChunks = entry.chunks
        .filter((chunk) => chunk.score > 0)
        .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
        .slice(0, MAX_PASSAGES_PER_FILE)
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((chunk) => ({ chunkIndex: chunk.chunkIndex, text: trimPassage(chunk.text) }));
      passages.set(String(entry.fileId), { score: entry.score, passages: topChunks });
    });

  return passages;
};

const fetchReferencedDocument = async (user, referencedDocumentId) => {
  const id = toId(referencedDocumentId);
  if (!id || !hasPermission(user, PERMISSIONS.FILE_READ)) return [];
  const visibilityFilter = await buildVisibilityFilter(user, 'f', 'uploaded_by');
  const rows = await query(
    `${baseDocumentSelect}
     WHERE f.id = ? AND f.status = 'active' AND ${visibilityFilter.sql}
     LIMIT 1`,
    [id, ...visibilityFilter.params]
  );
  return rows.map((row) => serializeDocumentSource(row, 100));
};

const fetchContextLibrarySources = async (user, context) => {
  if (!context?.isFollowup || !hasPermission(user, PERMISSIONS.FILE_READ)) return [];
  const documentIds = unique((context.previousSources || [])
    .map((source) => toId(source.documentId))
    .filter(Boolean))
    .slice(0, 4);
  if (!documentIds.length) return [];

  const nestedRows = await Promise.all(documentIds.map((documentId) => fetchReferencedDocument(user, documentId)));
  return nestedRows.flat().map((source) => ({ ...source, score: Math.max(source.score || 0, 80) }));
};

const fetchLibrarySources = async (user, terms, referencedDocumentId, contentPassages = new Map()) => {
  if (!hasPermission(user, PERMISSIONS.FILE_READ)) return [];
  const visibilityFilter = await buildVisibilityFilter(user, 'f', 'uploaded_by');
  const likeFilter = buildLikeFilter(terms, [
    'f.name',
    'f.description',
    'f.tags',
    'f.category',
    'f.issuer',
    'd.name',
    'p.name',
    'kp.name',
  ]);
  const rows = await query(
    `${baseDocumentSelect}
     WHERE f.status = 'active' AND ${visibilityFilter.sql}${likeFilter.sql}
     ORDER BY f.updated_at DESC, f.id DESC
     LIMIT 30`,
    [...visibilityFilter.params, ...likeFilter.params]
  );

  // 正文命中但元数据未命中的资料也要纳入候选
  const rowIds = new Set(rows.map((row) => String(row.id)));
  const passageOnlyIds = Array.from(contentPassages.keys()).filter((id) => !rowIds.has(id));
  const passageRows = passageOnlyIds.length
    ? await query(
      `${baseDocumentSelect}
       WHERE f.status = 'active' AND ${visibilityFilter.sql}
         AND f.id IN (${passageOnlyIds.map(() => '?').join(',')})`,
      [...visibilityFilter.params, ...passageOnlyIds]
    )
    : [];

  const referenced = await fetchReferencedDocument(user, referencedDocumentId);
  const scored = [...rows, ...passageRows].map((row) => {
    const source = serializeDocumentSource(row);
    const contentHit = contentPassages.get(String(row.id));
    return {
      ...source,
      score: scoreSource(source, terms) + (contentHit ? contentHit.score * 3 : 0),
    };
  });

  const byId = new Map();
  [...referenced, ...scored]
    .filter((source) => source.score > 0 || referenced.some((item) => item.id === source.id))
    .forEach((source) => {
      const existing = byId.get(source.id);
      if (!existing || source.score > existing.score) byId.set(source.id, source);
    });

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), 'zh-CN'))
    .slice(0, MAX_LIBRARY_SOURCES)
    .map((source) => ({
      ...source,
      passages: contentPassages.get(String(source.id))?.passages || [],
    }));
};

const fetchContextPrivateSources = async (userId, context) => {
  if (!context?.isFollowup) return [];
  const privateItemIds = unique((context.previousSources || [])
    .map((source) => String(source.privateItemId || '').trim())
    .filter(Boolean))
    .slice(0, 4);
  const readingIds = unique((context.previousSources || [])
    .map((source) => String(source.readingId || '').trim())
    .filter(Boolean))
    .slice(0, 4);

  const [itemRows, readingRows] = await Promise.all([
    privateItemIds.length
      ? query(
        `SELECT * FROM private_knowledge_items
         WHERE user_id = ? AND local_id IN (${privateItemIds.map(() => '?').join(',')})`,
        [userId, ...privateItemIds]
      )
      : Promise.resolve([]),
    readingIds.length
      ? query(
        `SELECT * FROM private_reading_history
         WHERE user_id = ? AND local_id IN (${readingIds.map(() => '?').join(',')})`,
        [userId, ...readingIds]
      )
      : Promise.resolve([]),
  ]);

  return [
    ...itemRows.map((row) => ({ ...serializePrivateItemSource(row), score: 76 })),
    ...readingRows.map((row) => ({ ...serializeReadingSource(row), score: 68 })),
  ];
};

const fetchPrivateSources = async (userId, terms) => {
  const [itemRows, readingRows] = await Promise.all([
    query(
      `SELECT * FROM private_knowledge_items
       WHERE user_id = ?
       ORDER BY pinned DESC, COALESCE(source_updated_at, updated_at) DESC, local_id ASC
       LIMIT 200`,
      [userId]
    ),
    query(
      `SELECT * FROM private_reading_history
       WHERE user_id = ?
       ORDER BY COALESCE(opened_at, updated_at) DESC, local_id ASC
       LIMIT 50`,
      [userId]
    ),
  ]);

  const itemSources = itemRows.map((row) => {
    const source = serializePrivateItemSource(row);
    return { ...source, score: scoreSource(source, terms) };
  });
  const readingSources = readingRows.map((row) => {
    const source = serializeReadingSource(row);
    return { ...source, score: scoreSource(source, terms) * 0.8 };
  });

  return [...itemSources, ...readingSources]
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), 'zh-CN'))
    .slice(0, MAX_PRIVATE_SOURCES);
};

const inferTopic = (question, sources) => {
  const text = [question, ...sources.map(sourceText)].join(' ');
  if (/瓦斯|通风|抽采|超限/.test(text)) return 'gas';
  if (/动火|检维修|火|监护/.test(text)) return 'fire';
  if (/探放水|水害|涌水|钻孔|排水/.test(text)) return 'water';
  if (/断层|构造|综采|支护|过构造/.test(text)) return 'fault';
  return 'general';
};

const topicTemplates = {
  gas: {
    conclusion: '先执行停电撤人与通风复核，再闭环确认恢复条件',
    steps: [
      { title: '先控风险', detail: '停止受影响区域作业，撤出人员并设置警戒。' },
      { title: '核对数据', detail: '复核传感器、人工检测、通风状态和抽采参数。' },
      { title: '闭环恢复', detail: '治理后连续复测合格，并按审批程序恢复作业。' },
    ],
    risks: ['瓦斯、通风和供电条件未复核前，不应直接恢复作业。'],
  },
  fire: {
    conclusion: '先核准审批条件，再把现场隔离、检测和监护落到记录',
    steps: [
      { title: '核准审批', detail: '确认作业申请、风险辨识、施工方案和人员资质。' },
      { title: '确认现场', detail: '完成可燃物清理、气体检测、停送电隔离和消防器材检查。' },
      { title: '留痕验收', detail: '明确监护人、复测频次、完工检查和交接记录。' },
    ],
    risks: ['动火前后气体复测和监护交接必须留痕。'],
  },
  water: {
    conclusion: '先核对探放水设计和施工记录，再处理差异并完成验收签认',
    steps: [
      { title: '核对设计', detail: '确认孔位、方位、倾角、深度和超前距离。' },
      { title: '比对记录', detail: '检查钻探原始记录、异常出水、封孔质量和现场验收项。' },
      { title: '差异闭环', detail: '对偏差补测复核，明确结论、责任人和签字记录。' },
    ],
    risks: ['设计参数与现场记录不一致时，应先复核原因再验收。'],
  },
  fault: {
    conclusion: '先完成资料确认与联合会审，再形成班前执行清单',
    steps: [
      { title: '确认适用资料', detail: '核对地质构造、设计、作业规程、专项措施和灾害预报。' },
      { title: '组织联合会审', detail: '生产、技术、通风、机电、安全等岗位共同确认风险。' },
      { title: '形成执行清单', detail: '明确支护参数、探查要求、责任人、验收标准和交底记录。' },
    ],
    risks: ['现场构造变化、支护参数和瓦斯水害条件需要班前复核。'],
  },
  general: {
    conclusion: '先确认适用资料和当前版本，再拆成现场可执行清单',
    steps: [
      { title: '确认资料范围', detail: '优先核对资料库现行版本、个人收藏和最近阅读记录。' },
      { title: '提取关键要求', detail: '按审批、执行、验收和留痕四类整理动作。' },
      { title: '形成闭环', detail: '明确责任人、时限、复核标准和资料归档方式。' },
    ],
    risks: ['资料命中不足时，应补充关键字或指定引用资料后再决策。'],
  },
};

const HIGH_RISK_DISCLAIMER = '涉及高风险作业场景，所有处置必须以正式审批流程和现行有效文件为准，并落实现场确认与监护。';

const highRiskPatterns = [
  { label: '停送电', pattern: /停送电|停电|送电|断电|闭锁/ },
  { label: '瓦斯超限', pattern: /瓦斯|超限|通风|抽采/ },
  { label: '动火作业', pattern: /动火|明火|焊接|气割/ },
  { label: '探放水', pattern: /探放水|水害|涌水|放水/ },
  { label: '应急处置', pattern: /应急|撤人|事故|险情|救援/ },
];

const detectHighRiskScenarios = (question, sources) => {
  const text = [question, ...sources.map(sourceText)].join(' ');
  return highRiskPatterns
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
};

const intentPatterns = [
  { intent: 'checklist', label: '检查清单', pattern: /检查清单|核查清单|清单/ },
  { intent: 'briefing', label: '班前会提示', pattern: /班前会|班前提示|班前交底|交底/ },
  { intent: 'plan', label: '学习计划', pattern: /学习计划|复习计划|培训计划|必学/ },
];

const detectIntent = (question) => {
  const hit = intentPatterns.find(({ pattern }) => pattern.test(question));
  return hit ? { intent: hit.intent, label: hit.label } : { intent: 'qa', label: '问答' };
};

const MAX_CHECKLIST_GROUPS = 4;
const MAX_CHECKLIST_ITEMS = 8;

// 把命中段落按资料分组整理成可执行清单项
const buildChecklist = (sources) => {
  let remaining = MAX_CHECKLIST_ITEMS;
  return sources
    .filter((source) => Array.isArray(source.passages) && source.passages.length)
    .slice(0, MAX_CHECKLIST_GROUPS)
    .map((source) => {
      const items = source.passages
        .slice(0, Math.max(remaining, 0))
        .map((passage) => passage.text);
      remaining -= items.length;
      return {
        documentTitle: source.title,
        version: source.version || null,
        sourceType: source.sourceType,
        items,
      };
    })
    .filter((group) => group.items.length);
};

const buildAnswer = ({ question, terms, sources, user, context, clauses = [] }) => {
  const topic = inferTopic(question, sources);
  const template = topicTemplates[topic] || topicTemplates.general;
  const { intent, label: intentLabel } = detectIntent(question);
  const checklist = intent === 'qa' ? [] : buildChecklist(sources);
  const highRiskScenarios = detectHighRiskScenarios(question, sources);
  const topNames = sources.slice(0, 3).map((source) => `《${source.title}》`);
  const contextPrefix = context?.isFollowup && context.previousQuestion
    ? `基于上一轮“${context.previousQuestion.slice(0, 42)}${context.previousQuestion.length > 42 ? '…' : ''}”继续判断。`
    : '';
  const summaryCore = sources.length
    ? `已在可访问资料中命中 ${sources.length} 条依据，重点参考 ${topNames.join('、')}，并结合 ${user.department || '当前部门'} / ${user.section || '当前科室'} 的权限范围整理。`
    : '当前没有命中明确资料依据，以下为通用处理框架；建议补充资料名称、作业场景或指定引用资料后再复核。';
  const summary = `${contextPrefix}${summaryCore}`;

  const conclusion = clauses.length
    ? `已直接命中 ${clauses.length} 条相关条款原文，请逐条核对后执行。`
    : intent !== 'qa' && checklist.length
      ? `已从 ${checklist.length} 份资料整理${intentLabel}，执行前请核对资料版本与审批状态。`
      : template.conclusion;

  const steps = template.steps.map((step, index) => {
    const source = sources[index] || sources[0];
    const passage = Array.isArray(source?.passages) && source.passages.length
      ? source.passages[0]
      : null;
    return {
      ...step,
      detail: source
        ? `${step.detail} 参考${source.typeLabel || '资料'}《${source.title}》。`
        : step.detail,
      quote: passage
        ? {
          documentTitle: source.title,
          version: source.version || null,
          chunkIndex: passage.chunkIndex,
          text: passage.text,
        }
        : null,
    };
  });

  return {
    conclusion,
    summary,
    steps,
    risks: template.risks,
    intent,
    intentLabel,
    checklist,
    clauses,
    riskLevel: highRiskScenarios.length ? 'high' : 'normal',
    highRiskScenarios,
    disclaimer: highRiskScenarios.length ? HIGH_RISK_DISCLAIMER : null,
    sources,
    queryTerms: terms,
    confidence: sources.length >= 3 ? 'high' : sources.length ? 'medium' : 'low',
    followupOf: context?.isFollowup ? context.previousQuestion || null : null,
    contextUsed: {
      isFollowup: Boolean(context?.isFollowup),
      previousSourceCount: context?.previousSources?.length || 0,
    },
    generatedAt: new Date().toISOString(),
  };
};

exports.queryAgent = async (req, res) => {
  try {
    const question = normalizeQuestion(req.body?.question);
    if (!question) {
      return res.status(400).json({ message: '请输入要咨询的问题' });
    }

    const context = normalizeAgentContext(req.body?.context);
    const referencedDocumentId = req.body?.referencedDocumentId || context.referencedDocumentId;
    const questionTerms = extractTerms(question);
    const contextTerms = extractContextTerms(context);
    const terms = mergeTerms(questionTerms, contextTerms);
    const clauseNumbers = extractClauseNumbers(question);
    const [contentPassages, clauseMatches] = await Promise.all([
      fetchContentPassages(req.user, terms),
      fetchClauseMatches(req.user, clauseNumbers, terms),
    ]);

    // 条款原文作为最高优先级的段落引用并入正文命中，供步骤引用和清单使用
    clauseMatches.forEach((clause) => {
      const entry = contentPassages.get(clause.fileId) || { score: 0, passages: [] };
      entry.score += 12;
      entry.passages = [
        { chunkIndex: -1, text: `${clause.clauseNo}：${clause.text}` },
        ...entry.passages,
      ].slice(0, MAX_PASSAGES_PER_FILE);
      contentPassages.set(clause.fileId, entry);
    });

    const [librarySources, privateSources, contextLibrarySources, contextPrivateSources] = await Promise.all([
      fetchLibrarySources(req.user, terms, referencedDocumentId, contentPassages),
      fetchPrivateSources(req.user.id, terms),
      fetchContextLibrarySources(req.user, context),
      fetchContextPrivateSources(req.user.id, context),
    ]);

    const sourceMap = new Map();
    [...contextLibrarySources, ...contextPrivateSources, ...librarySources, ...privateSources]
      .sort((a, b) => b.score - a.score)
      .forEach((source) => {
        const key = `${source.sourceType}:${source.documentId || source.privateItemId || source.readingId || source.id}`;
        if (!sourceMap.has(key)) sourceMap.set(key, source);
      });
    const sources = Array.from(sourceMap.values()).slice(0, MAX_TOTAL_SOURCES);
    const passageCount = sources.reduce((count, source) => count + (Array.isArray(source.passages) ? source.passages.length : 0), 0);

    const answer = buildAnswer({
      question,
      terms,
      sources,
      user: req.user,
      context,
      clauses: clauseMatches,
    });

    await recordAuditLog({
      req,
      action: 'agent.query',
      resourceType: 'agent_query',
      resourceName: question.slice(0, 80),
      metadata: {
        question,
        isFollowup: Boolean(context?.isFollowup),
        followupOf: answer.followupOf,
        referencedDocumentId: toId(referencedDocumentId) || null,
        queryTerms: terms,
        intent: answer.intent,
        riskLevel: answer.riskLevel,
        highRiskScenarios: answer.highRiskScenarios,
        confidence: answer.confidence,
        sourceCount: sources.length,
        passageCount,
        sources: sources.map((source) => ({
          sourceType: source.sourceType,
          documentId: source.documentId || null,
          privateItemId: source.privateItemId || null,
          readingId: source.readingId || null,
          title: source.title,
        })),
      },
    });

    res.json({
      answer,
      meta: {
        librarySourceCount: librarySources.length,
        privateSourceCount: privateSources.length,
        contextSourceCount: contextLibrarySources.length + contextPrivateSources.length,
        sourceCount: sources.length,
        passageCount,
        clauseCount: clauseMatches.length,
      },
    });
  } catch (err) {
    console.error('智能体检索失败:', err);
    await recordAuditLog({
      req,
      action: 'agent.query',
      resourceType: 'agent_query',
      status: 'failure',
      metadata: { error: err.message },
    });
    res.status(500).json({ message: '智能体检索失败', error: err.message });
  }
};
