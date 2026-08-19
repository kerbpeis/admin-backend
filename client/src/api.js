import axios from 'axios';
import { message } from 'antd';

// 401 统一处理：令牌失效时清理本地状态并回到登录页，
// 避免各页面各自报错但用户卡在旧会话里。
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const isLoginRequest = url.includes('/api/auth/login');

    if (status === 401 && !isLoginRequest) {
      localStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
      if (window.location.pathname !== '/login') {
        message.error('登录已过期，请重新登录');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);
