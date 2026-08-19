import React, { useEffect, useState } from 'react';
import { Card, Form, Input, InputNumber, Switch, Button, message, Spin, Tabs, Typography, Alert } from 'antd';
import axios from 'axios';
import PageHeader from '../components/PageHeader';

const { Title } = Typography;

const CONFIG_GROUPS = [
  {
    key: 'llm',
    label: '大模型问答',
    keys: ['llmEnabled', 'llmApiBase', 'llmModel', 'llmTimeoutMs', 'llmMaxTokens'],
  },
  {
    key: 'embedding',
    label: '向量检索',
    keys: ['embeddingEnabled', 'embeddingApiBase', 'embeddingModel', 'embeddingTimeoutMs', 'embeddingBatchSize'],
  },
  {
    key: 'tika',
    label: '文档解析（Tika）',
    keys: ['tikaEnabled', 'tikaAutoStart', 'tikaHost', 'tikaPort', 'tikaJarPath'],
  },
  {
    key: 'agent',
    label: '智能体策略',
    keys: ['agentLlmDailyLimit', 'agentLlmHardTimeoutMs', 'agentAnswerCacheTtlMs', 'agentLlmSkipOnClauseHit'],
  },
];

const KEY_LABELS = {
  llmEnabled: '启用大模型',
  llmApiBase: 'API 基础地址',
  llmModel: '模型名称',
  llmTimeoutMs: '请求超时（毫秒）',
  llmMaxTokens: '最大 Token 数',
  embeddingEnabled: '启用 Embedding',
  embeddingApiBase: 'Embedding API 基础地址',
  embeddingModel: 'Embedding 模型',
  embeddingTimeoutMs: '请求超时（毫秒）',
  embeddingBatchSize: '批量大小',
  tikaEnabled: '启用 Tika 解析',
  tikaAutoStart: '自动启动本地 Tika Server',
  tikaHost: 'Tika Server 主机',
  tikaPort: 'Tika Server 端口',
  tikaJarPath: 'Tika Server JAR 路径',
  agentLlmDailyLimit: '每日 LLM 调用上限（0 不限）',
  agentLlmHardTimeoutMs: 'LLM 硬超时（毫秒）',
  agentAnswerCacheTtlMs: '答案缓存时长（毫秒）',
  agentLlmSkipOnClauseHit: '命中条款时跳过 LLM',
};

const ConfigManagement = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({});

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/config');
      const values = res.data.config || {};
      setConfig(values);
      form.setFieldsValue(values);
    } catch (err) {
      message.error(err.response?.data?.message || '加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await axios.put('/api/config', values);
      message.success('配置已保存，约 30 秒后对所有请求生效');
      setConfig(values);
    } catch (err) {
      if (err.response?.data?.message) {
        message.error(err.response.data.message);
      } else if (err.errorFields) {
        message.error('请检查表单填写');
      }
    } finally {
      setSaving(false);
    }
  };

  const renderField = (key) => {
    const value = config[key];
    const type = typeof value;
    const label = KEY_LABELS[key] || key;

    if (type === 'boolean') {
      return (
        <Form.Item key={key} name={key} label={label} valuePropName="checked">
          <Switch />
        </Form.Item>
      );
    }

    if (type === 'number') {
      return (
        <Form.Item key={key} name={key} label={label}>
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
      );
    }

    return (
      <Form.Item key={key} name={key} label={label}>
        <Input />
      </Form.Item>
    );
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="系统配置" subtitle="管理 LLM、Embedding、Tika 等运行时配置" />
      <Alert
        message="配置生效说明"
        description="API Key（LLM_API_KEY / EMBEDDING_API_KEY）仍通过环境变量配置，不在此处暴露。其余开关和参数修改后约 30 秒自动热生效。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      <Card>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Tabs
            items={CONFIG_GROUPS.map((group) => ({
              key: group.key,
              label: group.label,
              children: group.keys.map(renderField),
            }))}
          />
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存配置
            </Button>
            <Button style={{ marginLeft: 12 }} onClick={fetchConfig} disabled={loading}>
              刷新
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default ConfigManagement;
