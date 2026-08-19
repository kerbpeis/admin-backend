import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './api';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

// 设置dayjs中文
dayjs.locale('zh-cn');

// 品牌主题：深松石绿主色 + 同色系深色侧边栏，区别于 antd 默认蓝
const theme = {
  token: {
    colorPrimary: '#0F6B5C',
    colorInfo: '#0F6B5C',
    colorLink: '#0F6B5C',
    colorError: '#B42318',
    colorWarning: '#B54708',
    borderRadius: 6,
    fontSize: 13,
  },
  components: {
    Layout: {
      siderBg: '#0F2E28',
      headerBg: '#ffffff',
    },
    Menu: {
      darkItemBg: '#0F2E28',
      darkSubMenuItemBg: '#0A241F',
      darkItemSelectedBg: '#0F6B5C',
      darkItemColor: 'rgba(255, 255, 255, 0.75)',
    },
    Table: {
      headerBg: '#F7F8F7',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
