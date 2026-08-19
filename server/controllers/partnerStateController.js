const { query, withTransaction } = require('../config/db');
const { getUserCompanyId, isPlatformAdmin } = require('../utils/resourceAccess');
const { sendServerError } = require('../utils/serverError');
const {
  deletePartnerDomainSnapshot,
  readPartnerDomainSnapshot,
  syncPartnerDomainSnapshot,
} = require('../utils/partnerDomainPersistence');

const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 100 * 1024;
const CURRENT_PARTNER_USER_ID = 'user-zhang';

const partnerDirectorySeedUsers = [
  { id: CURRENT_PARTNER_USER_ID, name: '张三', role: '采煤技术员', profession: '生产技术', section: '采煤管理室', presence: 'available', skills: ['采煤工艺', '规程编制', '现场协调'], color: '#1F7A83' },
  { id: 'user-liu', name: '刘晨', role: '采煤工程师', profession: '生产技术', section: '采煤管理室', presence: 'available', skills: ['工作面设计', '过断层', '支护参数'], color: '#2D8FB5' },
  { id: 'user-wang', name: '王磊', role: '生产调度员', profession: '生产技术', section: '采煤管理室', presence: 'online', skills: ['生产调度', '进度统筹', '现场联络'], color: '#3E7D6A' },
  { id: 'user-sun', name: '孙敏', role: '掘进技术员', profession: '生产技术', section: '开掘管理室', presence: 'busy', skills: ['掘进工艺', '巷道支护', '验收记录'], color: '#A56A3D' },
  { id: 'user-chen', name: '陈洁', role: '通风工程师', profession: '一通三防', section: '通风管理室', presence: 'available', skills: ['通风系统', '瓦斯治理', '专项措施'], color: '#B9812B' },
  { id: 'user-zhao', name: '赵强', role: '机电工程师', profession: '机电设备', section: '设备管理室', presence: 'online', skills: ['设备选型', '供电设计', '故障处理'], color: '#467A65' },
  { id: 'user-zhou', name: '周宁', role: '地测工程师', profession: '地测防治水', section: '地质测量室', presence: 'offline', skills: ['地质预报', '探放水', '图纸校核'], color: '#5C78A8' },
  { id: 'user-xu', name: '徐静', role: '安全监察员', profession: '安全监管', section: '安全监察室', presence: 'available', skills: ['风险辨识', '隐患闭环', '现场验收'], color: '#A45F78' },
  { id: 'user-gao', name: '高远', role: '规程审核员', profession: '生产技术', section: '技术管理室', presence: 'offline', skills: ['规程编制', '风险辨识', '会审组织'], color: '#6D6A9C' },
  { id: 'user-he', name: '何川', role: '防治水工程师', profession: '地测防治水', section: '防治水管理室', presence: 'offline', skills: ['探放水', '地质预报', '现场协调'], color: '#557C8A' },
];

