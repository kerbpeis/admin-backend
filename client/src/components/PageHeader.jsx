import React from 'react';
import { Typography } from 'antd';

const { Title, Text } = Typography;

// 页面级标题：主标题 + 可选副标题 + 右侧操作区，全站页面统一使用
const PageHeader = ({ title, subtitle, extra }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  }}>
    <div>
      <Title level={4} style={{ margin: 0 }}>{title}</Title>
      {subtitle ? <Text type="secondary">{subtitle}</Text> : null}
    </div>
    {extra}
  </div>
);

export default PageHeader;
