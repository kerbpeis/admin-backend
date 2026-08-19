import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ApartmentOutlined,
  BankOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../components/PageHeader';
import { PERMISSIONS, hasPermission } from '../utils/permissions';

const { Text } = Typography;

const typeLabels = {
  profession: '专业目录',
  section: '科室目录',
};

const typeColors = {
  profession: 'blue',
  section: 'green',
};

const DirectoryManagement = ({ currentUser }) => {
  const isPlatformAdmin = Boolean(currentUser?.isAdmin) && currentUser?.platformRole === 'super_admin';
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(currentUser?.companyId || null);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [departmentType, setDepartmentType] = useState('section');
  const [form] = Form.useForm();

  const canCreate = hasPermission(currentUser, PERMISSIONS.DEPARTMENT_CREATE);
  const canUpdate = hasPermission(currentUser, PERMISSIONS.DEPARTMENT_UPDATE);
  const canDelete = hasPermission(currentUser, PERMISSIONS.DEPARTMENT_DELETE);

  // 全部公司模式：只读总览，新建/编辑/删除需先切换到具体公司
  const isAllCompanies = isPlatformAdmin && selectedCompanyId === 'all';

  const professionOptions = useMemo(
    () => departments
      .filter((item) => item.type === 'profession')
      .map((item) => ({ label: item.name, value: item.id })),
    [departments]
  );

  const userOptions = useMemo(
    () => users.map((user) => ({
      label: `${user.name} · ${user.department}/${user.section}`,
      value: user.id,
    })),
    [users]
  );

  // 专业 → 科室 树形结构：专业为父行，其下挂载所属科室，按排序值排列；
  // 全部公司模式下再包一层公司节点，形成 公司 → 专业 → 科室 三级树
  const treeData = useMemo(() => {
    const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
    const professions = departments
      .filter((item) => item.type === 'profession')
      .sort(byOrder);
    const sections = departments
      .filter((item) => item.type === 'section')
      .sort(byOrder);
    const professionIds = new Set(professions.map((item) => String(item.id)));

    const professionTrees = professions.map((profession) => {
      const children = sections.filter(
        (section) => String(section.parentDepartment?.id) === String(profession.id)
      );
      return children.length ? { ...profession, children } : profession;
    });
    // 上级专业已删除或不在范围内的科室，平铺到末尾避免丢失
    const orphans = sections.filter(
      (section) => !professionIds.has(String(section.parentDepartment?.id))
    );
    const nodes = [...professionTrees, ...orphans];

    if (!isAllCompanies) {
      return nodes;
    }

    const byCompany = new Map();
    nodes.forEach((item) => {
      const key = String(item.companyId || 'unknown');
      if (!byCompany.has(key)) {
        byCompany.set(key, {
          id: `company-${key}`,
          type: 'company',
          name: item.companyName || '未分配公司',
          children: [],
        });
      }
      byCompany.get(key).children.push(item);
    });
    return [...byCompany.values()];
  }, [departments, isAllCompanies]);

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
      setSelectedCompanyId((current) => current || 'all');
    } catch (err) {
      message.error(err.response?.data?.message || '获取公司列表失败');
    }
  };

  const fetchDepartments = async () => {
    if (isPlatformAdmin && !selectedCompanyId) return;
    try {
      setLoading(true);
      const res = await axios.get('/api/departments', { params: requestParams });
      setDepartments(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      message.error(err.response?.data?.message || '获取公司目录失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    if (isPlatformAdmin && !selectedCompanyId) return;
    try {
      const res = await axios.get('/api/users', { params: { limit: 200, ...requestParams } });
      setUsers(res.data.users || []);
    } catch (err) {
      message.error(err.response?.data?.message || '获取用户列表失败');
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, [isPlatformAdmin]);

  useEffect(() => {
    fetchDepartments();
    fetchUsers();
  }, [selectedCompanyId]);

  const openCreate = () => {
    setEditing(null);
    setDepartmentType('section');
    form.resetFields();
    form.setFieldsValue({ type: 'section', isActive: true });
    setModalOpen(true);
  };

  const openEdit = (department) => {
    setEditing(department);
    setDepartmentType(department.type);
    form.setFieldsValue({
      name: department.name,
      description: department.description,
      type: department.type,
      parentDepartment: department.parentDepartment?.id,
      order: department.order,
      isActive: department.isActive,
      managers: (department.managers || []).map((manager) => manager.id),
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values) => {
    try {
      setSaving(true);
      if (editing) {
        await axios.put(`/api/departments/${editing.id}`, {
          name: values.name,
          description: values.description,
          order: values.order,
          isActive: values.isActive,
          managers: values.managers || [],
          ...requestParams,
        });
        message.success('目录已更新');
      } else {
        await axios.post('/api/departments', {
          name: values.name,
          description: values.description,
          type: values.type,
          parentDepartment: values.type === 'profession' ? null : values.parentDepartment,
          managers: values.managers || [],
          ...requestParams,
        });
        message.success('目录已创建');
      }
      setModalOpen(false);
      fetchDepartments();
    } catch (err) {
      message.error(err.response?.data?.message || '保存目录失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (department) => {
    try {
      await axios.delete(`/api/departments/${department.id}`, { params: requestParams });
      message.success('目录已删除');
      fetchDepartments();
    } catch (err) {
      message.error(err.response?.data?.message || '删除目录失败');
    }
  };

  const columns = [
    {
      title: '目录名称',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space direction="vertical" size={0}>
          <Space size={8}>
            {record.type === 'company'
              ? <BankOutlined style={{ color: '#0F2E28' }} />
              : record.type === 'profession'
                ? <ApartmentOutlined style={{ color: '#0F6B5C' }} />
                : <TeamOutlined style={{ color: '#98A2B3' }} />}
            <Text strong={record.type !== 'section'}>{name}</Text>
            {record.type !== 'company' ? (
              <Tag color={typeColors[record.type]} style={{ marginInlineEnd: 0 }}>
                {typeLabels[record.type] || record.type}
              </Tag>
            ) : null}
          </Space>
          {record.type === 'company' ? (
            <Text type="secondary" style={{ paddingLeft: 24 }}>
              {(record.children || []).length} 个专业/科室目录
            </Text>
          ) : (
            <Text type="secondary" style={{ paddingLeft: 24 }}>{record.description || '未填写描述'}</Text>
          )}
        </Space>
      ),
    },
    {
      title: '资料内容',
      key: 'content',
      width: 160,
      render: (_, record) => record.type === 'company'
        ? <Text type="secondary">-</Text>
        : `${record.knowledgePointCount || 0} 知识点 / ${record.fileCount || 0} 资料`,
    },
    {
      title: '负责人',
      dataIndex: 'managers',
      key: 'managers',
      render: (managers = [], record) => {
        if (record.type === 'company') return <Text type="secondary">-</Text>;
        return managers.length
          ? managers.map((manager) => <Tag key={manager.id}>{manager.name}</Tag>)
          : <Text type="secondary">未配置</Text>;
      },
    },
    {
      title: '排序',
      dataIndex: 'order',
      key: 'order',
      width: 80,
      render: (value, record) => (record.type === 'company' ? null : value),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 90,
      render: (value, record) => (record.type === 'company'
        ? null
        : <Tag color={value ? 'green' : 'default'}>{value ? '启用' : '停用'}</Tag>),
    },
    !isAllCompanies && (canUpdate || canDelete) && {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, record) => (
        <Space>
          {canUpdate ? (
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
          ) : null}
          {canDelete ? (
            <Popconfirm
              title="删除目录"
              description="删除后将无法恢复；存在子级或成员时无法删除，确认删除该目录？"
              onConfirm={() => handleDelete(record)}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        title="公司目录管理"
        extra={(
          <Space>
            {isPlatformAdmin ? (
              <Select
                style={{ width: 240 }}
                value={selectedCompanyId}
                options={[
                  { label: '全部公司（只读总览）', value: 'all' },
                  ...companies.map((company) => ({ label: company.name, value: company.id })),
                ]}
                onChange={setSelectedCompanyId}
                placeholder="选择公司"
                showSearch
                optionFilterProp="label"
              />
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={fetchDepartments} loading={loading}>刷新</Button>
            {canCreate && !isAllCompanies ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建目录</Button> : null}
          </Space>
        )}
      />
      <Card>
      <Table
        columns={columns}
        dataSource={treeData}
        rowKey="id"
        loading={loading}
        pagination={false}
        defaultExpandAllRows
        rowClassName={(record) => {
          if (record.type === 'company') return 'directory-row-company';
          return record.type === 'profession' ? 'directory-row-profession' : 'directory-row-section';
        }}
      />

      <Modal
        title={editing ? '编辑目录' : '新建目录'}
        open={modalOpen}
        onOk={() => form.submit()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          onValuesChange={(_, values) => setDepartmentType(values.type || departmentType)}
        >
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select disabled={Boolean(editing)}>
              <Select.Option value="profession">专业目录</Select.Option>
              <Select.Option value="section">科室目录</Select.Option>
            </Select>
          </Form.Item>
          {departmentType !== 'profession' ? (
            <Form.Item name="parentDepartment" label="上级专业" rules={[{ required: true, message: '请选择上级专业' }]}>
              <Select options={professionOptions} showSearch optionFilterProp="label" />
            </Form.Item>
          ) : null}
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：采煤管理室" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="用于 App 目录说明" />
          </Form.Item>
          {editing ? (
            <>
              <Form.Item name="order" label="排序">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="isActive" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          ) : null}
          <Form.Item name="managers" label="负责人">
            <Select mode="multiple" options={userOptions} showSearch optionFilterProp="label" />
          </Form.Item>
        </Form>
      </Modal>
      </Card>
    </div>
  );
};

export default DirectoryManagement;
