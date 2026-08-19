// 通用请求字段校验：用于 auth / user 等接口，避免 controller 里重复手写 if/else

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const validators = {
  email: (value) => {
    const email = String(value || '').trim().toLowerCase();
    if (!email) return { ok: false, message: '请输入邮箱' };
    if (!EMAIL_RE.test(email)) return { ok: false, message: '邮箱格式不正确' };
    return { ok: true, value: email };
  },

  password: (value) => {
    const password = String(value || '');
    if (!password) return { ok: false, message: '请输入密码' };
    if (password.length < 8) return { ok: false, message: '密码不能少于 8 位' };
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return { ok: false, message: '密码必须同时包含字母和数字' };
    }
    return { ok: true, value: password };
  },

  name: (value) => {
    const name = String(value || '').trim();
    if (!name) return { ok: false, message: '请输入姓名' };
    if (name.length > 100) return { ok: false, message: '姓名不能超过 100 个字符' };
    return { ok: true, value: name };
  },

  department: (value) => {
    const department = String(value || '').trim();
    if (!department) return { ok: false, message: '请输入部门' };
    if (department.length > 100) return { ok: false, message: '部门不能超过 100 个字符' };
    return { ok: true, value: department };
  },

  section: (value) => {
    const section = String(value || '').trim();
    if (!section) return { ok: false, message: '请输入科室' };
    if (section.length > 100) return { ok: false, message: '科室不能超过 100 个字符' };
    return { ok: true, value: section };
  },

  inviteCode: (value) => {
    const code = String(value || '').trim();
    if (!code) return { ok: false, message: '请输入公司邀请码' };
    return { ok: true, value: code };
  },
};

const validateFields = (fields) => {
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    const validator = validators[key];
    if (!validator) {
      result[key] = String(value || '').trim();
      continue;
    }
    const validated = validator(value);
    if (!validated.ok) return { ok: false, field: key, message: validated.message };
    result[key] = validated.value;
  }
  return { ok: true, values: result };
};

module.exports = {
  validators,
  validateFields,
};
