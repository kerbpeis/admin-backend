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

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const nowIso = () => new Date().toISOString();

const buildInitialState = () => {
  const now = nowIso();
  return {
    version: 'verify-partner-flow',
    clientUpdatedAt: now,
    users: [],
    conversations: [],
    messages: [],
    tasks: [],
    notifications: [],
  };
};

const buildTaskPayload = (createdAt) => ({
  task: {
    id: 'verify-flow-task',
    title: '围绕"综采工作面过断层专项措施"开展协作',
    description: '核对资料适用条件、关键要求和现场执行事项，形成可归档的协作成果。',
    requesterId: 'user-zhang',
    memberIds: ['user-zhang', 'user-liu'],
    participants: [
      {
        id: 'verify-flow-participant-requester',
        userId: 'user-zhang',
        role: 'requester',
        responseStatus: 'accepted',
        active: true,
        invitedAt: createdAt,
        respondedAt: createdAt,
      },
      {
        id: 'verify-flow-participant-liu',
        userId: 'user-liu',
        role: 'required',
        responseStatus: 'accepted',
        active: true,
        invitedAt: createdAt,
        respondedAt: createdAt,
      },
    ],
    status: 'in_progress',
    priority: 'high',
    deadline: '明天 18:00',
    deadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    deadlineReminderOffsets: [1440, 120],
    skillTags: ['过断层', '规程编制', '现场执行'],
    matchScope: 'section',
    candidateIds: ['user-liu'],
    publishedToPool: false,
    linkedDocuments: [{
      id: 'verify-flow-document',
      title: '综采工作面过断层专项措施',
      version: 'V1',
      profession: '生产技术',
      section: '采煤管理室',
    }],
    documentCollaboration: {
      type: 'measure',
      documentTitle: '综采工作面过断层专项措施',
      roleBlueprint: ['编制', '复核', '现场确认'],
    },
    conversationId: 'verify-flow-conversation',
    subtasks: [
      {
        id: 'verify-flow-subtask-review',
        title: '核对资料适用条件',
        assigneeId: 'user-liu',
        required: true,
        status: 'todo',
        deadline: '明天 18:00',
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'verify-flow-subtask-deliverable',
        title: '提交协作成果',
        assigneeId: 'user-zhang',
        required: true,
        status: 'todo',
        deadline: '明天 18:00',
        createdAt,
        updatedAt: createdAt,
      },
    ],
    deliverables: [],
    poolApplications: [],
    changeRequests: [],
    activityLog: [{
      id: 'verify-flow-activity-created',
      type: 'task_create',
      text: '从资料详情发起协作。',
      userId: 'user-zhang',
      createdAt,
    }],
    matchingActivities: [],
    createdAt,
    updatedAt: createdAt,
  },
  conversation: {
    id: 'verify-flow-conversation',
    type: 'assistance',
    title: '综采工作面过断层专项措施协作',
    taskId: 'verify-flow-task',
    memberIds: ['user-zhang', 'user-liu'],
    unreadCount: 1,
    pinned: false,
    muted: false,
    archived: false,
    mentioned: true,
    lastReadAt: null,
    updatedAt: createdAt,
  },
  messages: [{
    id: 'verify-flow-message-created',
    conversationId: 'verify-flow-conversation',
    senderId: 'system',
    type: 'task',
    body: '工作协助已发起：围绕资料开展协作。',
    createdAt,
    readBy: ['user-zhang'],
  }],
});

