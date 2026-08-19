const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool, query, withTransaction } = require('../config/db');
const { PERMISSIONS } = require('../utils/authorization');
const { extractClauses } = require('../utils/fileContentIndex');
require('dotenv').config();

const permissions = [
  { name: PERMISSIONS.USER_READ, description: '查看用户', type: 'system' },
  { name: PERMISSIONS.USER_CREATE, description: '创建用户', type: 'system' },
  { name: PERMISSIONS.USER_UPDATE, description: '更新用户', type: 'system' },
  { name: PERMISSIONS.USER_DELETE, description: '删除用户', type: 'system' },
  { name: PERMISSIONS.USER_ASSIGN_ROLE, description: '分配用户角色', type: 'system' },
  { name: PERMISSIONS.USER_GRANT_ADMIN, description: '授予或取消超级管理员身份', type: 'system' },
  { name: PERMISSIONS.ROLE_READ, description: '查看角色', type: 'system' },
  { name: PERMISSIONS.ROLE_CREATE, description: '创建角色', type: 'system' },
  { name: PERMISSIONS.ROLE_UPDATE, description: '更新角色', type: 'system' },
  { name: PERMISSIONS.ROLE_DELETE, description: '删除角色', type: 'system' },
  { name: PERMISSIONS.ROLE_ASSIGN_PERMISSION, description: '分配角色权限', type: 'system' },
  { name: PERMISSIONS.PERMISSION_READ, description: '查看权限', type: 'system' },
  { name: PERMISSIONS.PERMISSION_CREATE, description: '创建权限', type: 'system' },
  { name: PERMISSIONS.PERMISSION_UPDATE, description: '更新权限', type: 'system' },
  { name: PERMISSIONS.PERMISSION_DELETE, description: '删除权限', type: 'system' },
  { name: PERMISSIONS.PERMISSION_BATCH_CREATE, description: '批量创建权限', type: 'system' },
  { name: PERMISSIONS.AUDIT_READ, description: '查看操作审计日志', type: 'system' },
  { name: PERMISSIONS.DEPARTMENT_READ, description: '查看部门', type: 'department' },
  { name: PERMISSIONS.DEPARTMENT_CREATE, description: '创建部门', type: 'department' },
  { name: PERMISSIONS.DEPARTMENT_UPDATE, description: '更新部门', type: 'department' },
  { name: PERMISSIONS.DEPARTMENT_DELETE, description: '删除部门', type: 'department' },
  { name: PERMISSIONS.DEPARTMENT_MANAGE_MEMBERS, description: '管理部门成员', type: 'department' },
  { name: PERMISSIONS.FILE_READ, description: '查看文件', type: 'file' },
  { name: PERMISSIONS.FILE_CREATE, description: '上传文件', type: 'file' },
  { name: PERMISSIONS.FILE_UPDATE, description: '更新文件', type: 'file' },
  { name: PERMISSIONS.FILE_DELETE, description: '删除文件', type: 'file' },
  { name: PERMISSIONS.FOLDER_READ, description: '查看知识点/文件夹', type: 'folder' },
  { name: PERMISSIONS.FOLDER_CREATE, description: '创建知识点/文件夹', type: 'folder' },
  { name: PERMISSIONS.FOLDER_UPDATE, description: '更新知识点/文件夹', type: 'folder' },
  { name: PERMISSIONS.FOLDER_DELETE, description: '删除知识点/文件夹', type: 'folder' },
];

const departmentTree = [
  {
    name: '生产技术',
    description: '采掘、生产组织和技术资料管理',
    sections: ['采煤管理室', '掘进管理室', '调度协调室'],
  },
  {
    name: '一通三防',
    description: '通风、防尘、防火和瓦斯治理资料管理',
    sections: ['通风管理室', '瓦斯治理室', '抽采管理室', '防尘防灭火室'],
  },
  {
    name: '机电设备',
    description: '机电运输和设备运维资料管理',
    sections: ['机电管理室', '运输管理室', '运维管理室', '设备检修室'],
  },
  {
    name: '地测防治水',
    description: '地质测量和防治水资料管理',
    sections: ['地质测量室', '防治水管理室', '水文管理室'],
  },
  {
    name: '安全监管',
    description: '安全检查、隐患治理和制度资料管理',
    sections: ['安全监察室', '隐患治理室'],
  },
  {
    name: '应急指挥',
    description: '应急预案、演练和指挥协同资料管理',
    sections: ['应急管理室', '救援协调室'],
  },
];

