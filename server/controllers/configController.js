const { getAll, setMany, DEFAULTS } = require('../utils/runtimeConfig');
const { sendServerError } = require('../utils/serverError');
const { PERMISSIONS, hasPermission } = require('../utils/authorization');

const editableKeys = Object.keys(DEFAULTS);

const getConfig = async (req, res) => {
  try {
    const config = await getAll();
    res.json({ config });
  } catch (err) {
    sendServerError(res, err, '获取运行时配置失败');
  }
};

const updateConfig = async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSIONS.PERMISSION_UPDATE)) {
      return res.status(403).json({ message: '没有权限修改系统配置' });
    }

    const updates = {};
    for (const key of editableKeys) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: '没有提供有效的配置项' });
    }

    const result = await setMany(updates, { updatedBy: req.user?.id });
    res.json({ message: '配置已更新', config: result });
  } catch (err) {
    sendServerError(res, err, '更新运行时配置失败');
  }
};

const getConfigMeta = async (req, res) => {
  try {
    const meta = Object.entries(DEFAULTS).map(([key, defaultValue]) => ({
      key,
      type: typeof defaultValue,
      defaultValue,
      description: getDescription(key),
    }));
    res.json({ meta });
  } catch (err) {
    sendServerError(res, err, '获取配置元信息失败');
  }
};

const getDescription = (key) => {
  const descriptions = {
    llmEnabled: '是否启用大模型问答',
    llmApiBase: 'LLM API 基础地址',
    llmModel: 'LLM 模型名称',
    llmTimeoutMs: 'LLM 请求超时时间（毫秒）',
    llmMaxTokens: 'LLM 最大生成 token 数',
    embeddingEnabled: '是否启用 Embedding 向量检索',
    embeddingApiBase: 'Embedding API 基础地址',
    embeddingModel: 'Embedding 模型名称',
    embeddingTimeoutMs: 'Embedding 请求超时时间（毫秒）',
    embeddingBatchSize: 'Embedding 批量大小',
    tikaEnabled: '是否启用 Apache Tika 文档解析',
    tikaAutoStart: '是否自动启动本地 Tika Server',
    tikaHost: 'Tika Server 主机地址',
    tikaPort: 'Tika Server 端口',
    tikaJarPath: 'Tika Server JAR 文件路径',
    agentLlmDailyLimit: '每个用户每日 LLM 调用上限（0 为不限）',
    agentLlmHardTimeoutMs: '智能体 LLM 回答硬超时时间（毫秒）',
    agentAnswerCacheTtlMs: 'AI 答案缓存时长（毫秒）',
    agentLlmSkipOnClauseHit: '命中条款原文时是否跳过 LLM 调用',
  };
  return descriptions[key] || '';
};

module.exports = {
  getConfig,
  updateConfig,
  getConfigMeta,
};
