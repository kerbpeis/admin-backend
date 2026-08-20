CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'file',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_permissions_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  invite_code VARCHAR(64) NOT NULL,
  email_domains JSON NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_companies_invite_code (invite_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  department VARCHAR(100) NOT NULL,
  section VARCHAR(100) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  platform_role VARCHAR(20) NOT NULL DEFAULT 'member',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  parent_department_id BIGINT UNSIGNED NULL,
  type ENUM('profession', 'department', 'section') NOT NULL DEFAULT 'department',
  order_index INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_departments_company_type_name (company_id, type, name),
  KEY idx_departments_company (company_id),
  KEY idx_departments_parent (parent_department_id),
  CONSTRAINT fk_departments_parent FOREIGN KEY (parent_department_id) REFERENCES departments (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS department_managers (
  department_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (department_id, user_id),
  CONSTRAINT fk_department_managers_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE CASCADE,
  CONSTRAINT fk_department_managers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_points (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  department_id BIGINT UNSIGNED NULL,
  profession_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  file_count INT NOT NULL DEFAULT 0,
  icon VARCHAR(80) NOT NULL DEFAULT 'book-open-variant',
  category VARCHAR(100) NULL,
  tags TEXT NULL,
  visibility ENUM('public', 'department', 'section', 'private') NOT NULL DEFAULT 'department',
  view_count INT NOT NULL DEFAULT 0,
  status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_knowledge_points_company (company_id),
  KEY idx_knowledge_points_department (department_id),
  KEY idx_knowledge_points_profession (profession_id),
  KEY idx_knowledge_points_creator (created_by),
  CONSTRAINT fk_knowledge_points_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL,
  CONSTRAINT fk_knowledge_points_profession FOREIGN KEY (profession_id) REFERENCES departments (id) ON DELETE SET NULL,
  CONSTRAINT fk_knowledge_points_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NULL,
  name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  path VARCHAR(500) NOT NULL,
  size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mime_type VARCHAR(180) NOT NULL DEFAULT 'application/octet-stream',
  extension VARCHAR(40) NULL,
  description TEXT NULL,
  category VARCHAR(100) NULL,
  knowledge_point_id BIGINT UNSIGNED NULL,
  department_id BIGINT UNSIGNED NULL,
  profession_id BIGINT UNSIGNED NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  current_version INT NOT NULL DEFAULT 1,
  version_label VARCHAR(80) NOT NULL DEFAULT 'V1',
  status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
  visibility ENUM('public', 'department', 'section', 'private') NOT NULL DEFAULT 'department',
  download_count INT NOT NULL DEFAULT 0,
  view_count INT NOT NULL DEFAULT 0,
  tags TEXT NULL,
  effective_date DATE NULL,
  review_date DATE NULL,
  issuer VARCHAR(100) NULL,
  approver VARCHAR(100) NULL,
  icon VARCHAR(80) NOT NULL DEFAULT 'file-document-outline',
  color VARCHAR(24) NOT NULL DEFAULT '#1F6F8B',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_files_company (company_id),
  KEY idx_files_department (department_id),
  KEY idx_files_profession (profession_id),
  KEY idx_files_knowledge_point (knowledge_point_id),
  KEY idx_files_uploader_status (uploaded_by, status),
  KEY idx_files_status_company (status, company_id),
  -- 全文搜索索引（WITH PARSER ngram 支持中文分词，需 MySQL >= 5.7.6）
  FULLTEXT KEY ft_files_search (name, description, tags) WITH PARSER ngram,
  CONSTRAINT fk_files_knowledge_point FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points (id) ON DELETE SET NULL,
  CONSTRAINT fk_files_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL,
  CONSTRAINT fk_files_profession FOREIGN KEY (profession_id) REFERENCES departments (id) ON DELETE SET NULL,
  CONSTRAINT fk_files_uploader FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id BIGINT UNSIGNED NOT NULL,
  version INT NOT NULL,
  version_label VARCHAR(80) NULL,
  path VARCHAR(500) NOT NULL,
  size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(180) NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  change_log TEXT NULL,
  hash VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_file_versions_file_version (file_id, version),
  CONSTRAINT fk_file_versions_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE,
  CONSTRAINT fk_file_versions_uploader FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_content_chunks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id BIGINT UNSIGNED NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  char_count INT UNSIGNED NOT NULL DEFAULT 0,
  embedding JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_file_content_chunks_file_index (file_id, chunk_index),
  KEY idx_file_content_chunks_file (file_id),
  CONSTRAINT fk_file_content_chunks_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_clauses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id BIGINT UNSIGNED NOT NULL,
  clause_no VARCHAR(40) NOT NULL,
  clause_no_num INT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_file_clauses_file (file_id),
  KEY idx_file_clauses_no_num (clause_no_num),
  CONSTRAINT fk_file_clauses_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_favorites (
  file_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (file_id, user_id),
  CONSTRAINT fk_file_favorites_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE,
  CONSTRAINT fk_file_favorites_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(80) NULL,
  resource_name VARCHAR(255) NULL,
  status ENUM('success', 'failure', 'denied') NOT NULL DEFAULT 'success',
  generator VARCHAR(40) NULL,
  model VARCHAR(100) NULL,
  prompt_tokens INT UNSIGNED NULL,
  completion_tokens INT UNSIGNED NULL,
  ip_address VARCHAR(80) NULL,
  user_agent VARCHAR(500) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_logs_actor (actor_id),
  KEY idx_audit_logs_resource (resource_type, resource_id),
  KEY idx_audit_logs_action (action),
  KEY idx_audit_logs_created_at (created_at),
  KEY idx_audit_logs_generator (actor_id, action, generator, created_at),
  KEY idx_audit_logs_model (actor_id, action, model, created_at),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_point_favorites (
  knowledge_point_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (knowledge_point_id, user_id),
  CONSTRAINT fk_knowledge_point_favorites_kp FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points (id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_point_favorites_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_states (
  user_id BIGINT UNSIGNED NOT NULL,
  state_json JSON NOT NULL,
  client_updated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_partner_states_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_conversations (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(100) NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'direct',
  title VARCHAR(255) NULL,
  task_local_id VARCHAR(100) NULL,
  member_ids JSON NULL,
  unread_count INT NOT NULL DEFAULT 0,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  muted TINYINT(1) NOT NULL DEFAULT 0,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  mentioned TINYINT(1) NOT NULL DEFAULT 0,
  last_read_at TIMESTAMP NULL,
  source_updated_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_partner_conversations_task (user_id, task_local_id),
  KEY idx_partner_conversations_updated (user_id, source_updated_at),
  CONSTRAINT fk_partner_conversations_state FOREIGN KEY (user_id) REFERENCES partner_states (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_tasks (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'pending',
  priority VARCHAR(40) NULL,
  requester_local_id VARCHAR(100) NULL,
  conversation_local_id VARCHAR(100) NULL,
  member_ids JSON NULL,
  skill_tags JSON NULL,
  match_scope VARCHAR(60) NULL,
  published_to_pool TINYINT(1) NOT NULL DEFAULT 0,
  deadline_at TIMESTAMP NULL,
  source_created_at TIMESTAMP NULL,
  source_updated_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_partner_tasks_status (user_id, status),
  KEY idx_partner_tasks_conversation (user_id, conversation_local_id),
  KEY idx_partner_tasks_deadline (user_id, deadline_at),
  CONSTRAINT fk_partner_tasks_state FOREIGN KEY (user_id) REFERENCES partner_states (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_messages (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(100) NOT NULL,
  conversation_local_id VARCHAR(100) NOT NULL,
  sender_local_id VARCHAR(100) NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'text',
  body TEXT NULL,
  read_by JSON NULL,
  source_created_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_partner_messages_conversation (user_id, conversation_local_id, source_created_at),
  KEY idx_partner_messages_sender (user_id, sender_local_id),
  CONSTRAINT fk_partner_messages_state FOREIGN KEY (user_id) REFERENCES partner_states (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_notifications (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(100) NOT NULL,
  type VARCHAR(80) NOT NULL,
  task_local_id VARCHAR(100) NULL,
  status VARCHAR(60) NULL,
  title VARCHAR(255) NULL,
  summary TEXT NULL,
  recipient_ids JSON NULL,
  source_created_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_partner_notifications_task (user_id, task_local_id),
  KEY idx_partner_notifications_status (user_id, status),
  CONSTRAINT fk_partner_notifications_state FOREIGN KEY (user_id) REFERENCES partner_states (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_bookmarks (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(120) NOT NULL,
  name VARCHAR(80) NOT NULL,
  icon VARCHAR(80) NOT NULL DEFAULT 'folder-outline',
  color VARCHAR(24) NOT NULL DEFAULT '#2F9E7E',
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  order_index INT NOT NULL DEFAULT 0,
  source_created_at TIMESTAMP NULL,
  source_updated_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_private_bookmarks_user_order (user_id, order_index),
  CONSTRAINT fk_private_bookmarks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_folders (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(120) NOT NULL,
  bookmark_local_id VARCHAR(120) NULL,
  name VARCHAR(120) NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  source_created_at TIMESTAMP NULL,
  source_updated_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_private_folders_bookmark (user_id, bookmark_local_id, order_index),
  CONSTRAINT fk_private_folders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_knowledge_items (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(120) NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'reference',
  title VARCHAR(255) NOT NULL,
  source_title VARCHAR(255) NULL,
  reference_kind VARCHAR(60) NULL,
  document_id VARCHAR(120) NULL,
  group_id VARCHAR(120) NULL,
  file_id VARCHAR(120) NULL,
  bookmark_ids JSON NULL,
  folder_ids JSON NULL,
  tags JSON NULL,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  source_created_at TIMESTAMP NULL,
  source_updated_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_private_items_type (user_id, type),
  KEY idx_private_items_reference (user_id, reference_kind, document_id, group_id, file_id),
  KEY idx_private_items_updated (user_id, source_updated_at),
  CONSTRAINT fk_private_knowledge_items_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_reading_history (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(120) NOT NULL,
  title VARCHAR(255) NOT NULL,
  owner VARCHAR(160) NULL,
  category VARCHAR(120) NULL,
  opened_at TIMESTAMP NULL,
  progress_page INT NULL,
  progress_total_pages INT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_private_reading_opened (user_id, opened_at),
  CONSTRAINT fk_private_reading_history_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_learning_progress (
  user_id BIGINT UNSIGNED NOT NULL,
  document_id VARCHAR(120) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'not_started',
  progress_percent INT NOT NULL DEFAULT 0,
  due_at TIMESTAMP NULL,
  last_studied_at TIMESTAMP NULL,
  review_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, document_id),
  KEY idx_private_learning_status (user_id, status, updated_at),
  KEY idx_private_learning_due (user_id, due_at),
  CONSTRAINT fk_private_learning_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_interactions (
  user_id BIGINT UNSIGNED NOT NULL,
  local_id VARCHAR(120) NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'question',
  question TEXT NULL,
  title VARCHAR(255) NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'answered',
  referenced_document_id VARCHAR(120) NULL,
  source_created_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, local_id),
  KEY idx_agent_interactions_created (user_id, source_created_at),
  KEY idx_agent_interactions_type (user_id, type),
  CONSTRAINT fk_agent_interactions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_share_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  private_item_local_id VARCHAR(120) NULL,
  title VARCHAR(255) NOT NULL,
  source_title VARCHAR(255) NULL,
  item_type VARCHAR(40) NOT NULL DEFAULT 'reference',
  target_profession VARCHAR(120) NULL,
  target_section VARCHAR(120) NULL,
  target_category VARCHAR(120) NULL,
  reason TEXT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  reviewer_id BIGINT UNSIGNED NULL,
  promoted_file_id BIGINT UNSIGNED NULL,
  review_note TEXT NULL,
  reviewed_at TIMESTAMP NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_private_share_requests_user (user_id, status, created_at),
  KEY idx_private_share_requests_status (status, created_at),
  KEY idx_private_share_requests_reviewer (reviewer_id, reviewed_at),
  KEY idx_private_share_requests_reviewer_status (reviewer_id, status, created_at),
  KEY idx_private_share_requests_promoted (promoted_file_id),
  CONSTRAINT fk_private_share_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_private_share_requests_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_private_share_requests_promoted_file FOREIGN KEY (promoted_file_id) REFERENCES files (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 刷题题库：company_id 为 NULL 表示平台公共题库
CREATE TABLE IF NOT EXISTS quiz_questions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NULL,
  type ENUM('single', 'multi', 'judge') NOT NULL DEFAULT 'single',
  stem TEXT NOT NULL,
  options JSON NULL,
  answer VARCHAR(20) NOT NULL,
  explanation TEXT NULL,
  source ENUM('ai', 'import', 'upload') NOT NULL DEFAULT 'upload',
  source_ref VARCHAR(255) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_quiz_questions_company (company_id, status),
  CONSTRAINT fk_quiz_questions_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_quiz_questions_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 答题记录
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  chosen VARCHAR(20) NOT NULL,
  correct TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_quiz_attempts_user_date (user_id, created_at),
  KEY idx_quiz_attempts_question (question_id),
  CONSTRAINT fk_quiz_attempts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_quiz_attempts_question FOREIGN KEY (question_id) REFERENCES quiz_questions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 运行时配置：支持通过管理后台动态调整 LLM / Tika / Embedding 等开关与参数
CREATE TABLE IF NOT EXISTS runtime_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  config_key VARCHAR(100) NOT NULL,
  config_value JSON NULL,
  description VARCHAR(255) NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_runtime_settings_key (config_key),
  KEY idx_runtime_settings_updated_by (updated_by),
  CONSTRAINT fk_runtime_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