const main = async () => {
  const token = await login();
  const before = await request('/api/partner-state', { token });

  try {
    await request('/api/partner-state', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: buildInitialState() }),
    });

    const members = await request('/api/partner-state/members?section=%E9%87%87%E7%85%A4%E7%AE%A1%E7%90%86%E5%AE%A4', { token });
    assert(members.users?.some((item) => item.id === 'user-liu'), '搭子成员目录未返回协作对象');

    const createdAt = nowIso();
    const createdTask = await request('/api/partner-state/tasks/verify-flow-task', {
      method: 'PATCH',
      expectedStatus: 201,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTaskPayload(createdAt)),
    });
    assert(createdTask.created && createdTask.task?.id === 'verify-flow-task', '资料协作任务创建失败');
    assert(createdTask.conversation?.id === 'verify-flow-conversation', '资料协作会话创建失败');
    assert(createdTask.messages?.[0]?.id === 'verify-flow-message-created', '资料协作系统消息未创建');

    const notifications = await request('/api/partner-state/notifications', {
      method: 'POST',
      expectedStatus: 201,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notifications: [{
          id: 'verify-flow-notification-invite',
          type: 'assistance_invite',
          senderId: 'user-zhang',
          recipientId: 'user-liu',
          recipientIds: ['user-liu'],
          taskId: 'verify-flow-task',
          title: '新的资料协作邀请',
          summary: '请参与综采工作面过断层专项措施协作。',
          status: 'sent',
          sentAt: createdAt,
          createdAt,
        }],
      }),
    });
    assert(notifications.notifications?.[0]?.id === 'verify-flow-notification-invite', '协作邀请通知创建失败');

    const chatMessage = await request('/api/partner-state/conversations/verify-flow-conversation/messages', {
      method: 'POST',
      expectedStatus: 201,
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'verify-flow-message-chat',
        senderId: 'user-zhang',
        type: 'text',
        body: '请先核对资料适用条件，再补充现场执行清单。',
        readBy: ['user-zhang'],
      }),
    });
    assert(chatMessage.item?.id === 'verify-flow-message-chat', '协作会话消息追加失败');

    const openedAt = nowIso();
    const openedNotification = await request('/api/partner-state/notifications/verify-flow-notification-invite', {
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
    assert(openedNotification.notification?.status === 'opened', '协作通知打开状态更新失败');

    const readAt = nowIso();
    const readResult = await request('/api/partner-state/conversations/verify-flow-conversation/read', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readerId: 'user-zhang',
        readAt,
      }),
    });
    assert(readResult.conversation?.unreadCount === 0, '协作会话已读状态更新失败');

    const submittedAt = nowIso();
    const submittedTask = await request('/api/partner-state/tasks/verify-flow-task', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: {
          status: 'awaiting_confirmation',
          subtasks: [
            {
              id: 'verify-flow-subtask-review',
              title: '核对资料适用条件',
              assigneeId: 'user-liu',
              required: true,
              status: 'completed',
              deadline: '明天 18:00',
              updatedAt: submittedAt,
            },
            {
              id: 'verify-flow-subtask-deliverable',
              title: '提交协作成果',
              assigneeId: 'user-zhang',
              required: true,
              status: 'completed',
              deadline: '明天 18:00',
              updatedAt: submittedAt,
              deliverableIds: ['verify-flow-deliverable'],
            },
          ],
          deliverables: [{
            id: 'verify-flow-deliverable',
            name: '过断层专项措施协作成果.md',
            type: 'document',
            uploadedBy: 'user-zhang',
            createdAt: submittedAt,
          }],
          activityLog: [
            {
              id: 'verify-flow-activity-submit',
              type: 'acceptance',
              text: '协作成果已提交验收。',
              userId: 'user-zhang',
              createdAt: submittedAt,
            },
          ],
          updatedAt: submittedAt,
        },
        conversationChanges: {
          updatedAt: submittedAt,
        },
        messages: [{
          id: 'verify-flow-message-submit',
          senderId: 'system',
          type: 'system',
          body: '协作成果已提交，等待负责人确认。',
          createdAt: submittedAt,
          readBy: ['user-zhang'],
        }],
      }),
    });
    assert(submittedTask.task?.status === 'awaiting_confirmation', '协作成果提交状态更新失败');
    assert(submittedTask.messages?.[0]?.id === 'verify-flow-message-submit', '协作成果提交系统消息未追加');

    const completedAt = nowIso();
    const completedTask = await request('/api/partner-state/tasks/verify-flow-task', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: {
          status: 'completed',
          activityLog: [
            {
              id: 'verify-flow-activity-completed',
              type: 'acceptance',
              text: '协作已验收完成并归档。',
              userId: 'user-zhang',
              createdAt: completedAt,
            },
          ],
          updatedAt: completedAt,
        },
        conversationChanges: {
          archived: true,
          updatedAt: completedAt,
        },
        messages: [{
          id: 'verify-flow-message-completed',
          senderId: 'system',
          type: 'system',
          body: '协作已完成并归档。',
          createdAt: completedAt,
          readBy: ['user-zhang'],
        }],
      }),
    });
    assert(completedTask.task?.status === 'completed', '协作验收完成状态更新失败');

    const domain = await request('/api/partner-state/domain', { token });
    const domainTask = domain.tasks?.find((item) => item.id === 'verify-flow-task');
    const domainConversation = domain.conversations?.find((item) => item.id === 'verify-flow-conversation');
    const domainNotification = domain.notifications?.find((item) => item.id === 'verify-flow-notification-invite');
    const domainMessages = (domain.messages || []).filter((item) => item.conversationId === 'verify-flow-conversation');
    const domainChatMessage = domainMessages.find((item) => item.id === 'verify-flow-message-chat');

    assert(domainTask?.status === 'completed', '领域快照未保存完成后的协作任务');
    assert(domainTask?.linkedDocuments?.[0]?.id === 'verify-flow-document', '领域快照未保留资料关联');
    assert(domainConversation?.archived === true, '领域快照未保存归档会话');
    assert(domainNotification?.status === 'opened', '领域快照未保存通知状态');
    assert(domainChatMessage?.readBy?.includes('user-zhang'), '领域快照未保存会话已读');
    assert(domainMessages.some((item) => item.id === 'verify-flow-message-submit'), '领域快照缺少成果提交消息');
    assert(domainMessages.some((item) => item.id === 'verify-flow-message-completed'), '领域快照缺少完成归档消息');

    const completedTasks = await request('/api/partner-state/tasks?status=completed', { token });
    assert(completedTasks.tasks?.some((item) => item.id === 'verify-flow-task'), '完成任务列表未返回协作任务');

    const openedNotifications = await request('/api/partner-state/notifications?status=opened', { token });
    assert(openedNotifications.notifications?.some((item) => item.id === 'verify-flow-notification-invite'), '已打开通知列表未返回协作通知');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'partner flow state initialization',
        'member directory for document collaboration',
        'document collaboration task create',
        'assistance conversation create',
        'invite notification create/open',
        'chat message append',
        'conversation mark read',
        'submit deliverable and await confirmation',
        'complete and archive task',
        'domain snapshot persistence',
        'task and notification list filters',
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