const toUserId = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseStateJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const serializePartnerState = (row) => ({
  state: parseStateJson(row.state_json),
  clientUpdatedAt: row.client_updated_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const nowIso = () => new Date().toISOString();

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const getNormalizedClientUpdatedAt = (state) => {
  const clientUpdatedAt = state.clientUpdatedAt
    ? new Date(state.clientUpdatedAt)
    : null;
  return clientUpdatedAt && !Number.isNaN(clientUpdatedAt.getTime())
    ? clientUpdatedAt
    : null;
};

const persistPartnerState = async (connection, userId, state) => {
  const payload = JSON.stringify(state);
  if (Buffer.byteLength(payload, 'utf8') > MAX_STATE_BYTES) {
    throw createHttpError(413, '搭子状态数据过大，请清理历史记录后重试');
  }

  await connection.query(
    `INSERT INTO partner_states (user_id, state_json, client_updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       state_json = VALUES(state_json),
       client_updated_at = VALUES(client_updated_at),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, payload, getNormalizedClientUpdatedAt(state)]
  );
  await syncPartnerDomainSnapshot(connection, userId, state);
  const [rows] = await connection.query('SELECT * FROM partner_states WHERE user_id = ?', [userId]);
  return rows[0];
};

const loadMutablePartnerState = async (connection, userId) => {
  const [rows] = await connection.query('SELECT * FROM partner_states WHERE user_id = ? FOR UPDATE', [userId]);
  if (!rows[0]) throw createHttpError(404, '请先初始化搭子状态');
  const state = parseStateJson(rows[0].state_json);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw createHttpError(500, '搭子状态数据损坏');
  }
  return state;
};

const toInteger = (value, fallback, { min = 0, max = 500 } = {}) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const paginateItems = (items, req) => {
  const offset = toInteger(req.query.offset, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const limit = toInteger(req.query.limit, 100, { min: 1, max: 500 });
  return {
    total: items.length,
    offset,
    limit,
    items: items.slice(offset, offset + limit),
  };
};

const normalizeString = (value, fallback = '') => (
  value == null ? fallback : String(value)
);

const partnerPresenceValues = new Set(['available', 'online', 'busy', 'offline']);

const normalizePartnerPresence = (value, fallback = 'offline') => {
  const normalized = value == null ? '' : String(value).trim();
  return partnerPresenceValues.has(normalized) ? normalized : fallback;
};

const normalizeId = (value, fallback) => (
  normalizeString(value, fallback).slice(0, 100)
);

const assertArray = (value, fallback = []) => (
  Array.isArray(value) ? value : fallback
);

const getRequestBodyObject = (req) => (
  req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
);

const getPartnerDomain = async (userId) => readPartnerDomainSnapshot(query, userId);

const partnerDirectoryColors = ['#1F7A83', '#2D8FB5', '#3E7D6A', '#A56A3D', '#B9812B', '#467A65', '#5C78A8', '#A45F78', '#6D6A9C', '#557C8A'];

const inferPartnerRole = (user) => {
  const roleNames = assertArray(user.roles).map((role) => role.name).filter(Boolean);
  if (roleNames.includes('admin')) return '系统管理员';
  if (roleNames.includes('manager')) return '资料管理员';
  if (roleNames.includes('readonly')) return '资料查阅员';
  return `${user.section || user.department || '协作'}成员`;
};

const serializePartnerDirectoryUser = (user, index = 0) => ({
  id: user.id,
  name: normalizeString(user.name, '未命名成员'),
  role: normalizeString(user.role, inferPartnerRole(user)),
  profession: normalizeString(user.profession, user.department || '综合管理'),
  section: normalizeString(user.section, user.department || '未分配科室'),
  presence: normalizePartnerPresence(user.presence),
  skills: assertArray(user.skills, []),
  color: normalizeString(user.color, partnerDirectoryColors[index % partnerDirectoryColors.length]),
  source: normalizeString(user.source, 'seed'),
});

const serializeDbPartnerDirectoryUser = (user, index = 0) => serializePartnerDirectoryUser({
  id: `db-user-${user.id}`,
  name: user.name,
  profession: user.department,
  section: user.section,
  presence: user.id === Number(user.currentUserId) ? 'available' : 'offline',
  role: `${user.section || user.department || '协作'}成员`,
  skills: [user.department, user.section].filter(Boolean),
  color: partnerDirectoryColors[index % partnerDirectoryColors.length],
  source: 'database',
}, index);

const readPartnerDirectoryMember = async (connection, currentUserId, memberId, index = 0) => {
  const seedIndex = partnerDirectorySeedUsers.findIndex((user) => user.id === memberId);
  if (seedIndex !== -1) {
    return serializePartnerDirectoryUser(partnerDirectorySeedUsers[seedIndex], seedIndex);
  }

  const dbMatch = /^db-user-(\d+)$/.exec(memberId);
  if (!dbMatch) return null;

  const [rows] = await connection.query(
    `SELECT id, name, department, section, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [Number(dbMatch[1])]
  );
  return rows[0]
    ? serializeDbPartnerDirectoryUser({ ...rows[0], currentUserId }, partnerDirectorySeedUsers.length + index)
    : null;
};

const buildPartnerOrganization = (users) => {
  const tree = [];
  const professionMap = new Map();
  users.forEach((user) => {
    const professionName = user.profession || '综合管理';
    const sectionName = user.section || '未分配科室';
    if (!professionMap.has(professionName)) {
      const profession = { name: professionName, description: '', sections: [], subcategories: [] };
      professionMap.set(professionName, profession);
      tree.push(profession);
    }
    const profession = professionMap.get(professionName);
    let section = profession.sections.find((item) => item.name === sectionName);
    if (!section) {
      section = { name: sectionName, users: [] };
      profession.sections.push(section);
      profession.subcategories.push(sectionName);
    }
    section.users.push(user);
  });
  return tree;
};

const allowedConversationFields = new Set([
  'title',
  'memberIds',
  'unreadCount',
  'pinned',
  'muted',
  'archived',
  'draft',
  'mentioned',
  'lastReadAt',
  'updatedAt',
]);

const allowedConversationCreateFields = new Set([
  'id',
  'type',
  'taskId',
  ...allowedConversationFields,
]);

const allowedTaskFields = new Set([
  'title',
  'description',
  'requesterId',
  'memberIds',
  'participants',
  'status',
  'priority',
  'deadline',
  'deadlineAt',
  'deadlineReminderOffsets',
  'skillTags',
  'matchScope',
  'candidateIds',
  'publishedToPool',
  'activityLog',
  'matchingActivities',
  'linkedDocuments',
  'documentCollaboration',
  'conversationId',
  'subtasks',
  'deliverables',
  'poolApplications',
  'changeRequests',
  'overdueReminderSentAt',
  'createdAt',
  'updatedAt',
]);

const allowedNotificationFields = new Set([
  'id',
  'type',
  'senderId',
  'recipientId',
  'recipientIds',
  'taskId',
  'title',
  'summary',
  'deadline',
  'deadlineAt',
  'offsetMinutes',
  'skill',
  'status',
  'sentAt',
  'openedAt',
  'cameOnlineAt',
  'nextAllowedAt',
  'createdAt',
]);

const pickAllowedFields = (value, allowedFields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowedFields.has(key))
  );
};

