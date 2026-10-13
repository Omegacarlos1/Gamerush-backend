-- migrate:up
CREATE TABLE moderation_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NULL,
  game_session_id BIGINT UNSIGNED NULL,
  verified_score_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(40) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_moderation_actions_public_id (public_id),
  KEY idx_moderation_target_user_time (target_user_id, created_at),
  KEY idx_moderation_session_time (game_session_id, created_at),
  CONSTRAINT fk_moderation_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_moderation_target FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_moderation_session FOREIGN KEY (game_session_id) REFERENCES game_sessions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_moderation_score FOREIGN KEY (verified_score_id) REFERENCES verified_scores (id) ON DELETE RESTRICT,
  CONSTRAINT chk_moderation_action CHECK (action_type IN ('flag_session', 'clear_session', 'disqualify_score', 'restore_score', 'suspend_user', 'restore_user'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_reference VARCHAR(191) NOT NULL,
  reason VARCHAR(1000) NULL,
  event_data JSON NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip_address VARBINARY(16) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_audit_events_public_id (public_id),
  KEY idx_admin_audit_actor_time (actor_user_id, created_at),
  KEY idx_admin_audit_target_time (target_type, target_reference, created_at),
  CONSTRAINT fk_admin_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER trg_admin_audit_prevent_update
BEFORE UPDATE ON admin_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'admin_audit_events is append-only';

CREATE TRIGGER trg_admin_audit_prevent_delete
BEFORE DELETE ON admin_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'admin_audit_events is append-only';

-- migrate:down
DROP TRIGGER IF EXISTS trg_admin_audit_prevent_delete;
DROP TRIGGER IF EXISTS trg_admin_audit_prevent_update;
DROP TABLE IF EXISTS admin_audit_events;
DROP TABLE IF EXISTS moderation_actions;
