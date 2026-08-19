import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Popconfirm, message, Space, Card } from 'antd';
import { TeamOutlined, PlusOutlined, EditOutlined, DeleteOutlined, LockOutlined, FileTextOutlined, FolderOutlined, UserOutlined } from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../components/PageHeader';
import { PERMISSIONS, hasPermission } from '../utils/permissions';

const { Option } = Select;

const getPermissionIcon = (type) => {
  if (type === 'file') return <FileTextOutlined />;
  if (type === 'folder') return <FolderOutlined />;
  return <LockOutlined />;
};

const RoleManagement = ({ currentUser }) => {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const canCreateRole = hasPermission(currentUser, PERMISSIONS.ROLE_CREATE);
  const canUpdateRole = hasPermission(currentUser, PERMISSIONS.ROLE_UPDATE);
  const canDeleteRole = hasPermission(currentUser, PERMISSIONS.ROLE_DELETE);
  const canAssignPermissions = hasPermission(currentUser, PERMISSIONS.ROLE_ASSIGN_PERMISSION);
  
  // 模态框状态
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  
  // 表单状态
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [permissionForm] = Form.useForm();
  
  // 当前选中的角色
  const [selectedRole, setSelectedRole] = useState(null);

  // 获取角色列表
  const fetchRoles = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/roles');
      setRoles(res.data.roles);
    } catch (err) {
      message.error('获取角色列表失败');
      console.error('Fetch roles error:', err);
    } finally {
      setLoading(false);
    }
  };

  // 获取权限列表
  const fetchPermissions = async () => {
    try {
      const res = await axios.get('/api/permissions');
      setPermissions(res.data.permissions);
    } catch (err) {
      message.error('获取权限列表失败');
      console.error('Fetch permissions error:', err);
    }
  };

  // 组件加载时获取角色和权限列表
  useEffect(() => {
    fetchRoles();
    if (canAssignPermissions) {
      fetchPermissions();
    }
  }, [canAssignPermissions]);

  // 打开创建角色模态框
  const showCreateModal = () => {
    setCreateModalOpen(true);
    createForm.resetFields();
  };

  // 打开编辑角色模态框
  const showEditModal = (role) => {
    setSelectedRole(role);
    editForm.setFieldsValue(role);
    setEditModalOpen(true);
  };

  // 打开分配权限模态框
  const showPermissionModal = (role) => {
    setSelectedRole(role);
    permissionForm.setFieldsValue({
      permissionIds: role.permissions?.map(permission => permission._id) || []
    });
    setPermissionModalOpen(true);
  };

  // 创建角色
  const handleCreateRole = async (values) => {
    try {
      await axios.post('/api/roles', values);
      message.success('创建角色成功');
      setCreateModalOpen(false);
      fetchRoles();
    } catch (err) {
      message.error(err.response?.data?.message || '创建角色失败');
      console.error('Create role error:', err);
    }
  };

  // 编辑角色
  const handleEditRole = async (values) => {
    try {
      await axios.put(`/api/roles/${selectedRole._id}`, values);
      message.success('更新角色成功');
      setEditModalOpen(false);
      fetchRoles();
    } catch (err) {
      message.error(err.response?.data?.message || '更新角色失败');
      console.error('Edit role error:', err);
    }
  };

  // 删除角色
  const handleDeleteRole = async (roleId) => {
    try {
      await axios.delete(`/api/roles/${roleId}`);
      message.success('删除角色成功');
      fetchRoles();
    } catch (err) {
      message.error(err.response?.data?.message || '删除角色失败');
      console.error('Delete role error:', err);
    }
  };

  // 分配权限
  const handleAssignPermissions = async (values) => {
    try {
      await axios.post(`/api/roles/${selectedRole._id}/permissions`, { permissionIds: values.permissionIds });
      message.success('分配权限成功');
      setPermissionModalOpen(false);
      fetchRoles();
    } catch (err) {
      message.error(err.response?.data?.message || '分配权限失败');
      console.error('Assign permissions error:', err);
    }
  };

  // 表格列配置
  const columns = [
    {
      title: '角色名称',
      dataIndex: 'name',
      key: 'name',
      render: (text) => (
        <Space>
          <TeamOutlined />
          {text}
        </Space>
      )
    },
    {
      title: '角色描述',
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions) => (
        <Space wrap>
          {permissions?.map(permission => (
            <span key={permission._id} className="permission-tag">
              {permission.name}
            </span>
          )) || '无'}
        </Space>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date) => new Date(date).toLocaleString()
    },
    (canUpdateRole || canAssignPermissions || canDeleteRole) && {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          {canUpdateRole && (
            <Button 
              type="primary" 
              icon={<EditOutlined />} 
              size="small"
              onClick={() => showEditModal(record)}
            >
              编辑
            </Button>
          )}
          {canAssignPermissions && (
            <Button 
              icon={<LockOutlined />} 
              size="small"
              onClick={() => showPermissionModal(record)}
            >
              分配权限
            </Button>
          )}
          {canDeleteRole && (
            <Popconfirm
              title="删除角色"
              description="删除后将无法恢复，确认删除该角色？"
              onConfirm={() => handleDeleteRole(record._id)}
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

  return (
    <div className="role-management-container">
      <PageHeader
        title="角色管理"
        extra={canCreateRole ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={showCreateModal}
          >
            创建角色
          </Button>
        ) : null}
      />
      <Card className="content-card">
        <Table
          columns={columns}
          dataSource={roles}
          rowKey="_id"
          loading={loading}
          pagination={{
            pageSize: 10
          }}
        />

        {/* 创建角色模态框 */}
        <Modal
          title="创建角色"
          open={createModalOpen}
          onCancel={() => setCreateModalOpen(false)}
          footer={null}
        >
          <Form
            form={createForm}
            layout="vertical"
            onFinish={handleCreateRole}
          >
            <Form.Item
              name="name"
              label="角色名称"
              rules={[{ required: true, message: '请输入角色名称' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="角色名称" />
            </Form.Item>
            <Form.Item
              name="description"
              label="角色描述"
            >
              <Input.TextArea placeholder="角色描述" rows={3} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block>
                创建
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        {/* 编辑角色模态框 */}
        <Modal
          title="编辑角色"
          open={editModalOpen}
          onCancel={() => setEditModalOpen(false)}
          footer={null}
        >
          <Form
            form={editForm}
            layout="vertical"
            onFinish={handleEditRole}
          >
            <Form.Item
              name="name"
              label="角色名称"
              rules={[{ required: true, message: '请输入角色名称' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="角色名称" />
            </Form.Item>
            <Form.Item
              name="description"
              label="角色描述"
            >
              <Input.TextArea placeholder="角色描述" rows={3} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block>
                保存
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        {/* 分配权限模态框 */}
        <Modal
          title="分配权限"
          open={permissionModalOpen}
          onCancel={() => setPermissionModalOpen(false)}
          footer={null}
          width={600}
        >
          <Form
            form={permissionForm}
            layout="vertical"
            onFinish={handleAssignPermissions}
          >
            <Form.Item
              name="permissionIds"
              label="权限"
              rules={[{ required: true, message: '请选择权限' }]}
            >
              <Select
                mode="multiple"
                placeholder="选择权限"
                style={{ width: '100%' }}
                optionFilterProp="children"
                maxTagCount="responsive"
              >
                {permissions.map(permission => (
                  <Option key={permission._id} value={permission._id}>
                    <Space>
                      {getPermissionIcon(permission.type)}
                      {permission.name}
                    </Space>
                  </Option>
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
      </Card>
    </div>
  );
};

export default RoleManagement;
