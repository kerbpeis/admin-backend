import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DownloadOutlined,
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../components/PageHeader';
import tagColor from '../utils/tagColor';
import dayjs from 'dayjs';

const { Text } = Typography;

const actionLabels = {
  'library_document.create': '创建资料',
  'library_document.view': '查看详情',
  'library_document.update': '编辑资料',
  'library_document.delete': '删除资料',
  'library_document.version_list': '查看版本',
  'library_document.version_upload': '发布版本',
  'library_document.download_link': '生成下载',
  'library_document.download_content': '下载资料',
};

const formatTime = (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-');

const calcPercent = (value, max) => {
  if (!max) return 0;
  return Math.round((Number(value || 0) / max) * 100);
};

const DistributionList = ({ title, data = [], metric = 'total' }) => {
  const max = Math.max(...data.map((item) => Number(item[metric] || 0)), 0);

  return (
    <Card title={title} size="small">
      {data.length ? (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {data.slice(0, 8).map((item) => (
            <div key={item.key}>
              <div className="metric-row">
                <Text strong>{item.label}</Text>
                <Text type="secondary">{item.total} 份</Text>
              </div>
              <Progress
                percent={calcPercent(item[metric], max)}
                showInfo={false}
                size="small"
              />
            </div>
          ))}
        </Space>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      )}
    </Card>
  );
};

// 待办卡片：有需要处理的事项时高亮，无事时沉下去
const TodoCard = ({ title, value, tone }) => {
  const active = Number(value) > 0;
  const colors = {
    danger: active ? '#B42318' : '#98A2B3',
    warning: active ? '#B54708' : '#98A2B3',
  };
  return (
    <Card size="small">
      <Statistic
        title={title}
        value={value || 0}
        valueStyle={{ color: colors[tone], fontSize: 30, fontWeight: 600 }}
      />
      <Text type="secondary">{active ? '需要尽快处理' : '暂无待办'}</Text>
    </Card>
  );
};

const LibraryDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/library-documents/stats/overview', {
        params: { recentLimit: 6, activityLimit: 8 },
      });
      setStats(res.data);
    } catch (err) {
      message.error(err.response?.data?.message || '获取资料库统计失败');
      console.error('Fetch library stats error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const summary = stats?.summary || {};
  const capabilities = stats?.capabilities || {};
  const categoryData = stats?.distributions?.byCategory || [];
  const professionData = stats?.distributions?.byProfession || [];
  const sectionData = stats?.distributions?.bySection || [];

  const recentDocumentColumns = useMemo(() => [
    {
      title: '资料名称',
      dataIndex: 'title',
      key: 'title',
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          <Text type="secondary">{record.profession} / {record.section}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'category',
      key: 'category',
      render: (category) => <Tag color={tagColor(category)}>{category}</Tag>,
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 110,
    },
    {
      title: '访问',
      key: 'traffic',
      width: 150,
      render: (_, record) => (
        <Space>
          <EyeOutlined />{record.viewCount || 0}
          <DownloadOutlined />{record.downloadCount || 0}
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      render: formatTime,
    },
    {
      title: '权限',
      dataIndex: 'access',
      key: 'access',
      width: 100,
      render: (_, record) => record.canManage ? <Tag color="green">可管理</Tag> : <Tag>可阅览</Tag>,
    },
  ], []);

  const activityColumns = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: formatTime,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (action) => actionLabels[action] || action,
    },
    {
      title: '资料',
      dataIndex: 'resourceName',
      key: 'resourceName',
      ellipsis: true,
    },
    {
      title: '操作人',
      dataIndex: 'actor',
      key: 'actor',
      width: 170,
      render: (actor) => actor?.name || actor?.email || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status) => status === 'success' ? <Tag color="green">成功</Tag> : <Tag color="red">{status}</Tag>,
    },
  ], []);

  return (
    <div>
      <PageHeader
        title="资料库概览"
        subtitle={`当前账号${capabilities.canCreate ? '可上传资料' : '仅可查看资料'}，${capabilities.canDelete ? '可删除权限内资料' : '不可删除资料'}`}
        extra={<Button icon={<ReloadOutlined />} onClick={fetchStats} loading={loading}>刷新</Button>}
      />

      {/* 待办优先：需要管理员处理的事项放在最上面 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <TodoCard title="复审逾期" value={summary.reviewOverdue} tone="danger" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <TodoCard title="30 天内需复审" value={summary.reviewDueSoon} tone="warning" />
        </Col>
      </Row>

      {/* 总量指标 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="资料总数" value={summary.totalDocuments || 0} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="可管理资料" value={summary.manageableDocuments || 0} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="版本总数" value={summary.totalVersions || 0} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="下载 / 浏览" value={`${summary.totalDownloads || 0} / ${summary.totalViews || 0}`} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="近 30 天新增" value={summary.createdLast30Days || 0} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="近 30 天更新" value={summary.updatedLast30Days || 0} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}><DistributionList title="按资料类型" data={categoryData} /></Col>
        <Col xs={24} lg={8}><DistributionList title="按专业" data={professionData} /></Col>
        <Col xs={24} lg={8}><DistributionList title="按科室" data={sectionData} /></Col>
      </Row>

      <Card title="最近更新资料" size="small" style={{ marginTop: 16 }}>
        <Table
          columns={recentDocumentColumns}
          dataSource={stats?.recentDocuments || []}
          rowKey="_id"
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>

      <Card title="最近资料库操作" size="small" style={{ marginTop: 16 }}>
        <Table
          columns={activityColumns}
          dataSource={stats?.recentActivities || []}
          rowKey="_id"
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>
    </div>
  );
};

export default LibraryDashboard;
