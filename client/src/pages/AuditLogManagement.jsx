import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { AuditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;
const { Text } = Typography;

const actionOptions = [
  { value: 'library_document.create', label: '创建资料' },
  { value: 'library_document.view', label: '查看详情' },
  { value: 'library_document.update', label: '编辑资料' },
  { value: 'library_document.delete', label: '删除资料' },
  { value: 'library_document.version_list', label: '查看版本' },
  { value: 'library_document.version_upload', label: '发布版本' },
  { value: 'library_document.download_link', label: '生成下载' },
  { value: 'library_document.download_content', label: '下载文件' },
];

const statusOptions = [
  { value: 'success', label: '成功' },
  { value: 'denied', label: '拒绝' },
  { value: 'failure', label: '失败' },
];

const actionLabelMap = Object.fromEntries(actionOptions.map((item) => [item.value, item.label]));
const statusColorMap = {
  success: 'green',
  denied: 'orange',
  failure: 'red',
};

const formatTime = (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');

const AuditLogManagement = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [selectedLog, setSelectedLog] = useState(null);
  const [filterForm] = Form.useForm();

  const buildParams = (page = pagination.current, pageSize = pagination.pageSize) => {
    const values = filterForm.getFieldsValue();
    const params = {
      page,
      limit: pageSize,
      resourceType: values.resourceType || undefined,
      resourceId: values.resourceId || undefined,
      action: values.action || undefined,
      status: values.status || undefined,
      actorId: values.actorId || undefined,
    };

    if (values.dateRange?.length === 2) {
      params.dateFrom = values.dateRange[0].startOf('day').toISOString();
      params.dateTo = values.dateRange[1].endOf('day').toISOString();
    }

    Object.keys(params).forEach((key) => {
      if (params[key] === undefined || params[key] === '') delete params[key];
    });

    return params;
  };

  const fetchLogs = async (page = pagination.current, pageSize = pagination.pageSize) => {
    try {
      setLoading(true);
      const res = await axios.get('/api/audit-logs', { params: buildParams(page, pageSize) });
      setLogs(res.data.logs || []);
      setPagination({
        current: res.data.pagination?.current || page,
        pageSize,
        total: res.data.pagination?.total || 0,
      });
    } catch (err) {
      message.error(err.response?.data?.message || '获取审计日志失败');
      console.error('Fetch audit logs error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1, pagination.pageSize);
  }, []);

  const columns = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (action) => actionLabelMap[action] || action,
    },
    {
      title: '资源',
      key: 'resource',
      ellipsis: true,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.resourceName || '-'}</Text>
          <Text type="secondary">{record.resourceType} #{record.resourceId || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '操作人',
      dataIndex: 'actor',
      key: 'actor',
      width: 190,
      render: (actor) => actor ? (
        <Space direction="vertical" size={0}>
          <Text>{actor.name}</Text>
          <Text type="secondary">{actor.email}</Text>
        </Space>
      ) : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => <Tag color={statusColorMap[status] || 'default'}>{status}</Tag>,
    },
    {
      title: 'IP',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 150,
      render: (ip) => ip || '-',
    },
    {
      title: '操作',
      key: 'actionButton',
      width: 90,
      render: (_, record) => (
        <Button type="link" onClick={() => setSelectedLog(record)}>详情</Button>
      ),
    },
  ], []);

  const handleSearch = () => fetchLogs(1, pagination.pageSize);

  const handleReset = () => {
    filterForm.resetFields();
    fetchLogs(1, pagination.pageSize);
  };

  return (
    <Card
      title={<Space><AuditOutlined />审计日志</Space>}
      extra={<Button icon={<ReloadOutlined />} onClick={() => fetchLogs()} loading={loading}>刷新</Button>}
    >
      <Form form={filterForm} layout="inline" className="filter-form">
        <Form.Item name="resourceType" label="资源类型" initialValue="library_document">
          <Select style={{ width: 170 }} allowClear options={[{ value: 'library_document', label: '资料库资料' }]} />
        </Form.Item>
        <Form.Item name="resourceId" label="资源 ID">
          <Input style={{ width: 130 }} placeholder="资料 ID" />
        </Form.Item>
        <Form.Item name="action" label="操作">
          <Select style={{ width: 160 }} allowClear options={actionOptions} placeholder="全部操作" />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select style={{ width: 120 }} allowClear options={statusOptions} placeholder="全部" />
        </Form.Item>
        <Form.Item name="actorId" label="用户 ID">
          <Input style={{ width: 120 }} placeholder="用户 ID" />
        </Form.Item>
        <Form.Item name="dateRange" label="时间">
          <RangePicker />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>查询</Button>
            <Button onClick={handleReset}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        style={{ marginTop: 16 }}
        columns={columns}
        dataSource={logs}
        rowKey="_id"
        loading={loading}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        onChange={(nextPagination) => fetchLogs(nextPagination.current, nextPagination.pageSize)}
      />

      <Drawer
        title="审计日志详情"
        open={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        width={560}
      >
        {selectedLog ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="时间">{formatTime(selectedLog.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="操作">{actionLabelMap[selectedLog.action] || selectedLog.action}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={statusColorMap[selectedLog.status] || 'default'}>{selectedLog.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="资源">{selectedLog.resourceName || '-'} ({selectedLog.resourceType} #{selectedLog.resourceId || '-'})</Descriptions.Item>
              <Descriptions.Item label="操作人">{selectedLog.actor?.name || '-'} {selectedLog.actor?.email ? ` / ${selectedLog.actor.email}` : ''}</Descriptions.Item>
              <Descriptions.Item label="IP">{selectedLog.ipAddress || '-'}</Descriptions.Item>
              <Descriptions.Item label="User Agent">{selectedLog.userAgent || '-'}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title="元数据">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(selectedLog.metadata || {}, null, 2)}
              </pre>
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Card>
  );
};

export default AuditLogManagement;
