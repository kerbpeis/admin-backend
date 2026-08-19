import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Popconfirm, message, Space, Card, Tabs, Upload, Divider } from 'antd';
import { LockOutlined, PlusOutlined, EditOutlined, DeleteOutlined, FileTextOutlined, FolderOutlined, UploadOutlined } from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../components/PageHeader';
import { PERMISSIONS, hasPermission } from '../utils/permissions';

const { Option } = Select;

const permissionTypeOptions = [
  { value: 'system', label: '系统' },
  { value: 'department', label: '部门' },
  { value: 'file', label: '资料' },
  { value: 'folder', label: '目录' },
];

const getPermissionIcon = (type) => {
  if (type === 'file') return <FileTextOutlined />;
  if (type === 'folder') return <FolderOutlined />;
  return <LockOutlined />;
};

const PermissionManagement = ({ currentUser }) => {
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const canCreatePermission = hasPermission(currentUser, PERMISSIONS.PERMISSION_CREATE);
  const canBatchCreatePermissions = hasPermission(currentUser, PERMISSIONS.PERMISSION_BATCH_CREATE);
  const canUpdatePermission = hasPermission(currentUser, PERMISSIONS.PERMISSION_UPDATE);
  const canDeletePermission = hasPermission(currentUser, PERMISSIONS.PERMISSION_DELETE);
  
  // 模态框状态
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  
  // 表单状态
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [batchForm] = Form.useForm();
  
  // 当前选中的权限
  const [selectedPermission, setSelectedPermission] = useState(null);

  // 获取权限列表
  const fetchPermissions = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/permissions');
      setPermissions(res.data.permissions);
    } catch (err) {
      message.error('获取权限列表失败');
      console.error('Fetch permissions error:', err);
    } finally {
      setLoading(false);
    }
  };

  // 组件加载时获取权限列表
  useEffect(() => {
    fetchPermissions();
  }, []);

  // 打开创建权限模态框
  const showCreateModal = () => {
    setCreateModalOpen(true);
    createForm.resetFields();
  };

  // 打开编辑权限模态框
  const showEditModal = (permission) => {
    setSelectedPermission(permission);
    editForm.setFieldsValue(permission);
    setEditModalOpen(true);
  };

  // 打开批量创建权限模态框
  const showBatchModal = () => {
    setBatchModalOpen(true);
    batchForm.resetFields();
  };

  // 创建权限
  const handleCreatePermission = async (values) => {
    try {
      await axios.post('/api/permissions', values);
      message.success('创建权限成功');
      setCreateModalOpen(false);
      fetchPermissions();
    } catch (err) {
      message.error(err.response?.data?.message || '创建权限失败');
      console.error('Create permission error:', err);
    }
  };

  // 批量创建权限
  const handleBatchCreatePermissions = async (values) => {
    try {
      const permissions = [];
      const lines = values.permissionsText.split('\n').filter(line => line.trim() !== '');
      
      lines.forEach(line => {
        const [name, description, type] = line.split(',').map(item => item.trim());
        if (name) {
          permissions.push({
            name,
            description: description || '',
            type: type || 'file'
          });
        }
      });
      
      if (permissions.length === 0) {
        message.warning('请输入有效的权限数据');
        return;
      }
      
      const res = await axios.post('/api/permissions/batch', { permissions });
      message.success(`成功创建 ${res.data.permissions.length} 个权限，${res.data.existing.length} 个权限已存在`);
      setBatchModalOpen(false);
      fetchPermissions();
    } catch (err) {
      message.error(err.response?.data?.message || '批量创建权限失败');
      console.error('Batch create permissions error:', err);
    }
  };

  // 编辑权限
  const handleEditPermission = async (values) => {
    try {
      await axios.put(`/api/permissions/${selectedPermission._id}`, values);
      message.success('更新权限成功');
      setEditModalOpen(false);
      fetchPermissions();
    } catch (err) {
      message.error(err.response?.data?.message || '更新权限失败');
      console.error('Edit permission error:', err);
    }
  };

  // 删除权限
  const handleDeletePermission = async (permissionId) => {
    try {
      await axios.delete(`/api/permissions/${permissionId}`);
      message.success('删除权限成功');
      fetchPermissions();
    } catch (err) {
      message.error(err.response?.data?.message || '删除权限失败');
      console.error('Delete permission error:', err);
    }
  };

  // 表格列配置
  const columns = [
    {
      title: '权限名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Space>
          {getPermissionIcon(record.type)}
          {text}
        </Space>
      )
    },
    {
      title: '权限描述',
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: '权限类型',
      dataIndex: 'type',
      key: 'type',
      render: (type) => (
        <Select defaultValue={type} disabled style={{ width: 120 }}>
          {permissionTypeOptions.map((option) => (
            <Option key={option.value} value={option.value}>{option.label}</Option>
          ))}
        </Select>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date) => new Date(date).toLocaleString()
    },
    (canUpdatePermission || canDeletePermission) && {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          {canUpdatePermission && (
            <Button 
              type="primary" 
              icon={<EditOutlined />} 
              size="small"
              onClick={() => showEditModal(record)}
            >
              编辑
            </Button>
          )}
          {canDeletePermission && (
            <Popconfirm
              title="删除权限"
              description="删除后将无法恢复，确认删除该权限？"
              onConfirm={() => handleDeletePermission(record._id)}
              okText="确定"
              cancelText="取消"
            >
              <Button 
                danger 
                icon={<DeleteOutlined />} 
                size="small"
              >
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ].filter(Boolean);

  // 按类型过滤权限
  const filteredPermissions = {
    system: permissions.filter(perm => perm.type === 'system'),
    department: permissions.filter(perm => perm.type === 'department'),
    file: permissions.filter(perm => perm.type === 'file'),
    folder: permissions.filter(perm => perm.type === 'folder')
  };
  const renderPermissionTable = (dataSource) => (
    <Table
      columns={columns}
      dataSource={dataSource}
      rowKey="_id"
      loading={loading}
      pagination={{
        pageSize: 10
      }}
    />
  );
  const tabItems = [
    {
      key: 'all',
      label: '所有权限',
      children: renderPermissionTable(permissions),
    },
    {
      key: 'system',
      label: '系统权限',
      children: renderPermissionTable(filteredPermissions.system),
    },
    {
      key: 'department',
      label: '部门权限',
      children: renderPermissionTable(filteredPermissions.department),
    },
    {
      key: 'file',
      label: '资料权限',
      children: renderPermissionTable(filteredPermissions.file),
    },
    {
      key: 'folder',
      label: '目录权限',
      children: renderPermissionTable(filteredPermissions.folder),
    },
  ];

  return (
    <div className="permission-management-container">
      <PageHeader
        title="权限管理"
        extra={(
          <Space>
            {canCreatePermission && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={showCreateModal}
              >
                创建权限
              </Button>
            )}
            {canBatchCreatePermissions && (
              <Button
                type="default"
                icon={<UploadOutlined />}
                onClick={showBatchModal}
              >
                批量创建
              </Button>
            )}
          </Space>
        )}
      />
      <Card className="content-card">
        <Tabs defaultActiveKey="all" items={tabItems} />

        {/* 创建权限模态框 */}
        <Modal
          title="创建权限"
          open={createModalOpen}
          onCancel={() => setCreateModalOpen(false)}
          footer={null}
        >
          <Form
            form={createForm}
            layout="vertical"
            onFinish={handleCreatePermission}
          >
            <Form.Item
              name="name"
              label="权限名称"
              rules={[{ required: true, message: '请输入权限名称' }]}
            >
              <Input prefix={<LockOutlined />} placeholder="权限名称" />
            </Form.Item>
            <Form.Item
              name="description"
              label="权限描述"
            >
              <Input.TextArea placeholder="权限描述" rows={3} />
            </Form.Item>
            <Form.Item
              name="type"
              label="权限类型"
              rules={[{ required: true, message: '请选择权限类型' }]}
            >
              <Select placeholder="选择权限类型">
                {permissionTypeOptions.map((option) => (
                  <Option key={option.value} value={option.value}>{option.label}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block>
                创建
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        {/* 编辑权限模态框 */}
        <Modal
          title="编辑权限"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          footer={null}
        >
          <Form
            form={editForm}
            layout="vertical"
            onFinish={handleEditPermission}
          >
            <Form.Item
              name="name"
              label="权限名称"
              rules={[{ required: true, message: '请输入权限名称' }]}
            >
              <Input prefix={<LockOutlined />} placeholder="权限名称" />
            </Form.Item>
            <Form.Item
              name="description"
              label="权限描述"
            >
              <Input.TextArea placeholder="权限描述" rows={3} />
            </Form.Item>
            <Form.Item
              name="type"
              label="权限类型"
              rules={[{ required: true, message: '请选择权限类型' }]}
            >
              <Select placeholder="选择权限类型">
                {permissionTypeOptions.map((option) => (
                  <Option key={option.value} value={option.value}>{option.label}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block>
                保存
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        {/* 批量创建权限模态框 */}
        <Modal
          title="批量创建权限"
          open={batchModalOpen}
          onCancel={() => setBatchModalOpen(false)}
          footer={null}
          width={600}
        >
          <Form
            form={batchForm}
            layout="vertical"
            onFinish={handleBatchCreatePermissions}
          >
            <Form.Item
              name="permissionsText"
              label="权限数据"
              rules={[{ required: true, message: '请输入权限数据' }]}
            >
              <Input.TextArea
                placeholder="请按照格式输入权限数据，每行一条：权限名称,描述,类型（system/department/file/folder）\n例如：file:read,查看资料,file\nrole:read,查看角色,system"
                rows={8}
              />
            </Form.Item>
            <Divider>示例格式</Divider>
            <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 4 }}>
              file:read,查看资料,file
              file:create,上传资料,file
              role:read,查看角色,system
              department:read,查看部门,department
            </pre>
            <Form.Item>
              <Button type="primary" htmlType="submit" block>
                批量创建
              </Button>
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </div>
  );
};

export default PermissionManagement;
