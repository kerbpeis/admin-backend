// 类型标签调色板：同一文本全站固定同色，靠颜色扫读
const TAG_PALETTE = ['green', 'geekblue', 'purple', 'cyan', 'magenta', 'gold', 'volcano', 'lime'];

const tagColor = (text) => {
  const key = String(text || '');
  const hash = [...key].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return TAG_PALETTE[hash % TAG_PALETTE.length];
};

export default tagColor;
