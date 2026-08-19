import React, { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Dropdown, message, Result, Spin } from 'antd';
import {
  AuditOutlined,
  BankOutlined,
  DashboardOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  UserOutlined,
  TeamOutlined,
  LockOutlined,
  LogoutOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Login from './pages/Login';
import UserManagement from './pages/UserManagement';
import RoleManagement from './pages/RoleManagement';
import PermissionManagement from './pages/PermissionManagement';
import LibraryDashboard from './pages/LibraryDashboard';
import AuditLogManagement from './pages/AuditLogManagement';
import DirectoryManagement from './pages/DirectoryManagement';
import ContentManagement from './pages/ContentManagement';
import ShareReviewManagement from './pages/ShareReviewManagement';
import CompanyManagement from './pages/CompanyManagement';
import ConfigManagement from './pages/ConfigManagement';
import { PERMISSIONS, hasAnyPermission, hasPermission } from './utils/permissions';

const { Header, Sider, Content } = Layout;

// 导航按使用场景分组：内容运营是日常工作，系统管理是低频配置
const navItems = [
  {
    key: '/library-dashboard',
    icon: <DashboardOutlined />,
    label: '资料库概览',
    path: '/library-dashboard',
    permission: PERMISSIONS.FILE_READ,
    group: 'content'
  },
  {
    key: '/departments',
    icon: <FolderOpenOutlined />,
    label: '公司目录',
    path: '/departments',
    permission: PERMISSIONS.DEPARTMENT_READ,
    group: 'content'
  },
  {
    key: '/content-library',
    icon: <FileTextOutlined />,
    label: '资料内容',
    path: '/content-library',
    permission: [PERMISSIONS.FILE_READ, PERMISSIONS.FOLDER_READ],
    group: 'content'
  },
  {
    key: '/share-reviews',
    icon: <CheckCircleOutlined />,
    label: '共享审核',
    path: '/share-reviews',
    permission: [PERMISSIONS.FILE_CREATE, PERMISSIONS.FILE_UPDATE],
    group: 'content'
  },
  {
    key: '/users',
    icon: <TeamOutlined />,
    label: '用户管理',
    path: '/users',
    permission: PERMISSIONS.USER_READ,
    group: 'system'
  },
  {
    key: '/roles',
    icon: <UserOutlined />,
    label: '角色管理',
    path: '/roles',
    permission: PERMISSIONS.ROLE_READ,
    group: 'system'
  },
  {
    key: '/permissions',
    icon: <LockOutlined />,
    label: '权限管理',
    path: '/permissions',
    permission: PERMISSIONS.PERMISSION_READ,
    group: 'system'
  },
  {
    key: '/audit-logs',
    icon: <AuditOutlined />,
    label: '审计日志',
    path: '/audit-logs',
    permission: PERMISSIONS.AUDIT_READ,
    group: 'system'
  },
  {
    key: '/companies',
    icon: <BankOutlined />,
    label: '公司管理',
    path: '/companies',
    permission: PERMISSIONS.USER_READ,
    platformOnly: true,
    group: 'system'
  },
  {
    key: '/config',
    icon: <SettingOutlined />,
    label: '系统配置',
    path: '/config',
    permission: PERMISSIONS.PERMISSION_UPDATE,
    group: 'system'
  }
];

const NAV_GROUP_LABELS = {
  content: '内容运营',
  system: '系统管理'
};

const isPlatformAdminUser = (user) => Boolean(user?.isAdmin) && user?.platformRole === 'super_admin';

const canAccessItem = (user, itemOrPermission) => {
  const item = typeof itemOrPermission === 'object' && itemOrPermission !== null
    ? itemOrPermission
    : { permission: itemOrPermission };
  if (item.platformOnly && !isPlatformAdminUser(user)) return false;
  return Array.isArray(item.permission) ? hasAnyPermission(user, item.permission) : hasPermission(user, item.permission);
};

const getAllowedNavItems = (user) => {
  const groups = [];
  navItems.filter((item) => canAccessItem(user, item)).forEach((item) => {
    let group = groups.find((entry) => entry.key === `group-${item.group}`);
    if (!group) {
      group = {
        key: `group-${item.group}`,
        type: 'group',
        label: NAV_GROUP_LABELS[item.group],
        children: []
      };
      groups.push(group);
    }
    group.children.push({
      key: item.key,
      icon: item.icon,
      label: <Link to={item.path}>{item.label}</Link>,
    });
  });
  return groups;
};

const getDefaultPath = (user) => (
  navItems.find((item) => canAccessItem(user, item))?.path || '/forbidden'
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
        <div className="sider-brand">
          <span className="sider-brand-mark">库</span>
          {!collapsed && <span className="sider-brand-name">知识库管理后台</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', background: '#fff', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)' }}>
          <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} style={{ marginRight: '8px' }} />
              <span style={{ marginRight: '4px' }}>{currentUser?.name}</span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: '16px', padding: 24, background: '#fff', borderRadius: '6px', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

const ProtectedPage = ({ currentUser, requiredPermission, platformOnly = false, layoutProps, children }) => {
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppLayout {...layoutProps}>
      {canAccessItem(currentUser, { permission: requiredPermission, platformOnly }) ? children : <AccessDenied />}
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
            return <div className="loading-container"><Spin size="large" /></div>;
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

              {/* 公司管理 */}
              <Route path="/companies" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.USER_READ} platformOnly layoutProps={layoutProps}><CompanyManagement currentUser={currentUser} /></ProtectedPage>} />

              {/* 公司目录管理 */}
              <Route path="/departments" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.DEPARTMENT_READ} layoutProps={layoutProps}><DirectoryManagement currentUser={currentUser} /></ProtectedPage>} />

              {/* 资料内容管理 */}
              <Route path="/content-library" element={<ProtectedPage currentUser={currentUser} requiredPermission={[PERMISSIONS.FILE_READ, PERMISSIONS.FOLDER_READ]} layoutProps={layoutProps}><ContentManagement currentUser={currentUser} /></ProtectedPage>} />

              {/* 共享审核 */}
              <Route path="/share-reviews" element={<ProtectedPage currentUser={currentUser} requiredPermission={[PERMISSIONS.FILE_CREATE, PERMISSIONS.FILE_UPDATE]} layoutProps={layoutProps}><ShareReviewManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 保护路由组 */}
              <Route path="/users" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.USER_READ} layoutProps={layoutProps}><UserManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 角色管理页面 */}
              <Route path="/roles" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.ROLE_READ} layoutProps={layoutProps}><RoleManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 权限管理页面 */}
              <Route path="/permissions" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.PERMISSION_READ} layoutProps={layoutProps}><PermissionManagement currentUser={currentUser} /></ProtectedPage>} />
              
              {/* 审计日志页面 */}
              <Route path="/audit-logs" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.AUDIT_READ} layoutProps={layoutProps}><AuditLogManagement currentUser={currentUser} /></ProtectedPage>} />

              {/* 系统配置页面 */}
              <Route path="/config" element={<ProtectedPage currentUser={currentUser} requiredPermission={PERMISSIONS.PERMISSION_UPDATE} layoutProps={layoutProps}><ConfigManagement currentUser={currentUser} /></ProtectedPage>} />
              
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