const normalizeDateInput = (value, fallback = nowIso()) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const readPartnerPresenceOverlay = async (userId) => {
  const rows = await query('SELECT state_json FROM partner_states WHERE user_id = ?', [userId]);
  const state = parseStateJson(rows[0]?.state_json);
  const presenceById = new Map();

  assertArray(state?.users).forEach((user) => {
    if (!user?.id) return;
    const presence = normalizePartnerPresence(user.presence, null);
    if (!presence) return;
    presenceById.set(user.id, {
      presence,
      cameOnlineAt: normalizeDateInput(user.cameOnlineAt, null),
      presenceUpdatedAt: normalizeDateInput(user.presenceUpdatedAt, null),
    });
  });

  const selfPresence = normalizePartnerPresence(state?.selfPresence, null);
  if (selfPresence) {
    presenceById.set(CURRENT_PARTNER_USER_ID, {
      ...(presenceById.get(CURRENT_PARTNER_USER_ID) || {}),
      presence: selfPresence,
    });
  }

  return presenceById;
};

const applyPartnerPresenceOverlay = (user, presenceById) => {
  const saved = presenceById.get(user.id);
  if (!saved) return user;
  return {
    ...user,
    presence: saved.presence || user.presence,
    ...(saved.cameOnlineAt !== undefined ? { cameOnlineAt: saved.cameOnlineAt } : {}),
    ...(saved.presenceUpdatedAt !== undefined ? { presenceUpdatedAt: saved.presenceUpdatedAt } : {}),
  };
};

