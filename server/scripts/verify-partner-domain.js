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

const buildState = ({ includeMessage = true, includeNotification = true } = {}) => {
  const now = new Date().toISOString();
  return {
    version: 'verify-partner-domain',
    clientUpdatedAt: now,
    users: [],
    conversations: [{
      id: 'verify-conversation-domain',
      type: 'assistance',
      title: '搭子业务表同步验证',
      memberIds: ['user-zhang', 'user-liu'],
      taskId: 'verify-task-domain',
      unreadCount: 1,
      pinned: true,
      muted: false,
      archived: false,
      mentioned: true,
      lastReadAt: null,
      updatedAt: now,
    }],
    tasks: [{
      id: 'verify-task-domain',
      title: '搭子规范化协作任务',
      description: '验证搭子快照是否同步写入任务、会话、消息和通知业务表。',
      requesterId: 'user-zhang',
      memberIds: ['user-zhang', 'user-liu'],
      status: 'in_progress',
      priority: 'high',
      deadline: '2026-07-18 18:00',
      deadlineAt: '2026-07-18T10:00:00.000Z',
      skillTags: ['同步验证'],
      matchScope: 'section',
      publishedToPool: false,
      conversationId: 'verify-conversation-domain',
      participants: [{
        id: 'verify-participant-domain',
        userId: 'user-liu',
        role: 'required',
        responseStatus: 'accepted',
        active: true,
        invitedAt: now,
        respondedAt: now,
      }],
      subtasks: [{
        id: 'verify-subtask-domain',
        title: '确认规范化表写入',
        assigneeId: 'user-liu',
        status: 'completed',
        required: true,
        updatedAt: now,
      }],
      deliverables: [],
      poolApplications: [],
      changeRequests: [],
      createdAt: now,
      updatedAt: now,
    }],
    messages: includeMessage ? [{
      id: 'verify-message-domain',
      conversationId: 'verify-conversation-domain',
      senderId: 'user-zhang',
      type: 'text',
      body: '这条消息用于验证 partner_messages 表。',
      createdAt: now,
      readBy: ['user-zhang'],
    }] : [],
    notifications: includeNotification ? [{
      id: 'verify-notification-domain',
      type: 'partner_online_reminder',
      taskId: 'verify-task-domain',
      recipientIds: ['user-liu'],
      title: '搭子业务表通知验证',
      summary: '这条通知用于验证 partner_notifications 表。',
      status: 'sent',
      createdAt: now,
    }] : [],
  };
};

const requireItem = (items, id, label) => {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`${label} 未写入业务表: ${id}`);
  return item;
};

