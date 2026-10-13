-- migrate:up
CREATE TABLE game_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  game_version_id BIGINT UNSIGNED NOT NULL,
  mode VARCHAR(20) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'issued',
  seed_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_game_sessions_public_id (public_id),
  UNIQUE KEY uq_game_sessions_nonce_hash (nonce_hash),
  KEY idx_game_sessions_user_created (user_id, created_at),
  KEY idx_game_sessions_version_status (game_version_id, status),
  KEY idx_game_sessions_expiry_status (expires_at, status),
  CONSTRAINT fk_game_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_game_sessions_version FOREIGN KEY (game_version_id) REFERENCES game_versions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_game_sessions_mode CHECK (mode IN ('practice', 'ranked')),
  CONSTRAINT chk_game_sessions_status CHECK (status IN ('issued', 'active', 'submitted', 'accepted', 'rejected', 'expired', 'abandoned')),
  CONSTRAINT chk_game_sessions_times CHECK (expires_at > started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_session_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_session_id BIGINT UNSIGNED NOT NULL,
  sequence_number INT UNSIGNED NOT NULL,
  simulation_tick BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  event_payload JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_game_session_event_sequence (game_session_id, sequence_number),
  KEY idx_game_session_events_tick (game_session_id, simulation_tick),
  CONSTRAINT fk_game_session_events_session FOREIGN KEY (game_session_id) REFERENCES game_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE score_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  game_session_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  claimed_score BIGINT UNSIGNED NULL,
  claimed_metres BIGINT UNSIGNED NULL,
  claimed_coins INT UNSIGNED NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  rejection_code VARCHAR(64) NULL,
  replay_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_score_submissions_public_id (public_id),
  UNIQUE KEY uq_score_submissions_idempotency (idempotency_key),
  UNIQUE KEY uq_score_submissions_session_digest (game_session_id, replay_digest),
  KEY idx_score_submissions_session_status (game_session_id, status),
  KEY idx_score_submissions_status_time (status, submitted_at),
  CONSTRAINT fk_score_submissions_session FOREIGN KEY (game_session_id) REFERENCES game_sessions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_score_submissions_status CHECK (status IN ('pending', 'accepted', 'rejected', 'review'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE verified_scores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  score_submission_id BIGINT UNSIGNED NOT NULL,
  game_session_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  game_id BIGINT UNSIGNED NOT NULL,
  verified_metres BIGINT UNSIGNED NOT NULL,
  verified_coins INT UNSIGNED NOT NULL,
  score BIGINT UNSIGNED NOT NULL,
  finished_at DATETIME(6) NOT NULL,
  verified_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_disqualified TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_verified_scores_public_id (public_id),
  UNIQUE KEY uq_verified_scores_submission (score_submission_id),
  UNIQUE KEY uq_verified_scores_session (game_session_id),
  KEY idx_verified_scores_user_game (user_id, game_id, score),
  KEY idx_verified_scores_game_finish (game_id, finished_at),
  CONSTRAINT fk_verified_scores_submission FOREIGN KEY (score_submission_id) REFERENCES score_submissions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_verified_scores_session FOREIGN KEY (game_session_id) REFERENCES game_sessions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_verified_scores_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_verified_scores_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE RESTRICT,
  CONSTRAINT chk_verified_scores_disqualified CHECK (is_disqualified IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE IF EXISTS verified_scores;
DROP TABLE IF EXISTS score_submissions;
DROP TABLE IF EXISTS game_session_events;
DROP TABLE IF EXISTS game_sessions;
