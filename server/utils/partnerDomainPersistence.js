const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const toLocalId = (value, prefix, index) => {
  const id = value == null || value === '' ? `${prefix}-${index + 1}` : String(value);
  return id.slice(0, 100);
};

const limitString = (value, maxLength) => {
  if (value == null) return null;
  return String(value).slice(0, maxLength);
};

const toJson = (value, fallback = []) => JSON.stringify(value == null ? fallback : value);

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const deleteMissingRows = async (connection, tableName, userId, ids) => {
  if (!ids.length) {
    await connection.query(`DELETE FROM ${tableName} WHERE user_id = ?`, [userId]);
    return;
  }

  const placeholders = ids.map(() => '?').join(',');
  await connection.query(
    `DELETE FROM ${tableName} WHERE user_id = ? AND local_id NOT IN (${placeholders})`,
    [userId, ...ids]
  );
};

const upsertPartnerConversations = async (connection, userId, state) => {
  const conversations = toArray(state.conversations);
  const ids = conversations.map((conversation, index) => toLocalId(conversation?.id, 'conversation', index));
  await deleteMissingRows(connection, 'partner_conversations', userId, ids);

  for (let index = 0; index < conversations.length; index += 1) {
    const conversation = conversations[index] || {};
    const localId = ids[index];
    await connection.query(
      `INSERT INTO partner_conversations
        (user_id, local_id, type, title, task_local_id, member_ids, unread_count, pinned, muted, archived, mentioned, last_read_at, source_updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         type = VALUES(type),
         title = VALUES(title),
         task_local_id = VALUES(task_local_id),
         member_ids = VALUES(member_ids),
         unread_count = VALUES(unread_count),
         pinned = VALUES(pinned),
         muted = VALUES(muted),
         archived = VALUES(archived),
         mentioned = VALUES(mentioned),
         last_read_at = VALUES(last_read_at),
         source_updated_at = VALUES(source_updated_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        limitString(conversation.type || 'direct', 40),
        limitString(conversation.title || '', 255),
        limitString(conversation.taskId || null, 100),
        toJson(conversation.memberIds),
        Number(conversation.unreadCount) || 0,
        Boolean(conversation.pinned) ? 1 : 0,
        Boolean(conversation.muted) ? 1 : 0,
        Boolean(conversation.archived) ? 1 : 0,
        Boolean(conversation.mentioned) ? 1 : 0,
        toDateOrNull(conversation.lastReadAt),
        toDateOrNull(conversation.updatedAt || state.clientUpdatedAt),
        JSON.stringify({ ...conversation, id: localId }),
      ]
    );
  }
};

const upsertPartnerTasks = async (connection, userId, state) => {
  const tasks = toArray(state.tasks);
  const ids = tasks.map((task, index) => toLocalId(task?.id, 'task', index));
  await deleteMissingRows(connection, 'partner_tasks', userId, ids);

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index] || {};
    const localId = ids[index];
    await connection.query(
      `INSERT INTO partner_tasks
        (user_id, local_id, title, status, priority, requester_local_id, conversation_local_id, member_ids, skill_tags, match_scope, published_to_pool, deadline_at, source_created_at, source_updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         status = VALUES(status),
         priority = VALUES(priority),
         requester_local_id = VALUES(requester_local_id),
         conversation_local_id = VALUES(conversation_local_id),
         member_ids = VALUES(member_ids),
         skill_tags = VALUES(skill_tags),
         match_scope = VALUES(match_scope),
         published_to_pool = VALUES(published_to_pool),
         deadline_at = VALUES(deadline_at),
         source_created_at = VALUES(source_created_at),
         source_updated_at = VALUES(source_updated_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        limitString(task.title || '未命名协作', 255),
        limitString(task.status || 'pending', 60),
        limitString(task.priority || null, 40),
        limitString(task.requesterId || null, 100),
        limitString(task.conversationId || null, 100),
        toJson(task.memberIds),
        toJson(task.skillTags),
        limitString(task.matchScope || null, 60),
        Boolean(task.publishedToPool) ? 1 : 0,
        toDateOrNull(task.deadlineAt || task.deadline),
        toDateOrNull(task.createdAt),
        toDateOrNull(task.updatedAt || state.clientUpdatedAt || task.createdAt),
        JSON.stringify({ ...task, id: localId }),
      ]
    );
  }
};

const upsertPartnerMessages = async (connection, userId, state) => {
  const messages = toArray(state.messages);
  const ids = messages.map((message, index) => toLocalId(message?.id, 'message', index));
  await deleteMissingRows(connection, 'partner_messages', userId, ids);

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] || {};
    const localId = ids[index];
    await connection.query(
      `INSERT INTO partner_messages
        (user_id, local_id, conversation_local_id, sender_local_id, type, body, read_by, source_created_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         conversation_local_id = VALUES(conversation_local_id),
         sender_local_id = VALUES(sender_local_id),
         type = VALUES(type),
         body = VALUES(body),
         read_by = VALUES(read_by),
         source_created_at = VALUES(source_created_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        limitString(message.conversationId || 'unknown', 100),
        limitString(message.senderId || null, 100),
        limitString(message.type || 'text', 40),
        message.body == null ? null : String(message.body),
        toJson(message.readBy),
        toDateOrNull(message.createdAt),
        JSON.stringify({ ...message, id: localId }),
      ]
    );
  }
};

const upsertPartnerNotifications = async (connection, userId, state) => {
  const notifications = toArray(state.notifications);
  const ids = notifications.map((notification, index) => toLocalId(notification?.id, 'notification', index));
  await deleteMissingRows(connection, 'partner_notifications', userId, ids);

  for (let index = 0; index < notifications.length; index += 1) {
    const notification = notifications[index] || {};
    const localId = ids[index];
    await connection.query(
      `INSERT INTO partner_notifications
        (user_id, local_id, type, task_local_id, status, title, summary, recipient_ids, source_created_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         type = VALUES(type),
         task_local_id = VALUES(task_local_id),
         status = VALUES(status),
         title = VALUES(title),
         summary = VALUES(summary),
         recipient_ids = VALUES(recipient_ids),
         source_created_at = VALUES(source_created_at),
         payload = VALUES(payload),
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        localId,
        limitString(notification.type || 'notification', 80),
        limitString(notification.taskId || null, 100),
        limitString(notification.status || null, 60),
        limitString(notification.title || '', 255),
        notification.summary == null ? null : String(notification.summary),
        toJson(notification.recipientIds),
        toDateOrNull(notification.createdAt || notification.sentAt || notification.openedAt),
        JSON.stringify({ ...notification, id: localId }),
      ]
    );
  }
};