const main = async () => {
  const token = await login();
  const before = await request('/api/partner-state', { token });

  try {
    const members = await request('/api/partner-state/members', { token });
    if (!members.users?.some((item) => item.id === 'user-zhang') || !members.organization?.length) {
      throw new Error('搭子成员目录接口未返回种子成员和组织树');
    }
    if (!members.users?.some((item) => item.source === 'database')) {
      throw new Error('搭子成员目录接口未返回数据库用户');
    }

    const sectionMembers = await request(`/api/partner-state/members?section=${encodeURIComponent('采煤管理室')}`, { token });
    if (!sectionMembers.users?.length || sectionMembers.users.some((item) => item.section !== '采煤管理室')) {
      throw new Error('搭子成员目录科室过滤异常');
    }

    const searchedMembers = await request(`/api/partner-state/members?search=${encodeURIComponent('张三')}`, { token });
    if (!searchedMembers.users?.some((item) => item.id === 'user-zhang')) {
      throw new Error('搭子成员目录搜索异常');
    }

    await request('/api/partner-state', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: buildState() }),
    });

    const presenceTime = new Date().toISOString();
    const updatedPresence = await request('/api/partner-state/members/user-liu/presence', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presence: 'online',
        cameOnlineAt: presenceTime,
      }),
    });
    if (updatedPresence.member?.id !== 'user-liu' || updatedPresence.member?.presence !== 'online') {
      throw new Error('成员在线状态更新接口异常');
    }

    const onlineMembers = await request('/api/partner-state/members?presence=online', { token });
    if (!onlineMembers.users?.some((item) => item.id === 'user-liu')) {
      throw new Error('成员目录未叠加已保存在线状态');
    }

    const selfPresence = await request('/api/partner-state/members/user-zhang/presence', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presence: 'busy',
        self: true,
      }),
    });
    if (selfPresence.selfPresence !== 'busy' || selfPresence.member?.presence !== 'busy') {
      throw new Error('我的在线状态更新接口异常');
    }

    const domain = await request('/api/partner-state/domain', { token });
    const task = requireItem(domain.tasks, 'verify-task-domain', '协作任务');
    const conversation = requireItem(domain.conversations, 'verify-conversation-domain', '会话');
    const message = requireItem(domain.messages, 'verify-message-domain', '消息');
    const notification = requireItem(domain.notifications, 'verify-notification-domain', '通知');

    if (task.status !== 'in_progress' || task.priority !== 'high') {
      throw new Error('协作任务业务字段保存异常');
    }
    if (conversation.taskId !== 'verify-task-domain' || conversation.type !== 'assistance') {
      throw new Error('会话业务字段保存异常');
    }
    if (message.conversationId !== 'verify-conversation-domain' || message.body !== '这条消息用于验证 partner_messages 表。') {
      throw new Error('消息业务字段保存异常');
    }
    if (notification.taskId !== 'verify-task-domain' || notification.status !== 'sent') {
      throw new Error('通知业务字段保存异常');
    }

    const conversations = await request('/api/partner-state/conversations?type=assistance', { token });
    if (!conversations.conversations?.some((item) => item.id === 'verify-conversation-domain')) {
      throw new Error('会话列表接口未返回验证会话');
    }

    const tasks = await request('/api/partner-state/tasks?status=in_progress', { token });
    if (!tasks.tasks?.some((item) => item.id === 'verify-task-domain')) {
      throw new Error('任务列表接口未返回验证任务');
    }

    const notifications = await request('/api/partner-state/notifications?status=sent', { token });
    if (!notifications.notifications?.some((item) => item.id === 'verify-notification-domain')) {
      throw new Error('通知列表接口未返回验证通知');
    }

    const createdNotificationTime = new Date().toISOString();
    const createdNotifications = await request('/api/partner-state/notifications', {
      method: 'POST',
      expectedStatus: 201,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notifications: [{
          id: 'verify-created-notification-domain',
          type: 'partner_online_reminder',
          senderId: 'user-zhang',
          recipientId: 'user-liu',
          taskId: 'verify-task-domain',
          title: '通知接口创建验证',
          summary: '这条通知用于验证独立创建通知接口。',
          status: 'sent',
          sentAt: createdNotificationTime,
          openedAt: null,
          cameOnlineAt: null,
          nextAllowedAt: createdNotificationTime,
        }],
      }),
    });
    if (createdNotifications.notifications?.[0]?.id !== 'verify-created-notification-domain') {
      throw new Error('通知独立创建接口异常');
    }

    const retriedNotifications = await request('/api/partner-state/notifications', {
      method: 'POST',
      expectedStatus: 200,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notifications: [{
          id: 'verify-created-notification-domain',
          type: 'partner_online_reminder',
          senderId: 'user-zhang',
          recipientId: 'user-liu',
          taskId: 'verify-task-domain',
          title: '通知接口创建验证',
          summary: '这条通知用于验证独立创建通知接口。',
          status: 'sent',
          sentAt: createdNotificationTime,
        }],
      }),
    });
    if (retriedNotifications.notifications?.length !== 0) {
      throw new Error('通知独立创建接口未保持幂等');
    }

    const openedAt = new Date().toISOString();
    const openedNotification = await request('/api/partner-state/notifications/verify-created-notification-domain', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: {
          status: 'opened',
          openedAt,
        },
      }),
    });
    if (openedNotification.notification?.status !== 'opened' || openedNotification.notification?.openedAt !== openedAt) {
      throw new Error('通知打开状态更新接口异常');
    }

    const cameOnlineAt = new Date().toISOString();
    const onlineNotification = await request('/api/partner-state/notifications/verify-created-notification-domain', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: {
          status: 'came_online',
          cameOnlineAt,
        },
      }),
    });
    if (onlineNotification.notification?.status !== 'came_online' || onlineNotification.notification?.cameOnlineAt !== cameOnlineAt) {
      throw new Error('通知上线状态更新接口异常');
    }

    const updatedConversation = await request('/api/partner-state/conversations/verify-conversation-domain', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: {
          unreadCount: 0,
          pinned: false,
          draft: '后端独立更新草稿',
        },
      }),
    });
    if (updatedConversation.conversation?.unreadCount !== 0 || updatedConversation.conversation?.draft !== '后端独立更新草稿') {
      throw new Error('会话独立更新接口异常');
    }

    const createdConversationTime = new Date().toISOString();
    const createdConversation = await request('/api/partner-state/conversations', {
      method: 'POST',
      expectedStatus: 201,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation: {
          id: 'verify-created-conversation-direct',
          type: 'direct',
          title: '',
          memberIds: ['user-zhang', 'user-liu'],
          unreadCount: 0,
          pinned: false,
          muted: false,
          archived: false,
          mentioned: false,
          updatedAt: createdConversationTime,
        },
        messages: [{
          id: 'verify-created-conversation-message',
          senderId: 'system',
          type: 'system',
          body: '这条消息用于验证独立创建会话接口。',
          createdAt: createdConversationTime,
          readBy: ['user-zhang'],
        }],
      }),
    });
    if (!createdConversation.created || createdConversation.conversation?.id !== 'verify-created-conversation-direct') {
      throw new Error('会话独立创建接口异常');
    }

    const retriedConversation = await request('/api/partner-state/conversations', {
      method: 'POST',
      expectedStatus: 200,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation: {
          id: 'verify-created-conversation-direct',
          type: 'direct',
          title: '',
          memberIds: ['user-zhang', 'user-liu'],
          unreadCount: 0,
          updatedAt: createdConversationTime,
        },
        messages: [{
          id: 'verify-created-conversation-message',
          senderId: 'system',
          type: 'system',
          body: '这条消息用于验证独立创建会话接口。',
          createdAt: createdConversationTime,
          readBy: ['user-zhang'],
        }],
      }),
    });
    if (retriedConversation.created || retriedConversation.messages?.length !== 0) {
      throw new Error('会话独立创建接口未保持幂等');
    }

    const createdConversationMessages = await request('/api/partner-state/conversations/verify-created-conversation-direct/messages', { token });
    const createdMessageCount = (createdConversationMessages.messages || []).filter((item) => item.id === 'verify-created-conversation-message').length;
    if (createdMessageCount !== 1) {
      throw new Error('会话独立创建接口消息去重异常');
    }

    await request('/api/partner-state/conversations/verify-conversation-domain/messages', {
      method: 'POST',
      token,
      expectedStatus: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'verify-message-action',
        senderId: 'user-liu',
        type: 'text',
        body: '这条消息用于验证独立追加消息接口。',
        readBy: ['user-liu'],
      }),
    });

    const messages = await request('/api/partner-state/conversations/verify-conversation-domain/messages', { token });
    if (!messages.messages?.some((item) => item.id === 'verify-message-action')) {
      throw new Error('追加消息接口未写入业务表和快照');
    }

    const readResult = await request('/api/partner-state/conversations/verify-conversation-domain/read', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readerId: 'user-zhang',
      }),
    });
    if (readResult.conversation?.unreadCount !== 0 || readResult.updatedMessageCount < 1) {
      throw new Error('会话已读接口异常');
    }

    const readMessages = await request('/api/partner-state/conversations/verify-conversation-domain/messages', { token });
    const actionMessage = readMessages.messages?.find((item) => item.id === 'verify-message-action');
    if (!actionMessage?.readBy?.includes('user-zhang')) {
      throw new Error('会话已读接口未更新消息 readBy');
    }

    const taskPatchTime = new Date().toISOString();
    const updatedTask = await request('/api/partner-state/tasks/verify-task-domain', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: {
          status: 'awaiting_confirmation',
          updatedAt: taskPatchTime,
          activityLog: [{
            id: 'verify-activity-task-patch',
            type: 'acceptance',
            text: '任务接口已更新协作状态。',
            userId: 'user-zhang',
            createdAt: taskPatchTime,
          }],
        },
        conversationChanges: {
          updatedAt: taskPatchTime,
        },
        messages: [{
          id: 'verify-message-task-patch',
          senderId: 'system',
          type: 'system',
          body: '这条消息用于验证任务更新接口同步系统消息。',
          createdAt: taskPatchTime,
          readBy: ['user-zhang'],
        }],
      }),
    });
    if (updatedTask.task?.status !== 'awaiting_confirmation' || updatedTask.messages?.[0]?.id !== 'verify-message-task-patch') {
      throw new Error('任务独立更新接口异常');
    }

    const patchedTasks = await request('/api/partner-state/tasks?status=awaiting_confirmation', { token });
    if (!patchedTasks.tasks?.some((item) => item.id === 'verify-task-domain')) {
      throw new Error('任务独立更新接口未写入任务业务表');
    }

    const taskMessages = await request('/api/partner-state/conversations/verify-conversation-domain/messages', { token });
    if (!taskMessages.messages?.some((item) => item.id === 'verify-message-task-patch')) {
      throw new Error('任务独立更新接口未追加系统消息');
    }

    const createdTaskTime = new Date().toISOString();
    const createdTask = await request('/api/partner-state/tasks/verify-created-task-domain', {
      method: 'PATCH',
      expectedStatus: 201,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: {
          id: 'verify-created-task-domain',
          title: '任务接口新建协作',
          description: '验证任务接口可独立创建任务与会话。',
          requesterId: 'user-zhang',
          memberIds: ['user-zhang'],
          status: 'matching',
          priority: 'medium',
          deadline: '待协商',
          deadlineAt: null,
          skillTags: ['接口验证'],
          matchScope: 'section',
          publishedToPool: false,
          conversationId: 'verify-created-conversation-domain',
          participants: [],
          subtasks: [],
          deliverables: [],
          poolApplications: [],
          changeRequests: [],
          activityLog: [],
          matchingActivities: [],
          createdAt: createdTaskTime,
          updatedAt: createdTaskTime,
        },
        conversation: {
          id: 'verify-created-conversation-domain',
          type: 'assistance',
          title: '任务接口新建协作',
          memberIds: ['user-zhang'],
          taskId: 'verify-created-task-domain',
          unreadCount: 0,
          pinned: false,
          muted: false,
          archived: false,
          mentioned: false,
          updatedAt: createdTaskTime,
        },
        messages: [{
          id: 'verify-created-message-domain',
          senderId: 'system',
          type: 'task',
          body: '任务接口已创建新的协作会话。',
          createdAt: createdTaskTime,
          readBy: ['user-zhang'],
        }],
      }),
    });
    if (!createdTask.created || createdTask.task?.id !== 'verify-created-task-domain') {
      throw new Error('任务接口新建任务异常');
    }

    const createdDomain = await request('/api/partner-state/domain', { token });
    if (!createdDomain.tasks.some((item) => item.id === 'verify-created-task-domain')) {
      throw new Error('任务接口未写入新任务业务表');
    }
    if (!createdDomain.conversations.some((item) => item.id === 'verify-created-conversation-domain')) {
      throw new Error('任务接口未写入新会话业务表');
    }
    if (!createdDomain.messages.some((item) => item.id === 'verify-created-message-domain')) {
      throw new Error('任务接口未写入新会话消息业务表');
    }

    await request('/api/partner-state', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: buildState({ includeMessage: false, includeNotification: false }) }),
    });

    const trimmedDomain = await request('/api/partner-state/domain', { token });
    if (trimmedDomain.messages.some((item) => item.id === 'verify-message-domain')) {
      throw new Error('业务消息未按快照删除');
    }
    if (trimmedDomain.notifications.some((item) => item.id === 'verify-notification-domain')) {
      throw new Error('业务通知未按快照删除');
    }
    if (trimmedDomain.notifications.some((item) => item.id === 'verify-created-notification-domain')) {
      throw new Error('独立创建通知未按快照删除');
    }
    if (trimmedDomain.conversations.some((item) => item.id === 'verify-created-conversation-direct')) {
      throw new Error('业务会话未按快照删除');
    }

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'partner domain task persistence',
        'partner domain conversation persistence',
        'partner domain message persistence',
        'partner domain notification persistence',
        'partner member directory API',
        'partner member presence update API',
        'partner domain list APIs',
        'partner domain notification create API',
        'partner domain notification update API',
        'partner domain conversation create API',
        'partner domain conversation update API',
        'partner domain append message API',
        'partner domain mark read API',
        'partner domain task update API',
        'partner domain task upsert API',
        'partner domain stale row cleanup',
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