const libraryDocuments = [
  {
    title: '煤矿安全规程重点条款汇编',
    owner: '安全监察部',
    profession: '安全监管',
    section: '安全监察室',
    category: '国家规程',
    currentVersion: '2026版',
    effectiveDate: '2026-01-01',
    reviewDate: '2026-12-01',
    issuer: '国家矿山安全监察局',
    approver: '法规标准委员会',
    icon: 'book-open-page-variant-outline',
    color: '#1F6F8B',
    tags: ['安全规程', '全员必学', '条款索引'],
    summary: '汇总采掘、通风、机电、运输、防治水等关键条款，支持按岗位和场景快速检索。',
    clauses: [
      '第一条 采掘工作面开工前，必须核对作业规程、地质说明书和安全技术措施的现行有效版本。',
      '第二条 瓦斯检查实行巡回检查与定点监测相结合，发现超限立即停止作业、撤出人员并上报。',
      '第三条 井下停送电必须执行工作票制度，停电后验电、放电、闭锁并悬挂警示牌。',
      '第四条 探放水坚持有疑必探、先探后掘，超前距离不得小于规定值，异常出水立即停钻上报。',
      '第五条 井下动火作业必须办理审批手续，现场配备消防器材并设专职监护人。',
    ],
    versions: [
      { label: '2022版', date: '2022-01-01', note: '历史版本，仅用于差异追溯' },
      { label: '2026版', date: '2026-05-18', note: '补充智能化开采与重大灾害治理条款索引' },
    ],
  },
  {
    title: '综采工作面过地质构造专项安全技术措施模板',
    owner: '生产技术部',
    profession: '生产技术',
    section: '采煤管理室',
    category: '措施模板',
    currentVersion: 'V3.2',
    effectiveDate: '2026-03-01',
    reviewDate: '2026-06-20',
    issuer: '生产技术部',
    approver: '总工程师办公室',
    icon: 'file-document-edit-outline',
    color: '#2F855A',
    tags: ['综采', '过断层', '安全措施'],
    summary: '覆盖风险辨识、支护参数、超前探查、现场确认、审批流和班前贯彻记录。',
    clauses: [
      '第一条 揭露断层前完成地质资料联合会审，生产、技术、通风、机电、安全岗位共同确认风险。',
      '第二条 过构造期间支护参数按顶板破碎程度动态调整，超前支护距离不得小于二十米。',
      '第三条 每班开工前由班组长组织风险交底并签字确认，未交底不得开工。',
      '第四条 构造带附近加强瓦斯和涌水观测，发现异常立即停工撤人并上报调度。',
    ],
    versions: [
      { label: 'V3.1', date: '2026-03-01', note: '调整超前支护参数填写项' },
      { label: 'V3.2', date: '2026-05-16', note: '新增断层揭露前联合确认清单' },
    ],
  },
  {
    title: '瓦斯抽采达标评判及参数记录标准',
    owner: '通风防突部',
    profession: '一通三防',
    section: '抽采管理室',
    category: '企业标准',
    currentVersion: 'V2.0',
    effectiveDate: '2026-04-01',
    reviewDate: '2026-10-01',
    issuer: '通风防突部',
    approver: '通风副总工程师',
    icon: 'fan',
    color: '#D97706',
    tags: ['瓦斯抽采', '达标评判', '记录表'],
    summary: '规范抽采参数、计量校验、钻孔验收、评判结论和异常处理记录。',
    clauses: [
      '第一条 抽采计量装置每月校验一次，校验记录由专人归档保存。',
      '第二条 抽采达标评判以实测残余瓦斯含量和瓦斯压力为依据，数据不全不得出具评判结论。',
      '第三条 钻孔施工完成后四十八小时内完成封孔质量验收。',
      '第四条 评判结论为不达标时，制定补充抽采措施并重新组织评判。',
    ],
    versions: [
      { label: 'V1.6', date: '2025-09-18', note: '历史版本，仅用于差异追溯' },
      { label: 'V2.0', date: '2026-05-12', note: '统一抽采计量与复核口径' },
    ],
  },
  {
    title: '井下动火作业审批与现场监护流程',
    owner: '机电运输部',
    profession: '机电设备',
    section: '运维管理室',
    category: '操作流程',
    currentVersion: 'V1.8',
    effectiveDate: '2026-02-15',
    reviewDate: '2026-08-15',
    issuer: '机电运输部',
    approver: '安全生产委员会',
    icon: 'fire-alert',
    color: '#DC2626',
    tags: ['动火作业', '审批', '现场监护'],
    summary: '明确作业申请、瓦斯检查、停电闭锁、消防器材、监护人职责和完工验收。',
    versions: [
      { label: 'V1.7', date: '2025-12-06', note: '完善监护人交接流程' },
      { label: 'V1.8', date: '2026-05-09', note: '增加作业结束后复查留痕要求' },
    ],
  },
  {
    title: '探放水设计审批及现场验收清单',
    owner: '地测防治水部',
    profession: '地测防治水',
    section: '水文管理室',
    category: '验收清单',
    currentVersion: 'V2.4',
    effectiveDate: '2026-03-20',
    reviewDate: '2026-09-20',
    issuer: '地测防治水部',
    approver: '地测副总工程师',
    icon: 'water-check-outline',
    color: '#2563EB',
    tags: ['探放水', '审批', '验收'],
    summary: '把设计、审批、钻探、放水、效果评价和资料归档拆成可执行检查项。',
    versions: [
      { label: 'V2.3', date: '2025-11-22', note: '调整现场验收责任岗位' },
      { label: 'V2.4', date: '2026-05-07', note: '补充异常出水复核和签认要求' },
    ],
  },
];