const createPartnerMessageFromPayload = (payload, conversationId, userId) => {
  const body = normalizeString(payload.body).trim();
  if (!body) throw createHttpError(400, '消息内容不能为空');
  if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) {
    throw createHttpError(413, '消息内容过长');
  }
  return {
    id: normalizeId(payload.id, `message-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    conversationId,
    senderId: normalizeId(payload.senderId, `user-${userId}`),
    type: normalizeString(payload.type, 'text').slice(0, 40),
    body,
    ...(payload.meta != null ? { meta: normalizeString(payload.meta).slice(0, 255) } : {}),
    createdAt: normalizeDateInput(payload.createdAt),
    readBy: assertArray(payload.readBy, []),
  };
};

const appendPartnerMessages = (messages, incomingMessages, conversationId, userId) => {
  const existingIds = new Set(messages.map((message) => message.id));
  const appended = [];
  const nextMessages = [...messages];

  assertArray(incomingMessages).forEach((payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const message = createPartnerMessageFromPayload(payload, conversationId, userId);
    if (existingIds.has(message.id)) return;
    existingIds.add(message.id);
    appended.push(message);
    nextMessages.push(message);
  });

  return { messages: nextMessages, appended };
};

const normalizePartnerConversationPayload = (payload, conversationId, existingConversation = {}) => {
  const safeConversation = pickAllowedFields(payload, allowedConversationCreateFields);
  const nextConversation = {
    ...existingConversation,
    ...safeConversation,
    id: conversationId,
    type: normalizeString(safeConversation.type, existingConversation.type || '').slice(0, 40),
    title: normalizeString(safeConversation.title, existingConversation.title || '').slice(0, 180),
    memberIds: assertArray(safeConversation.memberIds, existingConversation.memberIds || []),
    unreadCount: Math.max(0, toInteger(safeConversation.unreadCount, existingConversation.unreadCount || 0, { min: 0, max: 999 })),
    pinned: Boolean(safeConversation.pinned ?? existingConversation.pinned),
    muted: Boolean(safeConversation.muted ?? existingConversation.muted),
    archived: Boolean(safeConversation.archived ?? existingConversation.archived),
    draft: normalizeString(safeConversation.draft, existingConversation.draft || ''),
    mentioned: Boolean(safeConversation.mentioned ?? existingConversation.mentioned),
    lastReadAt: safeConversation.lastReadAt ?? existingConversation.lastReadAt ?? null,
    updatedAt: normalizeDateInput(safeConversation.updatedAt || existingConversation.updatedAt),
  };

  if (safeConversation.taskId != null || existingConversation.taskId != null) {
    nextConversation.taskId = normalizeId(safeConversation.taskId, existingConversation.taskId || '');
  }

  return nextConversation;
};

const normalizePartnerNotificationPayload = (payload, notificationId, existingNotification = {}) => {
  const safeNotification = pickAllowedFields(payload, allowedNotificationFields);
  const nextNotification = {
    ...existingNotification,
    ...safeNotification,
    id: notificationId,
    type: normalizeString(safeNotification.type, existingNotification.type || 'notification').slice(0, 80),
    title: normalizeString(safeNotification.title, existingNotification.title || '').slice(0, 255),
    summary: normalizeString(safeNotification.summary, existingNotification.summary || ''),
    status: normalizeString(safeNotification.status, existingNotification.status || 'sent').slice(0, 60),
  };

  if (safeNotification.senderId != null || existingNotification.senderId != null) {
    nextNotification.senderId = normalizeId(safeNotification.senderId, existingNotification.senderId || '');
  }
  if (safeNotification.recipientId != null || existingNotification.recipientId != null) {
    nextNotification.recipientId = normalizeId(safeNotification.recipientId, existingNotification.recipientId || '');
  }
  if (safeNotification.taskId != null || existingNotification.taskId != null) {
    nextNotification.taskId = normalizeId(safeNotification.taskId, existingNotification.taskId || '');
  }
  if (safeNotification.recipientIds != null || existingNotification.recipientIds != null) {
    nextNotification.recipientIds = assertArray(safeNotification.recipientIds, existingNotification.recipientIds || []);
  }

  return nextNotification;
};

const getPartnerState = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const rows = await query('SELECT * FROM partner_states WHERE user_id = ?', [userId]);
    if (!rows[0]) {
      return res.json({
        exists: false,
        state: null,
      });
    }

    return res.json({
      exists: true,
      ...serializePartnerState(rows[0]),
    });
  } catch (err) {
    return sendServerError(res, err, '获取搭子状态失败');
  }
};

const getPartnerDomainState = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const domain = await readPartnerDomainSnapshot(query, userId);
    return res.json({
      exists: domain.conversations.length > 0
        || domain.tasks.length > 0
        || domain.messages.length > 0
        || domain.notifications.length > 0,
      ...domain,
    });
  } catch (err) {
    return sendServerError(res, err, '获取搭子业务数据失败');
  }
};

const getPartnerMembers = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const companyId = getUserCompanyId(req.user);
    // 真实用户按公司隔离；无 company_id 且非平台超管时查不到任何真实用户
    const dbUsers = (companyId || isPlatformAdmin(req.user))
      ? await query(
        `SELECT id, name, department, section, created_at, updated_at
         FROM users
         ${companyId ? 'WHERE company_id = ?' : ''}
         ORDER BY created_at ASC, id ASC`,
        companyId ? [companyId] : []
      )
      : [];
    const seedUsers = partnerDirectorySeedUsers.map((user, index) => serializePartnerDirectoryUser(user, index));
    const dbDirectoryUsers = dbUsers.map((user, index) => serializeDbPartnerDirectoryUser({
      ...user,
      currentUserId: userId,
    }, seedUsers.length + index));
    const presenceById = await readPartnerPresenceOverlay(userId);

    const usersById = new Map();
    [...seedUsers, ...dbDirectoryUsers].forEach((user) => {
      if (!usersById.has(user.id)) usersById.set(user.id, applyPartnerPresenceOverlay(user, presenceById));
    });

    let users = [...usersById.values()];
    if (req.query.profession) {
      users = users.filter((user) => user.profession === req.query.profession);
    }
    if (req.query.section) {
      users = users.filter((user) => user.section === req.query.section);
    }
    if (req.query.presence) {
      users = users.filter((user) => user.presence === req.query.presence);
    }
    if (req.query.search) {
      const keyword = String(req.query.search).trim().toLowerCase();
      if (keyword) {
        users = users.filter((user) => (
          `${user.name} ${user.role} ${user.profession} ${user.section} ${user.skills.join(' ')}`
            .toLowerCase()
            .includes(keyword)
        ));
      }
    }

    return res.json({
      users,
      organization: buildPartnerOrganization(users),
      currentUserId: CURRENT_PARTNER_USER_ID,
      databaseUserId: `db-user-${userId}`,
      source: dbDirectoryUsers.length ? 'database+seed' : 'seed',
      total: users.length,
    });
  } catch (err) {
    console.error('获取搭子成员目录失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '获取搭子成员目录失败' });
  }
};

const updatePartnerMemberPresence = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const memberId = normalizeId(req.params.memberId, '');
    if (!memberId) return res.status(400).json({ message: '成员缺少 id' });

    const body = getRequestBodyObject(req);
    const presence = normalizePartnerPresence(body.presence, null);
    if (!presence) return res.status(400).json({ message: '成员在线状态不正确' });

    const saved = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const users = assertArray(state.users);
      const index = users.findIndex((user) => user?.id === memberId);
      const directoryMember = index === -1
        ? await readPartnerDirectoryMember(connection, userId, memberId, users.length)
        : null;
      if (index === -1 && !directoryMember) throw createHttpError(404, '成员不存在');

      const existingUser = index === -1 ? directoryMember : users[index];
      const updatedAt = normalizeDateInput(body.presenceUpdatedAt, nowIso());
      let cameOnlineAt = existingUser.cameOnlineAt || null;
      if (Object.prototype.hasOwnProperty.call(body, 'cameOnlineAt')) {
        cameOnlineAt = normalizeDateInput(body.cameOnlineAt, presence === 'offline' ? null : updatedAt);
      } else if (presence === 'offline') {
        cameOnlineAt = null;
      } else if (presence === 'online') {
        cameOnlineAt = updatedAt;
      }

      const member = {
        ...existingUser,
        presence,
        cameOnlineAt,
        presenceUpdatedAt: updatedAt,
      };
      const nextUsers = index === -1
        ? [...users, member]
        : users.map((user, itemIndex) => (itemIndex === index ? member : user));
      const isSelf = memberId === CURRENT_PARTNER_USER_ID || body.self === true || body.isSelf === true;
      const nextState = {
        ...state,
        clientUpdatedAt: updatedAt,
        users: nextUsers,
        ...(isSelf ? { selfPresence: presence } : {}),
      };

      await persistPartnerState(connection, userId, nextState);
      return {
        member,
        selfPresence: nextState.selfPresence,
      };
    });

    return res.json({
      message: '成员在线状态已更新',
      ...saved,
    });
  } catch (err) {
    console.error('更新搭子成员在线状态失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '更新搭子成员在线状态失败' });
  }
};

const getPartnerConversations = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const domain = await getPartnerDomain(userId);
    let conversations = domain.conversations;
    if (req.query.type) {
      conversations = conversations.filter((conversation) => conversation.type === req.query.type);
    }
    if (req.query.archived != null) {
      const archived = req.query.archived === 'true';
      conversations = conversations.filter((conversation) => Boolean(conversation.archived) === archived);
    }

    return res.json({
      ...paginateItems(conversations, req),
      conversations: paginateItems(conversations, req).items,
    });
  } catch (err) {
    console.error('获取搭子会话失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '获取搭子会话失败' });
  }
};

const getPartnerTasks = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const domain = await getPartnerDomain(userId);
    let tasks = domain.tasks;
    if (req.query.status) {
      const statuses = String(req.query.status).split(',').map((item) => item.trim()).filter(Boolean);
      tasks = tasks.filter((task) => statuses.includes(task.status));
    }
    if (req.query.conversationId) {
      tasks = tasks.filter((task) => task.conversationId === req.query.conversationId);
    }

    return res.json({
      ...paginateItems(tasks, req),
      tasks: paginateItems(tasks, req).items,
    });
  } catch (err) {
    console.error('获取搭子任务失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '获取搭子任务失败' });
  }
};

const getPartnerNotifications = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const domain = await getPartnerDomain(userId);
    let notifications = domain.notifications;
    if (req.query.status) {
      notifications = notifications.filter((notification) => notification.status === req.query.status);
    }
    if (req.query.taskId) {
      notifications = notifications.filter((notification) => notification.taskId === req.query.taskId);
    }

    return res.json({
      ...paginateItems(notifications, req),
      notifications: paginateItems(notifications, req).items,
    });
  } catch (err) {
    console.error('获取搭子通知失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '获取搭子通知失败' });
  }
};

const createPartnerNotifications = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const body = getRequestBodyObject(req);
    const payloads = Array.isArray(body.notifications)
      ? body.notifications
      : [body.notification && typeof body.notification === 'object' ? body.notification : body];
    const validPayloads = payloads.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (!validPayloads.length) return res.status(400).json({ message: '通知数据不能为空' });

    const result = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const notifications = assertArray(state.notifications);
      const existingIds = new Set(notifications.map((notification) => notification.id));
      const created = [];

      validPayloads.forEach((payload, index) => {
        const notificationId = normalizeId(payload.id, `notification-${Date.now()}-${index}`);
        if (existingIds.has(notificationId)) return;
        existingIds.add(notificationId);
        created.push(normalizePartnerNotificationPayload(payload, notificationId));
      });

      const nextState = {
        ...state,
        clientUpdatedAt: nowIso(),
        notifications: [...created, ...notifications],
      };
      await persistPartnerState(connection, userId, nextState);
      return { notifications: created };
    });

    return res.status(result.notifications.length ? 201 : 200).json({
      message: result.notifications.length ? '通知已创建' : '通知已存在',
      ...result,
    });
  } catch (err) {
    console.error('创建搭子通知失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '创建搭子通知失败' });
  }
};

const updatePartnerNotification = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const notificationId = normalizeId(req.params.notificationId, '');
    const body = getRequestBodyObject(req);
    const changes = body.changes && typeof body.changes === 'object' && !Array.isArray(body.changes)
      ? body.changes
      : body;
    const safeChanges = pickAllowedFields(changes, allowedNotificationFields);
    if (Object.keys(safeChanges).length === 0) {
      return res.status(400).json({ message: '没有可更新的通知字段' });
    }

    const notification = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const notifications = assertArray(state.notifications);
      const index = notifications.findIndex((item) => item.id === notificationId);
      if (index === -1) throw createHttpError(404, '通知不存在');

      const nextNotification = normalizePartnerNotificationPayload(
        { ...notifications[index], ...safeChanges },
        notificationId,
        notifications[index]
      );
      const nextState = {
        ...state,
        clientUpdatedAt: nowIso(),
        notifications: notifications.map((item, itemIndex) => (
          itemIndex === index ? nextNotification : item
        )),
      };
      await persistPartnerState(connection, userId, nextState);
      return nextNotification;
    });

    return res.json({
      message: '通知已更新',
      notification,
    });
  } catch (err) {
    console.error('更新搭子通知失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '更新搭子通知失败' });
  }
};

const getPartnerConversationMessages = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const conversationId = normalizeId(req.params.conversationId, '');
    const domain = await getPartnerDomain(userId);
    const conversation = domain.conversations.find((item) => item.id === conversationId);
    if (!conversation) return res.status(404).json({ message: '会话不存在' });

    const messages = domain.messages.filter((message) => message.conversationId === conversationId);
    return res.json({
      conversation,
      ...paginateItems(messages, req),
      messages: paginateItems(messages, req).items,
    });
  } catch (err) {
    console.error('获取搭子会话消息失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '获取搭子会话消息失败' });
  }
};

const createPartnerConversation = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const body = getRequestBodyObject(req);
    const conversationPayload = body.conversation && typeof body.conversation === 'object' && !Array.isArray(body.conversation)
      ? body.conversation
      : body;
    const conversationId = normalizeId(conversationPayload.id, '');
    if (!conversationId) return res.status(400).json({ message: '会话缺少 id' });

    const incomingMessages = assertArray(body.messages, []);
    const result = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const conversations = assertArray(state.conversations);
      const messages = assertArray(state.messages);
      const conversationIndex = conversations.findIndex((conversation) => conversation.id === conversationId);
      const existingConversation = conversationIndex === -1 ? {} : conversations[conversationIndex];
      const conversation = normalizePartnerConversationPayload(conversationPayload, conversationId, existingConversation);

      if (!conversation.type) throw createHttpError(400, '会话缺少类型');

      const nextConversations = conversationIndex === -1
        ? [conversation, ...conversations]
        : conversations.map((item, index) => (index === conversationIndex ? conversation : item));
      const { messages: nextMessages, appended } = appendPartnerMessages(messages, incomingMessages, conversationId, userId);
      const nextState = {
        ...state,
        clientUpdatedAt: nowIso(),
        conversations: nextConversations,
        messages: nextMessages,
      };
      await persistPartnerState(connection, userId, nextState);
      return {
        conversation,
        messages: appended,
        created: conversationIndex === -1,
      };
    });

    return res.status(result.created ? 201 : 200).json({
      message: result.created ? '会话已创建' : '会话已更新',
      ...result,
    });
  } catch (err) {
    console.error('创建搭子会话失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '创建搭子会话失败' });
  }
};

const updatePartnerConversation = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const conversationId = normalizeId(req.params.conversationId, '');
    const body = getRequestBodyObject(req);
    const changes = body.changes && typeof body.changes === 'object' && !Array.isArray(body.changes)
      ? body.changes
      : body;
    const safeChanges = pickAllowedFields(changes, allowedConversationFields);
    if (Object.keys(safeChanges).length === 0) {
      return res.status(400).json({ message: '没有可更新的会话字段' });
    }
    const shouldTouchUpdatedAt = Boolean(
      body.updatedAt
      || Object.keys(safeChanges).some((key) => key !== 'draft' && key !== 'lastReadAt')
    );

    const savedRow = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const conversations = assertArray(state.conversations);
      const index = conversations.findIndex((conversation) => conversation.id === conversationId);
      if (index === -1) throw createHttpError(404, '会话不存在');

      const nextConversation = {
        ...conversations[index],
        ...safeChanges,
        memberIds: safeChanges.memberIds ? assertArray(safeChanges.memberIds, conversations[index].memberIds || []) : conversations[index].memberIds,
        ...(shouldTouchUpdatedAt ? { updatedAt: body.updatedAt || nowIso() } : {}),
      };
      const nextState = {
        ...state,
        clientUpdatedAt: nowIso(),
        conversations: conversations.map((conversation, itemIndex) => (
          itemIndex === index ? nextConversation : conversation
        )),
      };
      await persistPartnerState(connection, userId, nextState);
      return nextConversation;
    });

    return res.json({
      message: '会话已更新',
      conversation: savedRow,
    });
  } catch (err) {
    console.error('更新搭子会话失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '更新搭子会话失败' });
  }
};

const appendPartnerMessage = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const conversationId = normalizeId(req.params.conversationId, '');
    const body = getRequestBodyObject(req);
    const text = normalizeString(body.body).trim();
    if (!text) return res.status(400).json({ message: '消息内容不能为空' });
    if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
      return res.status(413).json({ message: '消息内容过长' });
    }

    const now = body.createdAt ? new Date(body.createdAt) : new Date();
    const createdAt = Number.isNaN(now.getTime()) ? nowIso() : now.toISOString();
    const messageId = normalizeId(body.id, `message-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

    const savedMessage = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const conversations = assertArray(state.conversations);
      const conversationIndex = conversations.findIndex((conversation) => conversation.id === conversationId);
      if (conversationIndex === -1) throw createHttpError(404, '会话不存在');

      const messages = assertArray(state.messages);
      const existingMessage = messages.find((message) => message.id === messageId);
      if (existingMessage) return existingMessage;

      const message = {
        id: messageId,
        conversationId,
        senderId: normalizeId(body.senderId, `user-${userId}`),
        type: normalizeString(body.type, 'text').slice(0, 40),
        body: text,
        ...(body.meta != null ? { meta: normalizeString(body.meta).slice(0, 255) } : {}),
        createdAt,
        readBy: assertArray(body.readBy, []),
      };

      const nextConversations = conversations.map((conversation, index) => (
        index === conversationIndex
          ? { ...conversation, updatedAt: createdAt, draft: body.clearDraft === false ? conversation.draft : '' }
          : conversation
      ));
      const nextState = {
        ...state,
        clientUpdatedAt: nowIso(),
        conversations: nextConversations,
        messages: [...messages, message],
      };
      await persistPartnerState(connection, userId, nextState);
      return message;
    });

    return res.status(201).json({
      message: '消息已保存',
      item: savedMessage,
    });
  } catch (err) {
    console.error('追加搭子消息失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '追加搭子消息失败' });
  }
};

