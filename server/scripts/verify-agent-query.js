require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const account = {
  email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
};

const request = async (endpoint, { token, expectedStatus = 200, ...options } = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`${options.method || 'GET'} ${endpoint} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const login = async () => {
  const data = await request('/api/auth/login', {
    method: 'POST',
    expectedStatus: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  return data.token;
};

const main = async () => {
  await request('/api/agent/query', {
    method: 'POST',
    expectedStatus: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '未登录访问' }),
  });

  const token = await login();
  const result = await request('/api/agent/query', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: '综采工作面过断层前，需要提前准备哪些资料和安全措施？',
    }),
  });

  assert(result.answer?.conclusion, '智能体回答缺少结论');
  assert(Array.isArray(result.answer?.steps) && result.answer.steps.length >= 3, '智能体回答缺少执行步骤');
  assert(Array.isArray(result.answer?.sources), '智能体回答缺少引用依据数组');
  assert(result.meta?.sourceCount === result.answer.sources.length, '引用依据数量元数据不一致');

  const passageSources = result.answer.sources.filter((source) => Array.isArray(source.passages) && source.passages.length);
  assert(passageSources.length > 0, '智能体回答缺少资料正文段落引用');
  const firstPassage = passageSources[0].passages[0];
  assert(typeof firstPassage.text === 'string' && firstPassage.text.length >= 10, '正文段落引用内容过短或缺失');
  assert(Number.isInteger(firstPassage.chunkIndex), '正文段落引用缺少分块序号');
  assert((result.meta?.passageCount || 0) >= passageSources[0].passages.length, '元数据段落引用计数不一致');
  const quotedSteps = result.answer.steps.filter((step) => step.quote?.text);
  assert(quotedSteps.length > 0, '执行步骤未引用资料原文');
  assert(quotedSteps[0].quote.documentTitle, '步骤原文引用缺少资料标题');

  const followup = await request('/api/agent/query', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: '恢复作业前还要确认什么？',
      context: {
        isFollowup: true,
        previousQuestion: '综采工作面过断层前，需要提前准备哪些资料和安全措施？',
        previousConclusion: result.answer.conclusion,
        previousSummary: result.answer.summary,
        previousSources: result.answer.sources,
        queryTerms: result.answer.queryTerms,
      },
    }),
  });
  assert(followup.answer?.contextUsed?.isFollowup === true, '追问未标记使用上下文');
  assert(followup.answer?.followupOf, '追问缺少上一轮问题引用');
  assert(followup.answer?.summary?.includes('基于上一轮'), '追问摘要未体现上下文');
  assert((followup.meta?.contextSourceCount || 0) > 0, '追问未复用上一轮依据');

  const emptyQuestion = await request('/api/agent/query', {
    method: 'POST',
    token,
    expectedStatus: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '   ' }),
  });
  assert(emptyQuestion.message, '空问题未返回错误信息');

  const auditResult = await request('/api/audit-logs?action=agent.query&limit=5', { token });
  const queryLogs = (auditResult.logs || []).filter((log) => log.status === 'success');
  assert(queryLogs.length >= 2, '问答日志未写入审计记录');
  const latestLog = queryLogs[0];
  assert(latestLog.metadata?.question, '问答日志缺少问题内容');
  assert(Number.isInteger(latestLog.metadata?.sourceCount), '问答日志缺少引用统计');
  assert(Array.isArray(latestLog.metadata?.sources), '问答日志缺少引用资料明细');
  assert(latestLog.actor?.email === account.email, '问答日志操作人不一致');

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'agent query auth enforcement',
      'agent query structured answer',
      'agent query source metadata',
      'agent query content passages',
      'agent query followup context',
      'agent query empty question validation',
      'agent query audit trail',
    ],
    sourceCount: result.answer.sources.length,
    passageCount: result.meta.passageCount,
    followupSourceCount: followup.answer.sources.length,
    confidence: result.answer.confidence,
  }, null, 2));
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
