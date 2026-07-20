require('dotenv').config();

// 智能体 LLM 路径验证：服务端配置 LLM_API_KEY 时断言走大模型生成，
// 未配置时打印 skip 并以 0 退出（模板路径由 verify-agent-query.js 覆盖）。
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

const main = async () => {
  if (!String(process.env.LLM_API_KEY || '').trim()) {
    console.log(JSON.stringify({ ok: true, skipped: 'LLM_API_KEY 未配置，LLM 路径验证跳过' }, null, 2));
    return;
  }

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });

  const result = await request('/api/agent/query', {
    method: 'POST',
    token: login.token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '综采工作面过断层前，需要提前准备哪些资料和安全措施？' }),
  });

  assert(result.meta?.generator === 'llm', `期望 LLM 生成，实际 generator=${result.meta?.generator}`);
  assert(result.meta?.model, '缺少模型名称');
  assert(result.answer?.generator === 'llm', '回答未标记 LLM 生成');
  assert(result.answer?.conclusion && result.answer.conclusion.length <= 60, '结论缺失或超长');
  assert(result.answer?.summary, '缺少摘要');
  assert(Array.isArray(result.answer?.steps) && result.answer.steps.length >= 3, '执行步骤不足 3 步');
  const quotedSteps = result.answer.steps.filter((step) => step.quote?.text);
  assert(quotedSteps.length > 0, 'LLM 路径执行步骤未挂接真实原文引用');
  assert(quotedSteps[0].quote.documentTitle, '步骤引用缺少资料标题');
  assert(Array.isArray(result.answer?.risks) && result.answer.risks.length > 0, '缺少风险提示');

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'llm generator flagged',
      'llm answer structure',
      'llm steps with authentic quotes',
      'llm risks present',
    ],
    model: result.meta.model,
    conclusion: result.answer.conclusion,
    stepCount: result.answer.steps.length,
  }, null, 2));
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
