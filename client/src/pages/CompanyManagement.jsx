import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;

const tagsToText = (tags = []) => (Array.isArray(tags) ? tags.join(', ') : String(tags || ''));
const textToTags = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);

const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' },
];

const CompanyManagement = () => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/companies');
      setCompanies(res.data.companies || []);
    } catch (err) {
      message.error(err.response?.data?.message || '获取公司列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' });
    setModalOpen(true);
  };

  const openEdit = (company) => {
    setEditing(company);
    form.setFieldsValue({
      name: company.name,
      emailDomains: tagsToText(company.emailDomains),
      status: company.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values) => {
    const payload = {
      name: values.name,
      emailDomains: textToTags(values.emailDomains),
      status: values.status,
    };

    try {
      setSaving(true);
      if (editing) {
        await axios.put(`/api/companies/${editing.id}`, payload);
        message.success('公司已更新');
      } else {
        await axios.post('/api/companies', payload);
        message.success('公司已创建');
      }
      setModalOpen(false);
      fetchCompanies();
    } catch (err) {
      message.error(err.response?.data?.message || '保存公司失败');
    } finally {
      setSaving(false);
    }
  };

  const refreshInviteCode = async (company) => {
    try {
      await axios.post(`/api/companies/${company.id}/invite-code`);
      message.success('邀请码已刷新');
      fetchCompanies();
    } catch (err) {
      message.error(err.response?.data?.message || '刷新邀请码失败');
    }
  };

  const columns = [
    {
      title: '公司',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary">{record.emailDomains?.length ? record.emailDomains.map((domain) => `@${domain}`).join(' / ') : '未绑定邮箱域'}</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status) => <Tag color={status === 'active' ? 'green' : 'default'}>{status === 'active' ? '启用' : '停用'}</Tag>,
    },
    {
      title: '邀请码',
      dataIndex: 'inviteCode',
      key: 'inviteCode',
      width: 180,
      render: (code) => <Text code copyable>{code}</Text>,
    },
    {
      title: '用户',
      dataIndex: 'userCount',
      key: 'userCount',
      width: 90,
    },
    {
      title: '目录',
      dataIndex: 'directoryCount',
      key: 'directoryCount',
      width: 90,
    },
    {
      title: '资料',
      dataIndex: 'documentCount',
      key: 'documentCount',
      width: 90,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (value) => value ? String(value).slice(0, 10) : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm
            title="刷新邀请码"
            description="旧邀请码将失效，确认刷新？"
            onConfirm={() => refreshInviteCode(record)}
          >
            <Button type="link" icon={<SyncOutlined />}>邀请码</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="公司管理"
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchCompanies} loading={loading}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建公司</Button>
          </Space>
        )}
      />
      <Card>
      <Table
        columns={columns}
        dataSource={companies}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editing ? '编辑公司' : '新建公司'}
        open={modalOpen}
        onOk={() => form.submit()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
            <Input placeholder="例如：华北矿业集团" />
          </Form.Item>
          <Form.Item name="emailDomains" label="邮箱域">
            <Input placeholder="example.com, mine.cn" />
          </Form.Item>
          {editing ? (
            <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
              <Select options={statusOptions} />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
      </Card>
    </div>
  );
};

export default CompanyManagement;