const markPartnerConversationRead = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const conversationId = normalizeId(req.params.conversationId, '');
    const body = getRequestBodyObject(req);
    const readerId = normalizeId(body.readerId, `user-${userId}`);
    const now = body.readAt ? new Date(body.readAt) : new Date();
    const readAt = Number.isNaN(now.getTime()) ? nowIso() : now.toISOString();

    const result = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const conversations = assertArray(state.conversations);
      const conversationIndex = conversations.findIndex((conversation) => conversation.id === conversationId);
      if (conversationIndex === -1) throw createHttpError(404, '会话不存在');

      let updatedMessageCount = 0;
      const messages = assertArray(state.messages).map((message) => {
        if (message.conversationId !== conversationId) return message;
        const readBy = assertArray(message.readBy);
        if (readBy.includes(readerId)) return message;
        updatedMessageCount += 1;
        return {
          ...message,
          readBy: [...readBy, readerId],
        };
      });

      const conversation = {
        ...conversations[conversationIndex],
        unreadCount: 0,
        mentioned: false,
        lastReadAt: readAt,
        updatedAt: conversations[conversationIndex].updatedAt || readAt,
      };
      const nextState = {
        ...state,
        clientUpdatedAt: nowIso(),
        conversations: conversations.map((item, index) => (
          index === conversationIndex ? conversation : item
        )),
        messages,
      };
      await persistPartnerState(connection, userId, nextState);
      return { conversation, updatedMessageCount };
    });

    return res.json({
      message: '会话已标记为已读',
      ...result,
    });
  } catch (err) {
    console.error('标记搭子会话已读失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '标记搭子会话已读失败' });
  }
};

