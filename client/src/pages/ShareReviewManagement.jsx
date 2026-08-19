import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../components/PageHeader';
import dayjs from 'dayjs';

const { Paragraph, Text } = Typography;

const statusMeta = {
  pending: { label: '待审核', color: 'gold' },
  approved: { label: '已通过', color: 'green' },
  rejected: { label: '已拒绝', color: 'red' },
  cancelled: { label: '已取消', color: 'default' },
};

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
  { label: '已取消', value: 'cancelled' },
];

const ShareReviewManagement = ({ currentUser }) => {
  const isPlatformAdmin = Boolean(currentUser?.isAdmin) && currentUser?.platformRole === 'super_admin';
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(currentUser?.companyId || null);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [nextStatus, setNextStatus] = useState('approved');
  const [form] = Form.useForm();

  const filteredTotal = useMemo(
    () => requests.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {}),
    [requests]
  );
  const requestParams = useMemo(
    () => (isPlatformAdmin && selectedCompanyId ? { companyId: selectedCompanyId } : {}),
    [isPlatformAdmin, selectedCompanyId]
  );

  const fetchCompanies = async () => {
    if (!isPlatformAdmin) return;
    try {
      const res = await axios.get('/api/companies');
      const list = res.data.companies || [];
      setCompanies(list);
      setSelectedCompanyId((current) => current || list[0]?.id || null);
    } catch (err) {
      message.error(err.response?.data?.message || '获取公司列表失败');
    }
  };

  const fetchRequests = async () => {
    if (isPlatformAdmin && !selectedCompanyId) return;
    try {
      setLoading(true);
      const res = await axios.get('/api/private-knowledge/share-requests', {
        params: {
          scope: 'review',
          status: status === 'all' ? undefined : status,
          limit: 100,
          ...requestParams,
        },
      });
      setRequests(res.data.shareRequests || []);
    } catch (err) {
      message.error(err.response?.data?.message || '获取共享申请失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, [isPlatformAdmin]);

  useEffect(() => {
    fetchRequests();
  }, [status, selectedCompanyId]);

  const openReview = (record, action) => {
    setReviewTarget(record);
    setNextStatus(action);
    form.resetFields();
    form.setFieldsValue({
      reviewNote: action === 'approved' ? '审核通过，进入资料库' : '',
    });
    setReviewOpen(true);
  };

  const submitReview = async (values) => {
    try {
      setSaving(true);
      await axios.patch(`/api/private-knowledge/share-requests/${reviewTarget.id}`, {
        status: nextStatus,
        reviewNote: values.reviewNote,
        ...requestParams,
      });
      message.success('共享申请已更新');
      setReviewOpen(false);
      fetchRequests();
    } catch (err) {
      message.error(err.response?.data?.message || '更新共享申请失败');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '申请资料',
      dataIndex: 'title',
      key: 'title',
      render: (title, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{title}</Text>
          <Text type="secondary">{record.sourceTitle || record.itemType || '个人知识'}</Text>
        </Space>
      ),
    },
    {
      title: '申请人',
      dataIndex: 'requester',
      key: 'requester',
      width: 180,
      render: (requester) => requester ? (
        <Space direction="vertical" size={0}>
          <Text>{requester.name || requester.email}</Text>
          <Text type="secondary">{requester.department}/{requester.section}</Text>
        </Space>
      ) : '-',
    },
    {
      title: '目标位置',
      key: 'target',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.targetProfession || '未指定专业'} / {record.targetSection || '未指定科室'}</Text>
          <Text type="secondary">{record.targetCategory || '个人共享'}</Text>
        </Space>
      ),
    },
    {
      title: '理由',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
      render: (reason) => reason || <Text type="secondary">未填写</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value) => {
        const meta = statusMeta[value] || { label: value, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '入库',
      dataIndex: 'promotedDocumentId',
      key: 'promotedDocumentId',
      width: 100,
      render: (id) => id ? <Tag color="green">#{id}</Tag> : '-',
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (value) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<CheckCircleOutlined />}
            disabled={record.status === 'approved'}
            onClick={() => openReview(record, 'approved')}
          >
            通过
          </Button>
          <Button
            type="link"
            danger
            icon={<CloseCircleOutlined />}
            disabled={record.status === 'approved' || record.status === 'cancelled'}
            onClick={() => openReview(record, 'rejected')}
          >
            拒绝
          </Button>
          {record.status === 'rejected' ? (
            <Button type="link" icon={<RollbackOutlined />} onClick={() => openReview(record, 'pending')}>
              退回待审
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="共享审核"
        extra={(
          <Space>
            <Select
              value={status}
              options={statusOptions}
              onChange={setStatus}
              style={{ width: 120 }}
            />
            {isPlatformAdmin ? (
              <Select
                style={{ width: 220 }}
                value={selectedCompanyId}
                options={companies.map((company) => ({ label: company.name, value: company.id }))}
                onChange={setSelectedCompanyId}
                placeholder="选择公司"
                showSearch
                optionFilterProp="label"
              />
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={fetchRequests} loading={loading}>刷新</Button>
          </Space>
        )}
      />
      <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        {Object.entries(statusMeta).map(([key, meta]) => (
          <Tag key={key} color={meta.color}>{meta.label} {filteredTotal[key] || 0}</Tag>
        ))}
      </Space>
      <Table
        columns={columns}
        dataSource={requests}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
        expandable={{
          expandedRowRender: (record) => (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Paragraph>
                <Text strong>共享理由：</Text>{record.reason || '未填写'}
              </Paragraph>
              <Paragraph>
                <Text strong>审核意见：</Text>{record.reviewNote || '未填写'}
              </Paragraph>
            </Space>
          ),
        }}
      />

      <Modal
        title={statusMeta[nextStatus]?.label || '更新审核状态'}
        open={reviewOpen}
        onOk={() => form.submit()}
        onCancel={() => setReviewOpen(false)}
        confirmLoading={saving}
        okText="确认"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={submitReview}>
          <Form.Item label="申请资料">
            <Input value={reviewTarget?.title} disabled />
          </Form.Item>
          <Form.Item name="reviewNote" label="审核意见">
            <Input.TextArea rows={4} placeholder="填写通过或拒绝的原因" />
          </Form.Item>
        </Form>
      </Modal>
      </Card>
    </div>
  );
};

export default ShareReviewManagement;
