import React, { useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import '../assets/css/Login.css';

const Login = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values) => {
    try {
      setLoading(true);
      const res = await axios.post('/api/auth/login', values);
      
      if (res.data.token) {
        // 保存令牌到本地存储
        localStorage.setItem('token', res.data.token);
        // 设置Axios默认请求头
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        // 调用父组件的登录成功回调
        onLoginSuccess(res.data.user);
        message.success('登录成功');
      }
    } catch (err) {
      message.error(err.response?.data?.message || '登录失败，请检查用户名和密码');
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <Card title="后台管理系统登录" className="login-card">
        <Form
          name="login-form"
          onFinish={handleLogin}
          layout="vertical"
        >
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input
              prefix={<UserOutlined className="site-form-item-icon" />}
              placeholder="邮箱"
              autoComplete="off"
            />
          </Form.Item>
          
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码长度不能少于6个字符' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="site-form-item-icon" />}
              placeholder="密码"
              autoComplete="off"
            />
          </Form.Item>
          
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              className="login-button"
              loading={loading}
              block
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Login;