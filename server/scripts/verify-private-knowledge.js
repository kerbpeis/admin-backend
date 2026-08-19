require('dotenv').config();
const fs = require('fs/promises');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../config/db');

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const account = {
  email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
};

// 后端禁止审核自己提交的共享申请，审核步骤需要一个独立的管理员账号
const reviewerAccount = {
  email: 'verify-reviewer@example.com',
  password: 'reviewer123',
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

const login = async (credentials = account) => {
  const data = await request('/api/auth/login', {
    method: 'POST',
    expectedStatus: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  return data.token;
};

// 幂等创建审核人账号（与提交人同公司、平台管理员）
const ensureReviewer = async (submitterEmail) => {
  const [submitter] = await query('SELECT id, company_id FROM users WHERE email = ? LIMIT 1', [submitterEmail]);
  const [existing] = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [reviewerAccount.email]);
  if (existing?.id) return;
  const passwordHash = await bcrypt.hash(reviewerAccount.password, 12);
  await query(
    `INSERT INTO users (company_id, name, email, password_hash, department, section, is_admin, platform_role)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'super_admin')`,
    [submitter.company_id, '验证审核员', reviewerAccount.email, passwordHash, '生产技术', '采煤管理室']
  );
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const cleanupPromotedDocuments = async () => {
  const rows = await query(
    "SELECT id, path FROM files WHERE name = '个人知识空间验证笔记' AND category = '验证资料'"
  );
  if (rows.length) {
    await query(`DELETE FROM files WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map((row) => row.id));
    await Promise.all(rows.map((row) => (row.path ? fs.unlink(row.path).catch(() => {}) : Promise.resolve())));
  }
};

const main = async () => {
  const token = await login();
  await ensureReviewer(account.email);
  const reviewerToken = await login(reviewerAccount);
  const [currentUser] = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [account.email]);
  assert(currentUser?.id, '验证账号不存在');
  const before = await request('/api/private-knowledge', { token });
  const now = new Date().toISOString();
  const workspace = {
    bookmarks: [
      { id: 'bookmark-frequent', name: '常用资料', icon: 'star-outline', color: '#2F9E7E', system: false, createdAt: now, updatedAt: now },
      { id: 'bookmark-inbox', name: '待整理', icon: 'tray-full', color: '#D59327', system: true, createdAt: now, updatedAt: now },
    ],
    folders: [
      { id: 'verify-folder-private', bookmarkId: 'bookmark-frequent', name: '验证文件夹', createdAt: now, updatedAt: now },
    ],
    items: [
      {
        id: 'verify-private-item',
        type: 'note',
        title: '个人知识空间验证笔记',
        sourceTitle: 'Codex 验证',
        bookmarkIds: ['bookmark-frequent'],
        folderIds: ['verify-folder-private'],
        tags: ['验证', '个人知识'],
        summary: '用于验证个人知识条目能够落库并回读。',
        pinned: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'verify-private-item-cancel',
        type: 'note',
        title: '个人知识空间取消验证笔记',
        sourceTitle: 'Codex 验证',
        bookmarkIds: ['bookmark-frequent'],
        folderIds: ['verify-folder-private'],
        tags: ['验证', '取消'],
        summary: '用于验证共享申请取消分支。',
        pinned: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    readingHistory: [
      {
        id: 'verify-reading-doc',
        title: '最近阅读同步验证资料',
        owner: 'Codex 验证',
        category: '验证资料',
        openedAt: now,
        page: 3,
        totalPages: 9,
      },
    ],
  };

  try {
    await cleanupPromotedDocuments();

    const saved = await request('/api/private-knowledge', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    });
    assert(saved.exists, '保存后未返回 exists=true');
    assert(saved.workspace?.bookmarks?.length === 2, '书签数量回读异常');
    assert(saved.workspace?.folders?.[0]?.bookmarkId === 'bookmark-frequent', '文件夹所属书签未回读');
    assert(saved.workspace?.items?.[0]?.id === 'verify-private-item', '个人知识条目未回读');
    assert(saved.workspace?.items?.[0]?.pinned === true, '置顶状态未回读');

    const loaded = await request('/api/private-knowledge', { token });
    assert(loaded.workspace?.items?.some((item) => item.id === 'verify-private-item'), 'GET 工作区未返回验证条目');

    const nextReading = [
      {
        id: 'verify-reading-doc-next',
        title: '最近阅读独立同步验证资料',
        owner: 'Codex 验证',
        category: '验证资料',
        openedAt: new Date(Date.now() + 1000).toISOString(),
        page: 1,
        totalPages: 2,
      },
    ];
    const readingSaved = await request('/api/private-knowledge/reading-history', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readingHistory: nextReading }),
    });
    assert(readingSaved.readingHistory?.length === 1, '最近阅读独立同步数量异常');
    assert(readingSaved.readingHistory?.[0]?.id === 'verify-reading-doc-next', '最近阅读独立同步未替换旧记录');

    const readingLoaded = await request('/api/private-knowledge/reading-history', { token });
    assert(readingLoaded.readingHistory?.[0]?.page === 1, '最近阅读 GET 结果异常');

    await query(
      `INSERT INTO audit_logs
        (actor_id, action, resource_type, resource_id, resource_name, status, metadata)
       VALUES (?, 'library_document.download_content', 'library_document', 'verify-download-document', '下载历史验证资料', 'success', ?)`,
      [
        currentUser.id,
        JSON.stringify({ fileName: 'download-history-verify.txt' }),
      ]
    );
    const downloadHistory = await request('/api/private-knowledge/download-history?limit=10', { token });
    assert(
      downloadHistory.downloads?.some((item) => (
        item.documentId === 'verify-download-document'
        && item.fileName === 'download-history-verify.txt'
      )),
      '下载历史 GET 结果异常'
    );

    const activityHistory = await request('/api/private-knowledge/activity-history?limit=10', { token });
    assert(
      activityHistory.activities?.some((item) => (
        item.resourceId === 'verify-download-document'
        && item.action === 'library_document.download_content'
        && item.actionLabel === '下载资料'
      )),
      '最近活动 GET 结果异常'
    );

    const learningSaved = await request('/api/private-knowledge/learning-progress', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        progress: [{
          documentId: 'verify-learning-document',
          title: '岗位必学同步验证资料',
          status: 'in_progress',
          progressPercent: 35,
          dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          lastStudiedAt: now,
        }],
      }),
    });
    assert(learningSaved.progress?.some((item) => item.documentId === 'verify-learning-document'), '学习进度保存后未回读');

    const learningLoaded = await request('/api/private-knowledge/learning-progress?limit=20', { token });
    assert(learningLoaded.progress?.some((item) => item.progressPercent === 35), '学习进度 GET 结果异常');

    const learningCompleted = await request('/api/private-knowledge/learning-progress/verify-learning-document', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '岗位必学同步验证资料',
        status: 'completed',
        progressPercent: 100,
        lastStudiedAt: new Date(Date.now() + 1000).toISOString(),
        reviewAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      }),
    });
    assert(learningCompleted.progress?.status === 'completed', '学习进度局部更新状态异常');
    assert(learningCompleted.progress?.progressPercent === 100, '学习进度局部更新百分比异常');

    await request('/api/private-knowledge/learning-progress/verify-learning-document', {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '岗位必学同步验证资料',
        status: 'completed',
        progressPercent: 100,
        reviewAt: new Date(Date.now() - 1000).toISOString(),
      }),
    });
    const learningReviewDue = await request('/api/private-knowledge/learning-progress?reviewDue=1&limit=20', { token });
    assert(
      learningReviewDue.progress?.some((item) => (
        item.documentId === 'verify-learning-document' && item.status === 'review_due'
      )),
      '复习提醒到期筛选异常'
    );

    const shareCreated = await request('/api/private-knowledge/share-requests', {
      method: 'POST',
      token,
      expectedStatus: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          privateItemId: 'verify-private-item',
          item: workspace.items[0],
          targetProfession: '生产技术',
          targetSection: '采煤管理室',
          targetCategory: '验证资料',
          reason: '验证个人资料可以提交共享申请。',
        },
      }),
    });
    assert(shareCreated.shareRequest?.status === 'pending', '共享申请创建状态异常');
    assert(shareCreated.shareRequest?.privateItemId === 'verify-private-item', '共享申请未关联个人资料');

    const duplicatePending = await request('/api/private-knowledge/share-requests', {
      method: 'POST',
      token,
      expectedStatus: 409,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          privateItemId: 'verify-private-item',
          item: workspace.items[0],
          targetProfession: '生产技术',
          targetSection: '采煤管理室',
          targetCategory: '验证资料',
          reason: '验证重复待审共享申请会被拦截。',
        },
      }),
    });
    assert(duplicatePending.shareRequest?.id === shareCreated.shareRequest.id, '重复待审共享申请未返回原申请');

    const shareRequests = await request('/api/private-knowledge/share-requests?limit=20', { token });
    assert(shareRequests.shareRequests?.some((item) => item.id === shareCreated.shareRequest.id), '共享申请列表未返回验证记录');

    const shareApproved = await request(`/api/private-knowledge/share-requests/${shareCreated.shareRequest.id}`, {
      method: 'PATCH',
      token: reviewerToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', reviewNote: '验证审核通过并进入资料库' }),
    });
    assert(shareApproved.shareRequest?.status === 'approved', '共享申请审核通过状态异常');
    assert(shareApproved.shareRequest?.promotedDocumentId, '审核通过后未返回资料库资料 ID');

    const duplicateApproved = await request('/api/private-knowledge/share-requests', {
      method: 'POST',
      token,
      expectedStatus: 409,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          privateItemId: 'verify-private-item',
          item: workspace.items[0],
          targetProfession: '生产技术',
          targetSection: '采煤管理室',
          targetCategory: '验证资料',
          reason: '验证已通过共享申请不能重复提交。',
        },
      }),
    });
    assert(duplicateApproved.shareRequest?.status === 'approved', '重复已通过共享申请未返回已通过记录');

    const promotedDocuments = await request('/api/library-documents?search=%E4%B8%AA%E4%BA%BA%E7%9F%A5%E8%AF%86%E7%A9%BA%E9%97%B4%E9%AA%8C%E8%AF%81%E7%AC%94%E8%AE%B0&limit=20', { token });
    assert(
      promotedDocuments.documents?.some((item) => item.id === shareApproved.shareRequest.promotedDocumentId),
      '审核通过后资料库未返回晋级资料'
    );

    const cancelShareCreated = await request('/api/private-knowledge/share-requests', {
      method: 'POST',
      token,
      expectedStatus: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          privateItemId: 'verify-private-item-cancel',
          item: workspace.items[1],
          targetProfession: '生产技术',
          targetSection: '采煤管理室',
          targetCategory: '验证资料-取消',
          reason: '验证个人资料可以取消共享申请。',
        },
      }),
    });

    const shareCancelled = await request(`/api/private-knowledge/share-requests/${cancelShareCreated.shareRequest.id}`, {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', reviewNote: '验证完成后取消' }),
    });
    assert(shareCancelled.shareRequest?.status === 'cancelled', '共享申请取消结果异常');

    const interactionCreated = await request('/api/private-knowledge/agent-interactions', {
      method: 'POST',
      token,
      expectedStatus: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interaction: {
          id: 'verify-agent-interaction',
          type: 'question',
          question: '过断层前需要检查哪些资料？',
          title: '过断层资料准备',
          status: 'answered',
          referencedDocumentId: 'verify-reading-doc-next',
          answer: {
            conclusion: '先核对地质资料、专项措施和现场执行清单。',
          },
          createdAt: new Date(Date.now() + 2000).toISOString(),
        },
      }),
    });
    assert(interactionCreated.interaction?.id === 'verify-agent-interaction', '智能体历史创建结果异常');

    const interactions = await request('/api/private-knowledge/agent-interactions?limit=5', { token });
    assert(interactions.interactions?.some((item) => item.id === 'verify-agent-interaction'), '智能体历史列表未返回验证记录');

    await request('/api/private-knowledge/agent-interactions/verify-agent-interaction', {
      method: 'DELETE',
      token,
    });
    const interactionsAfterDelete = await request('/api/private-knowledge/agent-interactions?limit=5', { token });
    assert(!interactionsAfterDelete.interactions?.some((item) => item.id === 'verify-agent-interaction'), '智能体历史删除后仍存在');

    const cleared = await request('/api/private-knowledge', {
      method: 'DELETE',
      token,
    });
    assert(cleared.exists === false, '清空工作区未返回 exists=false');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'private workspace authenticated read',
        'bookmark/folder/item/history workspace save',
        'private knowledge JSON payload round trip',
        'reading history standalone replace',
        'download history from audit logs',
        'activity history from audit logs',
        'learning progress save/list/update',
        'learning review due filter',
        'private share request create/list/approve/promote/cancel/deduplicate',
        'agent interaction create/list/delete',
        'private workspace cleanup',
      ],
    }, null, 2));
  } finally {
    await request('/api/private-knowledge/agent-interactions/verify-agent-interaction', {
      method: 'DELETE',
      token,
    }).catch(() => {});
    await query(
      "DELETE FROM private_share_requests WHERE title IN ('个人知识空间验证笔记', '个人知识空间取消验证笔记') AND target_category IN ('验证资料', '验证资料-取消')"
    ).catch(() => {});
    await query(
      "DELETE FROM private_learning_progress WHERE document_id = 'verify-learning-document'"
    ).catch(() => {});
    await query(
      `DELETE FROM audit_logs
       WHERE resource_id = 'verify-download-document'
          OR resource_name IN ('个人知识空间验证笔记', '个人知识空间取消验证笔记')`
    ).catch(() => {});
    await cleanupPromotedDocuments().catch(() => {});
    if (before.exists && before.workspace) {
      await request('/api/private-knowledge', {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: before.workspace }),
      }).catch(() => {});
    } else {
      await request('/api/private-knowledge', {
        method: 'DELETE',
        token,
      }).catch(() => {});
    }
    await pool.end().catch(() => {});
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
