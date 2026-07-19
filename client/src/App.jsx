import React, { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Dropdown, message, Result } from 'antd';
import {
  AuditOutlined,
  DashboardOutlined,
  UserOutlined,
  TeamOutlined,
  LockOutlined,
  LogoutOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Login from './pages/Login';
import UserManagement from './pages/UserManagement';
import RoleManagement from './pages/RoleManagement';
import PermissionManagement from './pages/PermissionManagement';
import LibraryDashboard from './pages/LibraryDashboard';
import AuditLogManagement from './pages/AuditLogManagement';
import { PERMISSIONS, hasPermission } from './utils/permissions';

const { Header, Sider, Content } = Layout;

const navItems = [
  {
    key: '/library-dashboard',
    icon: <DashboardOutlined />,
    label: '资料库概览',
    path: '/library-dashboard',
    permission: PERMISSIONS.FILE_READ
  },
  {
    key: '/users',
    icon: <TeamOutlined />,
    label: '用户管理',
    path: '/users',
    permission: PERMISSIONS.USER_READ
  },
  {
    key: '/roles',
    icon: <UserOutlined />,
    label: '角色管理',
    path: '/roles',
    permission: PERMISSIONS.ROLE_READ
  },
  {
    key: '/permissions',
    icon: <LockOutlined />,
    label: '权限管理',
    path: '/permissions',
    permission: PERMISSIONS.PERMISSION_READ
  },
  {
    key: '/audit-logs',
    icon: <AuditOutlined />,
    label: '审计日志',
    path: '/audit-logs',
    permission: PERMISSIONS.AUDIT_READ
  }
];

const getAllowedNavItems = (user) => navItems
  .filter((item) => hasPermission(user, item.permission))
  .map((item) => ({
    key: item.key,
    icon: item.icon,
    label: <Link to={item.path}>{item.label}</Link>,
  }));

const getDefaultPath = (user) => (
  navItems.find((item) => hasPermission(user, item.permission))?.path || '/forbidden'
);

const AccessDenied = () => (
  <Result
    status="403"
    title="无权限访问"
    subTitle="当前账号没有访问该模块的权限，请联系管理员调整角色权限。"
  />
);

// 登录状态提供者组件
function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 检查用户登录状态
  useEffect(() => {
    const checkLoginStatus = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          setCurrentUser(null);
          setLoading(false);
          return;
        }

        // 设置Axios默认请求头
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

        // 获取当前用户信息
        const res = await axios.get('/api/auth/me');
        setCurrentUser(res.data.user);
      } catch (err) {
        console.error('获取用户信息失败:', err);
        // 清除无效令牌和axios的默认请求头
        localStorage.removeItem('token');
        delete axios.defaults.headers.common['Authorization'];
        setCurrentUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkLoginStatus();
  }, []);

  // 退出登录
  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
      setCurrentUser(null);
      message.success('退出登录成功');
    }
  };

  // 如果children是函数，调用它并传递props，否则返回children
  if (typeof children === 'function') {
    return children({
      currentUser,
      setCurrentUser,
      loading,
      handleLogout
    });
  }

  return children;
}

// 登录页面组件（包含导航逻辑）
function LoginPage({ setCurrentUser }) {
  const navigate = useNavigate();

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    navigate(getDefaultPath(user));
  };

  return <Login onLoginSuccess={handleLoginSuccess} />;
}

// 应用布局组件
const AppLayout = ({ currentUser, collapsed, setCollapsed, menuItems, userMenuItems, children }) => {
  const location = useLocation();

  return (
    <Layout>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        <div style={{ 
          height: '32px', 
          margin: '16px', 
          background: 'rgba(255, 255, 255, 0.2)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 'bold'
        }}>
          {collapsed ? <AppstoreOutlined /> : '后台管理系统'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', background: '#fff', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)' }}>
          <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} style={{ marginRight: '8px' }} />
              <span style={{ marginRight: '4px' }}>{currentUser?.name}</span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: '16px', padding: 24, background: '#fff', borderRadius: '4px', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

const ProtectedPage = ({ currentUser, requiredPermission, layoutProps, children }) => {
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppLayout {...layoutProps}>
      {hasPermission(currentUser, requiredPermission) ? children : <AccessDenied />}
    </AppLayout>
  );
};

// 主应用组件
function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Router future={{ v7_relativeSplatPath: true }}>
      <AuthProvider>
        {({ currentUser, setCurrentUser, loading, handleLogout }) => {
          // 如果正在加载，显示加载提示
          if (loading) {
            return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '20px' }}>加载中...</div>;
          }

          // 用户下拉菜单
          const userMenuItems = [
            {
              key: 'profile',
              label: (
                <div>
                  <div style={{ fontWeight: 'bold' }}>{currentUser?.name}</div>
                  <div style={{ fontSize: '12px', color: '#999' }}>{currentUser?.email}</div>
                </div>
              )
            },
            {
              key: 'logout',
              icon: <LogoutOutlined />,
              label: '退出登录',
              onClick: handleLogout
            }
          ];
          const menuItems = getAllowedNavItems(currentUser);
          const layoutProps = {
            currentUser,
            collapsed,
            setCollapsed,
            menuItems,
            userMenuItems,
          };

          return (
            <Routes>
              {/* 根路由重定向到当前用户的第一个可访问页面 */}
              <Route path="/" element={currentUser ? <Navigate to={getDefaultPath(currentUser)} replace /> : <Navigate to="/login" replace />} />
              
              {/* 登录页面 */}
              <Route path="/login" element={currentUser ? <Navigate to={getDefaultPath(currentUser)} replace /> : <LoginPage setCurrentUser={setCurrentUser} />} />
              
              {/* 资料库概览页面 */}
              <Route path="/library-dashboard" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.FILE_READ} layoutProps={layoutProps}><LibraryDashboard currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 保护路由组 */}
              <Route path="/users" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.USER_READ} layoutProps={layoutProps}><UserManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 角色管理页面 */}
              <Route path="/roles" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.ROLE_READ} layoutProps={layoutProps}><RoleManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 权限管理页面 */}
              <Route path="/permissions" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.PERMISSION_READ} layoutProps={layoutProps}><PermissionManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 审计日志页面 */}
              <Route path="/audit-logs" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.AUDIT_READ} layoutProps={layoutProps}><AuditLogManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 无权限页面 */}
              <Route path="/forbidden" element={currentUser ? <AppLayout {...layoutProps}><AccessDenied /></AppLayout> : <Navigate to="/login" replace />} />
              
              {/* 默认重定向到当前用户的第一个可访问页面 */}
              <Route path="*" element={currentUser ? <Navigate to={getDefaultPath(currentUser)} replace /> : <Navigate to="/login" replace />} />
            </Routes>
          );
        }}
      </AuthProvider>
    </Router>
  );
}

export default App;