const updatePartnerTask = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const taskId = normalizeId(req.params.taskId, '');
    const body = getRequestBodyObject(req);
    const taskPayload = body.task && typeof body.task === 'object' && !Array.isArray(body.task)
      ? body.task
      : null;
    const changes = body.changes && typeof body.changes === 'object' && !Array.isArray(body.changes)
      ? body.changes
      : null;
    const conversationPayload = body.conversation && typeof body.conversation === 'object' && !Array.isArray(body.conversation)
      ? body.conversation
      : null;
    const conversationChanges = body.conversationChanges && typeof body.conversationChanges === 'object' && !Array.isArray(body.conversationChanges)
      ? body.conversationChanges
      : null;
    const incomingMessages = assertArray(body.messages, []);

    if (!taskPayload && !changes && !conversationPayload && !conversationChanges && incomingMessages.length === 0) {
      return res.status(400).json({ message: '没有可更新的任务字段' });
    }

    const result = await withTransaction(async (connection) => {
      const state = await loadMutablePartnerState(connection, userId);
      const tasks = assertArray(state.tasks);
      const conversations = assertArray(state.conversations);
      const messages = assertArray(state.messages);
      const taskIndex = tasks.findIndex((task) => task.id === taskId);

      if (taskIndex === -1 && !taskPayload) throw createHttpError(404, '任务不存在');

      const existingTask = taskIndex === -1 ? {} : tasks[taskIndex];
      const safeTaskChanges = taskPayload
        ? { ...taskPayload, id: taskId }
        : pickAllowedFields(changes, allowedTaskFields);
      const nextTask = {
        ...existingTask,
        ...safeTaskChanges,
        id: taskId,
        updatedAt: safeTaskChanges.updatedAt || nowIso(),
      };
      const conversationId = normalizeId(
        nextTask.conversationId || conversationPayload?.id || conversationChanges?.id,
        ''
      );
      if (incomingMessages.length > 0 && !conversationId) {
        throw createHttpError(400, '任务消息缺少关联会话');
      }

      let nextConversations = conversations;
      let savedConversation = null;
      if (conversationPayload || conversationChanges) {
        if (!conversationId) throw createHttpError(400, '任务缺少关联会话');
        const conversationIndex = conversations.findIndex((conversation) => conversation.id === conversationId);
        const existingConversation = conversationIndex === -1 ? {} : conversations[conversationIndex];
        const safeConversationChanges = conversationPayload
          ? { ...conversationPayload, id: conversationId }
          : pickAllowedFields(conversationChanges, allowedConversationFields);
        savedConversation = {
          ...existingConversation,
          ...safeConversationChanges,
          id: conversationId,
          updatedAt: safeConversationChanges.updatedAt || nowIso(),
        };
        nextConversations = conversationIndex === -1
          ? [savedConversation, ...conversations]
          : conversations.map((conversation, index) => (
            index === conversationIndex ? savedConversation : conversation
          ));
      } else if (conversationId) {
        savedConversation = conversations.find((conversation) => conversation.id === conversationId) || null;
      }

      const { messages: nextMessages, appended } = conversationId
        ? appendPartnerMessages(messages, incomingMessages, conversationId, userId)
        : { messages, appended: [] };

      const nextTasks = taskIndex === -1
        ? [nextTask, ...tasks]
        : tasks.map((task, index) => (index === taskIndex ? nextTask : task));

      const nextState = {
        ...state,
        clientUpdatedAt: nowIso(),
        tasks: nextTasks,
        conversations: nextConversations,
        messages: nextMessages,
      };
      await persistPartnerState(connection, userId, nextState);
      return {
        task: nextTask,
        conversation: savedConversation,
        messages: appended,
        created: taskIndex === -1,
      };
    });

    return res.status(result.created ? 201 : 200).json({
      message: result.created ? '任务已创建' : '任务已更新',
      ...result,
    });
  } catch (err) {
    console.error('更新搭子任务失败:', err);
    return res.status(err.status || 500).json({ message: err.message || '更新搭子任务失败' });
  }
};

