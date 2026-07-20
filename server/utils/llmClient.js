// OpenAI 兼容协议的 LLM 客户端（DeepSeek / Kimi / 通义 / 自建服务均可）。
// 配置全部走环境变量，未配置 LLM_API_KEY 时视为未启用，调用方应回退到模板回答。
const DEFAULT_API_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_TOKENS = 1200;

const getConfig = () => ({
  apiKey: String(process.env.LLM_API_KEY || '').trim(),
  apiBase: String(process.env.LLM_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, ''),
  model: String(process.env.LLM_MODEL || DEFAULT_MODEL).trim(),
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  maxTokens: Number(process.env.LLM_MAX_TOKENS) || DEFAULT_MAX_TOKENS,
});

const isLlmConfigured = () => Boolean(getConfig().apiKey);

const getLlmModel = () => (isLlmConfigured() ? getConfig().model : null);

// 剥离可能的 markdown 代码围栏后解析 JSON，解析失败抛错
const parseJsonContent = (content) => {
  const text = String(content || '').trim();
  if (!text) throw new Error('模型返回内容为空');
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return JSON.parse(unfenced);
};

// 请求 chat completions 并返回解析后的 JSON 对象，失败抛出带信息的 Error
const chatJsonCompletion = async ({ system, user, temperature = 0.2 }) => {
  const config = getConfig();
  if (!config.apiKey) throw new Error('未配置 LLM_API_KEY');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response;
  try {
    response = await fetch(`${config.apiBase}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature,
        max_tokens: config.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`模型请求超时（${config.timeoutMs}ms）`);
    throw new Error(`模型请求失败：${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`模型服务返回 ${response.status}：${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  try {
    return {
      content: parseJsonContent(content),
      usage: data?.usage
        ? {
          promptTokens: Number(data.usage.prompt_tokens) || 0,
          completionTokens: Number(data.usage.completion_tokens) || 0,
          totalTokens: Number(data.usage.total_tokens) || 0,
        }
        : null,
    };
  } catch (err) {
    throw new Error(`模型返回解析失败：${err.message}`);
  }
};

module.exports = {
  isLlmConfigured,
  getLlmModel,
  chatJsonCompletion,
  parseJsonContent,
};
