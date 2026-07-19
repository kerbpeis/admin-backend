import React, { useState, useEffect } from 'react';
import { Table, Button, Form, Input, Select, Modal, message, Card, Switch } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UnorderedListOutlined } from '@ant-design/icons';
import axios from 'axios';
import { PERMISSIONS, hasPermission } from '../utils/permissions';

const { Option } = Select;

const UserManagement = ({ currentUser }) => {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const canCreateUser = hasPermission(currentUser, PERMISSIONS.USER_CREATE);
  const canUpdateUser = hasPermission(currentUser, PERMISSIONS.USER_UPDATE);
  const canDeleteUser = hasPermission(currentUser, PERMISSIONS.USER_DELETE);
  const canAssignRoles = hasPermission(currentUser, PERMISSIONS.USER_ASSIGN_ROLE);
  const canGrantAdmin = hasPermission(currentUser, PERMISSIONS.USER_GRANT_ADMIN);
  
  // 模态框状态
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  
  // 表单状态
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [roleForm] = Form.useForm();

  // 获取用户列表
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/users');
      setUsers(res.data.users || []);
    } catch (err) {
      message.error(err.response?.data?.message || '获取用户列表失败');
      console.error('Fetch users error:', err);
    } finally {
      setLoading(false);
    }
  };

  // 获取角色列表
  const fetchRoles = async () => {
    try {
      const res = await axios.get('/api/roles');
      setRoles(res.data.roles || []);
    } catch (err) {
      message.error(err.response?.data?.message || '获取角色列表失败');
      console.error('Fetch roles error:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    if (canAssignRoles) {
      fetchRoles();
    }
  }, [canAssignRoles]);

  // 打开创建用户模态框
  const showCreateModal = () => {
    setCreateModalOpen(true);
    createForm.resetFields();
  };

  // 打开编辑用户模态框
  const showEditModal = (user) => {
    setSelectedUser(user);
    editForm.setFieldsValue(user);
    setEditModalOpen(true);
  };

  // 打开分配角色模态框
  const showRoleModal = (user) => {
    setSelectedUser(user);
    roleForm.setFieldsValue({
      roleIds: user.roles?.map(role => role._id) || []
    });
    setRoleModalOpen(true);
  };

  // 创建用户
  const handleCreateUser = async (values) => {
    try {
      await axios.post('/api/users', values);
      message.success('创建用户成功');
      setCreateModalOpen(false);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || '创建用户失败');
      console.error('Create user error:', err);
    }
  };

  // 编辑用户
  const handleEditUser = async (values) => {
    try {
      await axios.put(`/api/users/${selectedUser._id}`, values);
      message.success('更新用户成功');
      setEditModalOpen(false);
      
      // 直接更新本地状态中的用户信息，确保界面立即反映更新后的信息
      setUsers(users.map(user => {
        if (user._id === selectedUser._id) {
          // 返回更新后的用户信息
          return {
            ...user,
            ...values
          };
        }
        return user;
      }));
    } catch (err) {
      message.error(err.response?.data?.message || '更新用户失败');
      console.error('Edit user error:', err);
    }
  };

  // 删除用户
  const handleDeleteUser = async (userId) => {
    try {
      await axios.delete(`/api/users/${userId}`);
      message.success('删除用户成功');
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || '删除用户失败');
      console.error('Delete user error:', err);
    }
  };

  // 分配角色
  const handleAssignRoles = async (values) => {
    try {
      await axios.post(`/api/users/${selectedUser._id}/roles`, values);
      message.success('分配角色成功');
      setRoleModalOpen(false);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || '分配角色失败');
      console.error('Assign roles error:', err);
    }
  };

  // 表格列配置
  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '部门',
      dataIndex: 'department',
      key: 'department',
    },
    {
      title: '科室',
      dataIndex: 'section',
      key: 'section',
    },
    {
      title: '角色',
      dataIndex: 'roles',
      key: 'roles',
      render: (roles) => (
        <span>
          {roles?.map(role => role.name).join(', ') || '无'}
        </span>
      ),
    },
    {
      title: '管理员',
      dataIndex: 'isAdmin',
      key: 'isAdmin',
      render: (isAdmin) => (
        <Switch checked={isAdmin} disabled />
      ),
    },
    (canUpdateUser || canAssignRoles || canDeleteUser) && {
      title: '操作',
      key: 'action',
      render: (_, user) => {
        const actions = [];

        if (canUpdateUser) {
          actions.push(
            <Button
              key="edit"
              type="link"
              icon={<EditOutlined />}
              onClick={() => showEditModal(user)}
            >
              编辑
            </Button>
          );
        }

        if (canAssignRoles) {
          actions.push(
            <Button
              key="roles"
              type="link"
              icon={<UnorderedListOutlined />}
              onClick={() => showRoleModal(user)}
            >
              角色
            </Button>
          );
        }

        if (canDeleteUser) {
          actions.push(
            <Button
              key="delete"
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteUser(user._id)}
            >
              删除
            </Button>
          );
        }

        return <div>{actions}</div>;
      },
    },
  ].filter(Boolean);

  return (
    <Card
      title="用户管理"
      extra={canCreateUser ? <Button type="primary" icon={<PlusOutlined />} onClick={showCreateModal}>创建用户</Button> : null}
    >
      <Table 
        columns={columns} 
        dataSource={users} 
        rowKey="_id" 
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      {/* 创建用户模态框 */}
      <Modal
        title="创建用户"
        open={createModalOpen}
        onOk={() => createForm.submit()}
        onCancel={() => setCreateModalOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreateUser}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码长度不能少于6位' }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item name="department" label="部门" rules={[{ required: true, message: '请输入部门' }]}>
            <Input placeholder="请输入部门" />
          </Form.Item>
          <Form.Item name="section" label="科室" rules={[{ required: true, message: '请输入科室' }]}>
            <Input placeholder="请输入科室" />
          </Form.Item>
          {canGrantAdmin && (
            <Form.Item name="isAdmin" label="管理员" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 编辑用户模态框 */}
      <Modal
        title="编辑用户"
        open={editModalOpen}
        onOk={() => editForm.submit()}
        onCancel={() => setEditModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditUser}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
            <Input placeholder="请输入邮箱" disabled />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ min: 6, message: '密码长度不能少于6位' }]}>
            <Input.Password placeholder="不修改密码请留空" />
          </Form.Item>
          <Form.Item name="department" label="部门" rules={[{ required: true, message: '请输入部门' }]}>
            <Input placeholder="请输入部门" />
          </Form.Item>
          <Form.Item name="section" label="科室" rules={[{ required: true, message: '请输入科室' }]}>
            <Input placeholder="请输入科室" />
          </Form.Item>
          {canGrantAdmin && (
            <Form.Item name="isAdmin" label="管理员" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 分配角色模态框 */}
      <Modal
        title="分配角色"
        open={roleModalOpen}
        onOk={() => roleForm.submit()}
        onCancel={() => setRoleModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={roleForm} layout="vertical" onFinish={handleAssignRoles}>
          <Form.Item name="roleIds" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select mode="multiple" placeholder="请选择角色">
              {roles.map(role => (
                <Option key={role._id} value={role._id}>{role.name}</Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default UserManagement;