const upsertPermission = async (connection, permission) => {
  await connection.execute(
    `INSERT INTO permissions (name, description, type)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description), type = VALUES(type)`,
    [permission.name, permission.description, permission.type]
  );

  const [rows] = await connection.execute('SELECT id FROM permissions WHERE name = ?', [permission.name]);
  return rows[0].id;
};

const upsertRole = async (connection, role, permissionIds) => {
  await connection.execute(
    `INSERT INTO roles (name, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    [role.name, role.description]
  );

  const [rows] = await connection.execute('SELECT id FROM roles WHERE name = ?', [role.name]);
  const roleId = rows[0].id;

  await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  for (const permissionId of permissionIds) {
    await connection.execute(
      'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      [roleId, permissionId]
    );
  }

  return roleId;
};

const generateInviteCode = (length = 12) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
};

const ensureDefaultCompany = async (connection) => {
  const [rows] = await connection.execute('SELECT id, name FROM companies ORDER BY id LIMIT 1');
  if (rows[0]) return rows[0];

  const name = process.env.DEFAULT_COMPANY_NAME || '默认煤矿公司';
  const [result] = await connection.execute(
    'INSERT INTO companies (name, invite_code) VALUES (?, ?)',
    [name, generateInviteCode()]
  );
  return { id: result.insertId, name };
};

const upsertDepartments = async (connection, companyId) => {
  let order = 1;

  for (const profession of departmentTree) {
    // 专业和科室都属于公司，避免不同公司之间目录互相影响。
    const [existingProfession] = await connection.execute(
      "SELECT id FROM departments WHERE name = ? AND type = 'profession' AND company_id = ?",
      [profession.name, companyId]
    );

    let professionId = existingProfession[0]?.id;

    if (!professionId) {
      const [result] = await connection.execute(
        `INSERT INTO departments (company_id, name, description, type, parent_department_id, order_index, is_active)
         VALUES (?, ?, ?, 'profession', NULL, ?, 1)`,
        [companyId, profession.name, profession.description, order]
      );
      professionId = result.insertId;
    }

    order += 1;

    for (const section of profession.sections) {
      // 科室属于公司，按 (company_id, name, type) 判断已存在则跳过，保证幂等
      const [existingSection] = await connection.execute(
        "SELECT id FROM departments WHERE name = ? AND type = 'section' AND company_id = ?",
        [section, companyId]
      );

      if (!existingSection[0]) {
        await connection.execute(
          `INSERT INTO departments (company_id, name, description, type, parent_department_id, order_index, is_active)
           VALUES (?, ?, ?, 'section', ?, ?, 1)`,
          [companyId, section, `${profession.name} / ${section}`, professionId, order]
        );
      }

      order += 1;
    }
  }
};

const sanitizeFileName = (value) => String(value || '资料')
  .replace(/[\\/:*?"<>|]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

const buildSeedFileContent = (document, version) => [
  document.title,
  version.label,
  '',
  `资料类型：${document.category}`,
  `适用路径：${document.profession} / ${document.section}`,
  `发布单位：${document.issuer}`,
  `批准单位：${document.approver}`,
  `生效日期：${document.effectiveDate}`,
  `复审日期：${document.reviewDate}`,
  '',
  '资料摘要',
  document.summary,
  '',
  '版本说明',
  version.note,
  '',
  '说明：此文件为后端种子数据生成的资料库原型文本，正式环境应替换为真实源文件。',
  ...(Array.isArray(document.clauses) && document.clauses.length
    ? ['', '条款摘录', ...document.clauses]
    : []),
].join('\n');

const ensureSeedFile = (document, version, versionNumber) => {
  const seedDir = path.join(__dirname, '..', 'uploads', 'seed');
  fs.mkdirSync(seedDir, { recursive: true });
  const fileName = `${sanitizeFileName(document.title)}-${sanitizeFileName(version.label)}.txt`;
  const filePath = path.join(seedDir, fileName);
  const content = buildSeedFileContent(document, version, versionNumber);
  fs.writeFileSync(filePath, content, 'utf8');
  return {
    name: fileName,
    path: filePath,
    size: Buffer.byteLength(content),
    mimeType: 'text/plain',
  };
};

// 专业和科室都属于公司；解析时限制在默认公司范围内。
const getDepartmentIdByName = async (connection, name, companyId) => {
  const [rows] = await connection.execute(
    'SELECT id FROM departments WHERE name = ? AND is_active = 1 AND company_id = ?',
    [name, companyId]
  );
  return rows[0]?.id || null;
};

const upsertLibraryDocuments = async (connection, uploaderId, companyId) => {
  for (const document of libraryDocuments) {
    const professionId = await getDepartmentIdByName(connection, document.profession, companyId);
    const sectionId = await getDepartmentIdByName(connection, document.section, companyId);
    const currentVersionNumber = document.versions.length;
    const currentVersion = document.versions[currentVersionNumber - 1];
    const currentFile = ensureSeedFile(document, currentVersion, currentVersionNumber);

    const [existingRows] = await connection.execute(
      `SELECT id FROM files
       WHERE company_id = ? AND name = ? AND department_id = ? AND profession_id = ? AND status <> 'deleted'
       LIMIT 1`,
      [companyId, document.title, sectionId, professionId]
    );

    let fileId = existingRows[0]?.id;

    if (fileId) {
      await connection.execute(
        `UPDATE files
         SET original_name = ?, path = ?, size = ?, mime_type = ?, extension = 'txt',
             description = ?, category = ?, current_version = ?, version_label = ?, visibility = 'department',
             tags = ?, effective_date = ?, review_date = ?, issuer = ?, approver = ?, icon = ?, color = ?,
             company_id = ?
         WHERE id = ?`,
        [
          currentFile.name,
          currentFile.path,
          currentFile.size,
          currentFile.mimeType,
          document.summary,
          document.category,
          currentVersionNumber,
          document.currentVersion,
          JSON.stringify(document.tags),
          document.effectiveDate,
          document.reviewDate,
          document.issuer,
          document.approver,
          document.icon,
          document.color,
          companyId,
          fileId,
        ]
      );
    } else {
      const [result] = await connection.execute(
        `INSERT INTO files
         (company_id, name, original_name, path, size, mime_type, extension, description, category, department_id, profession_id,
          uploaded_by, current_version, version_label, status, visibility, tags, effective_date, review_date, issuer, approver, icon, color)
         VALUES (?, ?, ?, ?, ?, ?, 'txt', ?, ?, ?, ?, ?, ?, ?, 'active', 'department', ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          document.title,
          currentFile.name,
          currentFile.path,
          currentFile.size,
          currentFile.mimeType,
          document.summary,
          document.category,
          sectionId,
          professionId,
          uploaderId,
          currentVersionNumber,
          document.currentVersion,
          JSON.stringify(document.tags),
          document.effectiveDate,
          document.reviewDate,
          document.issuer,
          document.approver,
          document.icon,
          document.color,
        ]
      );
      fileId = result.insertId;
    }

    for (const [index, version] of document.versions.entries()) {
      const versionNumber = index + 1;
      const versionFile = ensureSeedFile(document, version, versionNumber);
      await connection.execute(
        `INSERT INTO file_versions
         (file_id, version, version_label, path, size, original_name, mime_type, uploaded_by, change_log, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           version_label = VALUES(version_label),
           path = VALUES(path),
           size = VALUES(size),
           original_name = VALUES(original_name),
           mime_type = VALUES(mime_type),
           uploaded_by = VALUES(uploaded_by),
           change_log = VALUES(change_log),
           created_at = VALUES(created_at)`,
        [
          fileId,
          versionNumber,
          version.label,
          versionFile.path,
          versionFile.size,
          versionFile.name,
          versionFile.mimeType,
          uploaderId,
          version.note,
          version.date,
        ]
      );
    }

    // 条款入库：与正文索引口径一致，便于“第X条”问题直接命中条款原文
    await connection.execute('DELETE FROM file_clauses WHERE file_id = ?', [fileId]);
    const clauses = extractClauses(buildSeedFileContent(document, currentVersion));
    if (clauses.length) {
      const clauseValues = clauses.map((clause) => [fileId, clause.clauseNo, clause.clauseNoNum, clause.content]);
      const clausePlaceholders = clauseValues.map(() => '(?, ?, ?, ?)').join(', ');
      await connection.execute(
        `INSERT INTO file_clauses (file_id, clause_no, clause_no_num, content) VALUES ${clausePlaceholders}`,
        clauseValues.flat()
      );
    }
  }
};

