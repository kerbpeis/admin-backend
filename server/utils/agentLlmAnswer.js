const { isLlmConfigured, chatJsonCompletion } = require('./llmClient');

const MAX_MATERIAL_SOURCES = 6;
const MAX_MATERIAL_PASSAGES = 2;
const CONCLUSION_MAX_CHARS = 60;
const SUMMARY_MAX_CHARS = 160;
const STEP_TITLE_MAX_CHARS = 16;
const STEP_DETAIL_MAX_CHARS = 80;
const RISK_MAX_CHARS = 60;
const MAX_STEPS = 6;
const MAX_RISKS = 3;

const SYSTEM_PROMPT = [
  '你是煤矿企业内部的资料智能助手，依据用户可访问的资料原文回答问题。',
  '要求：',
  '1. 只能依据"资料依据"中的内容作答，资料没有的要求不得编造；资料不足时在 summary 中如实说明。',
  '2. 输出严格 JSON（不要输出任何其他文字），结构：',
  '   { "conclusion": "≤60字结论", "summary": "≤160字判断依据说明", "steps": [{ "title": "≤16字", "detail": "≤80字", "sourceIndex": 1 }], "risks": ["≤60字"] }',
  '3. steps 3-5 步，按现场执行顺序排列；sourceIndex 为该步主要依据的资料编号（从 1 开始）。',
  '4. risks 1-3 条，提示执行前必须现场复核的事项。',
  '5. 使用简体中文，措辞面向一线班组长，直接、可执行。',
].join('\n');

const clip = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

// 把检索结果组装成编号资料清单，供模型引用 sourceIndex
const buildMaterialList = (sources, clauses) => {
  const lines = [];
  sources.slice(0, MAX_MATERIAL_SOURCES).forEach((source, index) => {
    const no = index + 1;
    const version = source.version ? `（${source.version}）` : '';
    lines.push(`【资料${no}】${source.title}${version}`);
    (Array.isArray(source.passages) ? source.passages : [])
      .slice(0, MAX_MATERIAL_PASSAGES)
      .forEach((passage) => lines.push(`  原文：${clip(passage.text, 180)}`));
  });
  clauses.slice(0, 6).forEach((clause) => {
    lines.push(`【条款】${clause.documentTitle} ${clause.clauseNo}：${clip(clause.text, 180)}`);
  });
  return lines.join('\n');
};

const buildUserPrompt = ({ question, intentLabel, sources, clauses, context }) => {
  const parts = [`问题：${question}`];
  if (intentLabel && intentLabel !== '问答') parts.push(`回答形式：${intentLabel}`);
  if (context?.isFollowup && context.previousQuestion) {
    parts.push(`上一轮问题：${context.previousQuestion}`);
    if (context.previousConclusion) parts.push(`上一轮结论：${clip(context.previousConclusion, 120)}`);
  }
  const materials = buildMaterialList(sources, clauses);
  parts.push(materials ? `资料依据：\n${materials}` : '资料依据：无（请基于通用安全框架作答并说明资料不足）');
  return parts.join('\n\n');
};

const sanitizeStep = (step, sources, index) => {
  const title = clip(step?.title, STEP_TITLE_MAX_CHARS);
  const detail = clip(step?.detail, STEP_DETAIL_MAX_CHARS);
  if (!title || !detail) return null;

  // quote 一律取自真实检索段落，不使用模型生成的文字，杜绝编造引用
  const sourceIndex = Number(step?.sourceIndex);
  const source = (Number.isInteger(sourceIndex) && sources[sourceIndex - 1]) || sources[index] || sources[0];
  const passage = Array.isArray(source?.passages) && source.passages.length ? source.passages[0] : null;

  return {
    title,
    detail,
    quote: passage
      ? {
        documentTitle: source.title,
        version: source.version || null,
        chunkIndex: passage.chunkIndex,
        text: passage.text,
      }
      : null,
  };
};

const sanitizeAnswer = (raw, sources) => {
  const conclusion = clip(raw?.conclusion, CONCLUSION_MAX_CHARS);
  const summary = clip(raw?.summary, SUMMARY_MAX_CHARS);
  const steps = (Array.isArray(raw?.steps) ? raw.steps : [])
    .map((step, index) => sanitizeStep(step, sources, index))
    .filter(Boolean)
    .slice(0, MAX_STEPS);
  const risks = (Array.isArray(raw?.risks) ? raw.risks : [])
    .map((risk) => clip(risk, RISK_MAX_CHARS))
    .filter(Boolean)
    .slice(0, MAX_RISKS);

  if (!conclusion || !summary || steps.length < 3) return null;
  return { conclusion, summary, steps, risks };
};

// 调用 LLM 生成回答核心内容；未配置或任何失败均返回 null，由调用方回退模板
const buildLlmAnswer = async ({ question, intentLabel, sources = [], clauses = [], context, user }) => {
  if (!isLlmConfigured()) return null;
  try {
    const raw = await chatJsonCompletion({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ question, intentLabel, sources, clauses, context, user }),
    });
    return sanitizeAnswer(raw, sources);
  } catch (err) {
    console.warn('LLM 回答生成失败，回退模板回答:', err.message);
    return null;
  }
};

module.exports = {
  buildLlmAnswer,
  buildUserPrompt,
  sanitizeAnswer,
};