const savePartnerState = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    const state = req.body?.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ message: '搭子状态数据不正确' });
    }

    const savedRow = await withTransaction(async (connection) => {
      return persistPartnerState(connection, userId, state);
    });

    return res.json({
      message: '搭子状态已保存',
      exists: true,
      ...serializePartnerState(savedRow),
    });
  } catch (err) {
    return sendServerError(res, err, '保存搭子状态失败');
  }
};

const deletePartnerState = async (req, res) => {
  try {
    const userId = toUserId(req.user?.id);
    if (!userId) return res.status(401).json({ message: '未认证的用户' });

    await withTransaction(async (connection) => {
      await deletePartnerDomainSnapshot(connection, userId);
      await connection.query('DELETE FROM partner_states WHERE user_id = ?', [userId]);
    });
    return res.json({
      message: '搭子状态已清除',
      exists: false,
      state: null,
    });
  } catch (err) {
    return sendServerError(res, err, '清除搭子状态失败');
  }
};

module.exports = {
  getPartnerState,
  getPartnerDomainState,
  getPartnerMembers,
  updatePartnerMemberPresence,
  getPartnerConversations,
  getPartnerTasks,
  getPartnerNotifications,
  createPartnerNotifications,
  updatePartnerNotification,
  getPartnerConversationMessages,
  createPartnerConversation,
  updatePartnerConversation,
  appendPartnerMessage,
  markPartnerConversationRead,
  updatePartnerTask,
  savePartnerState,
  deletePartnerState,
};