const upsertAdmin = async (connection, adminRoleId, companyId) => {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(password, 12);

  await connection.execute(
    `INSERT INTO users (company_id, name, email, password_hash, department, section, is_admin, platform_role)
     VALUES (?, '管理员', ?, ?, '生产技术', '采煤管理室', 1, 'super_admin')
     ON DUPLICATE KEY UPDATE
       company_id = VALUES(company_id),
       name = VALUES(name),
       department = VALUES(department),
       section = VALUES(section),
       is_admin = 1,
       platform_role = 'super_admin'`,
    [companyId, email, passwordHash]
  );

  const [userRows] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
  const userId = userRows[0].id;

  await connection.execute('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, adminRoleId]);

  return { email, password, userId };
};

const upsertUserWithRole = async (connection, user, roleId, companyId) => {
  const passwordHash = await bcrypt.hash(user.password, 12);

  await connection.execute(
    `INSERT INTO users (company_id, name, email, password_hash, department, section, is_admin, platform_role)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'member')
     ON DUPLICATE KEY UPDATE
       company_id = VALUES(company_id),
       name = VALUES(name),
       department = VALUES(department),
       section = VALUES(section),
       is_admin = 0,
       platform_role = 'member'`,
    [companyId, user.name, user.email, passwordHash, user.department, user.section]
  );

  const [userRows] = await connection.execute('SELECT id FROM users WHERE email = ?', [user.email]);
  const userId = userRows[0].id;

  await connection.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  await connection.execute('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);

  return { ...user, userId };
};

const seed = async () => {
  await query('SELECT 1');

  const admin = await withTransaction(async (connection) => {
    const permissionIds = [];
    const permissionIdByName = {};

    for (const permission of permissions) {
      const permissionId = await upsertPermission(connection, permission);
      permissionIds.push(permissionId);
      permissionIdByName[permission.name] = permissionId;
    }

    const idsFor = (names) => names.map((name) => permissionIdByName[name]).filter(Boolean);
    const systemAdminPermissions = idsFor([
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_DELETE,
      PERMISSIONS.USER_ASSIGN_ROLE,
      PERMISSIONS.USER_GRANT_ADMIN,
      PERMISSIONS.ROLE_READ,
      PERMISSIONS.ROLE_CREATE,
      PERMISSIONS.ROLE_UPDATE,
      PERMISSIONS.ROLE_DELETE,
      PERMISSIONS.ROLE_ASSIGN_PERMISSION,
      PERMISSIONS.PERMISSION_READ,
      PERMISSIONS.PERMISSION_CREATE,
      PERMISSIONS.PERMISSION_UPDATE,
      PERMISSIONS.PERMISSION_DELETE,
      PERMISSIONS.PERMISSION_BATCH_CREATE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.DEPARTMENT_READ,
      PERMISSIONS.DEPARTMENT_CREATE,
      PERMISSIONS.DEPARTMENT_UPDATE,
      PERMISSIONS.DEPARTMENT_DELETE,
      PERMISSIONS.DEPARTMENT_MANAGE_MEMBERS,
    ]);
    const contentMaintainerPermissions = idsFor([
      PERMISSIONS.DEPARTMENT_READ,
      PERMISSIONS.FILE_READ,
      PERMISSIONS.FILE_CREATE,
      PERMISSIONS.FILE_UPDATE,
      PERMISSIONS.FILE_DELETE,
      PERMISSIONS.FOLDER_READ,
      PERMISSIONS.FOLDER_CREATE,
      PERMISSIONS.FOLDER_UPDATE,
      PERMISSIONS.FOLDER_DELETE,
    ]);
    const readOnlyPermissions = idsFor([
      PERMISSIONS.DEPARTMENT_READ,
      PERMISSIONS.FILE_READ,
      PERMISSIONS.FOLDER_READ,
    ]);

    const adminRoleId = await upsertRole(
      connection,
      { name: '超级管理员', description: '拥有系统全部管理权限' },
      permissionIds
    );

    await upsertRole(
      connection,
      { name: '系统管理员', description: '可维护后台用户、角色、权限和部门' },
      systemAdminPermissions
    );

    const contentMaintainerRoleId = await upsertRole(
      connection,
      { name: '资料维护员', description: '可维护本科室资料和文件夹' },
      contentMaintainerPermissions
    );

    const readOnlyRoleId = await upsertRole(
      connection,
      { name: '普通成员', description: '可查看授权范围内的资料' },
      readOnlyPermissions
    );

    const defaultCompany = await ensureDefaultCompany(connection);
    await upsertDepartments(connection, defaultCompany.id);
    const adminInfo = await upsertAdmin(connection, adminRoleId, defaultCompany.id);
    await upsertUserWithRole(connection, {
      name: '资料维护员',
      email: process.env.SEED_MAINTAINER_EMAIL || 'maintainer@example.com',
      password: process.env.SEED_MAINTAINER_PASSWORD || 'maintainer123',
      department: '生产技术',
      section: '采煤管理室',
    }, contentMaintainerRoleId, defaultCompany.id);
    await upsertUserWithRole(connection, {
      name: '普通成员',
      email: process.env.SEED_READONLY_EMAIL || 'readonly@example.com',
      password: process.env.SEED_READONLY_PASSWORD || 'readonly123',
      department: '生产技术',
      section: '采煤管理室',
    }, readOnlyRoleId, defaultCompany.id);
    await upsertLibraryDocuments(connection, adminInfo.userId, defaultCompany.id);
    return adminInfo;
  });

  console.log('MySQL seed completed.');
  console.log(`Admin: ${admin.email}`);
  console.log(`Password: ${admin.password}`);
};

seed()
  .catch((error) => {
    console.error('MySQL seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
