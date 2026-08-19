// 统一的 500 响应：完整错误只记录到服务端日志，不下发给客户端
const sendServerError = (res, err, message = '服务器内部错误') => {
  console.error(`${message}:`, err);
  return res.status(500).json({ message });
};

module.exports = { sendServerError };
