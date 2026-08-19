import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
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
      let errorMsg = '登录失败，请检查用户名和密码';
      if (err.response) {
        // 服务器有响应：优先显示后端返回的 message，没有则按状态码提示
        errorMsg = err.response.data?.message || (err.response.status >= 500 ? '服务器内部错误，请稍后重试' : '登录失败，请检查用户名和密码');
      } else if (err.request) {
        // 请求已发出但没有收到响应：通常是服务器未启动或网络异常
        errorMsg = '无法连接服务器，请确认后端服务已启动';
      }
      message.error(errorMsg);
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-brand">
        <div className="login-brand-mark">库</div>
        <h1 className="login-brand-title">知识库管理后台</h1>
        <p className="login-brand-subtitle">企业资料的统一检索、共享与治理</p>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <h2 className="login-panel-title">登录</h2>
          <p className="login-panel-hint">使用企业邮箱登录管理后台</p>
          <Form
            name="login-form"
            onFinish={handleLogin}
            layout="vertical"
            size="large"
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
                { min: 8, message: '密码不能少于 8 位' },
                () => ({
                  validator(_, value) {
                    if (!value || (value.length >= 8 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value))) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('密码必须同时包含字母和数字'));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined className="site-form-item-icon" />}
                placeholder="密码"
                autoComplete="off"
              />
            </Form.Item>
            
            <Form.Item style={{ marginBottom: 0 }}>
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
        </div>
      </div>
    </div>
  );
};

export default Login;