const syncPartnerDomainSnapshot = async (connection, userId, state) => {
  await upsertPartnerConversations(connection, userId, state);
  await upsertPartnerTasks(connection, userId, state);
  await upsertPartnerMessages(connection, userId, state);
  await upsertPartnerNotifications(connection, userId, state);
};

const deletePartnerDomainSnapshot = async (connection, userId) => {
  await connection.query('DELETE FROM partner_notifications WHERE user_id = ?', [userId]);
  await connection.query('DELETE FROM partner_messages WHERE user_id = ?', [userId]);
  await connection.query('DELETE FROM partner_tasks WHERE user_id = ?', [userId]);
  await connection.query('DELETE FROM partner_conversations WHERE user_id = ?', [userId]);
};

const serializeDomainRows = (rows) => rows.map((row) => ({
  ...parseJson(row.payload, {}),
  id: row.local_id,
  persisted: {
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  },
}));

const readPartnerDomainSnapshot = async (query, userId) => {
  const [conversationRows, taskRows, messageRows, notificationRows] = await Promise.all([
    query('SELECT * FROM partner_conversations WHERE user_id = ? ORDER BY COALESCE(source_updated_at, updated_at) DESC, local_id ASC', [userId]),
    query('SELECT * FROM partner_tasks WHERE user_id = ? ORDER BY COALESCE(deadline_at, source_updated_at, updated_at) DESC, local_id ASC', [userId]),
    query('SELECT * FROM partner_messages WHERE user_id = ? ORDER BY COALESCE(source_created_at, created_at) ASC, local_id ASC', [userId]),
    query('SELECT * FROM partner_notifications WHERE user_id = ? ORDER BY COALESCE(source_created_at, created_at) DESC, local_id ASC', [userId]),
  ]);

  return {
    conversations: serializeDomainRows(conversationRows),
    tasks: serializeDomainRows(taskRows),
    messages: serializeDomainRows(messageRows),
    notifications: serializeDomainRows(notificationRows),
  };
};

module.exports = {
  syncPartnerDomainSnapshot,
  deletePartnerDomainSnapshot,
  readPartnerDomainSnapshot,
};
