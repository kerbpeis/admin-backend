require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const account = {
  email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
};

const request = async (endpoint, { token, expectedStatus = 200, ...options } = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`${options.method || 'GET'} ${endpoint} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
};

const login = async () => {
  const data = await request('/api/auth/login', {
    method: 'POST',
    expectedStatus: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  return data.token;
};

const main = async () => {
  const token = await login();
  const before = await request('/api/partner-state', { token });
  const temporaryState = {
    version: 'verify-partner-state',
    clientUpdatedAt: new Date().toISOString(),
    users: [],
    conversations: [],
    messages: [],
    tasks: [{
      id: 'verify-task',
      title: '搭子状态同步验证',
      status: 'in_progress',
    }],
    notifications: [],
  };

  try {
    const saved = await request('/api/partner-state', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: temporaryState }),
    });
    if (!saved.exists || saved.state?.tasks?.[0]?.id !== 'verify-task') {
      throw new Error('搭子状态保存结果异常');
    }

    const loaded = await request('/api/partner-state', { token });
    if (!loaded.exists || loaded.state?.version !== 'verify-partner-state') {
      throw new Error('搭子状态读取结果异常');
    }

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'partner state authenticated read',
        'partner state save',
        'partner state round-trip JSON payload',
      ],
    }, null, 2));
  } finally {
    if (before.exists && before.state) {
      await request('/api/partner-state', {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: before.state }),
      }).catch(() => {});
    } else {
      await request('/api/partner-state', {
        method: 'DELETE',
        token,
      }).catch(() => {});
    }
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
