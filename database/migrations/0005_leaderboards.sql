-- migrate:up
CREATE TABLE leaderboard_periods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  starts_at DATETIME(6) NOT NULL,
  ends_at DATETIME(6) NOT NULL,
  grace_ends_at DATETIME(6) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled',
  finalized_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_leaderboard_periods_public_id (public_id),
  UNIQUE KEY uq_leaderboard_periods_window (starts_at, ends_at),
  KEY idx_leaderboard_periods_status_start (status, starts_at),
  CONSTRAINT chk_leaderboard_period_times CHECK (starts_at < ends_at AND ends_at <= grace_ends_at),
  CONSTRAINT chk_leaderboard_period_status CHECK (status IN ('scheduled', 'open', 'grace', 'review', 'finalized'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE game_sessions
  ADD COLUMN leaderboard_period_id BIGINT UNSIGNED NULL AFTER game_version_id,
  ADD KEY idx_game_sessions_period_status (leaderboard_period_id, status),
  ADD CONSTRAINT fk_game_sessions_period FOREIGN KEY (leaderboard_period_id) REFERENCES leaderboard_periods (id) ON DELETE RESTRICT;

CREATE TABLE leaderboard_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  leaderboard_period_id BIGINT UNSIGNED NOT NULL,
  game_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  verified_score_id BIGINT UNSIGNED NOT NULL,
  best_score BIGINT UNSIGNED NOT NULL,
  finished_at DATETIME(6) NOT NULL,
  session_public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_leaderboard_entry_player (leaderboard_period_id, game_id, user_id),
  UNIQUE KEY uq_leaderboard_entry_score (verified_score_id),
  KEY idx_leaderboard_rank (leaderboard_period_id, game_id, best_score, finished_at, session_public_id),
  CONSTRAINT fk_leaderboard_entries_period FOREIGN KEY (leaderboard_period_id) REFERENCES leaderboard_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_leaderboard_entries_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE RESTRICT,
  CONSTRAINT fk_leaderboard_entries_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_leaderboard_entries_score FOREIGN KEY (verified_score_id) REFERENCES verified_scores (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leaderboard_placements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  leaderboard_period_id BIGINT UNSIGNED NOT NULL,
  game_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  leaderboard_entry_id BIGINT UNSIGNED NOT NULL,
  placement SMALLINT UNSIGNED NOT NULL,
  finalized_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_leaderboard_placement_rank (leaderboard_period_id, game_id, placement),
  UNIQUE KEY uq_leaderboard_placement_player (leaderboard_period_id, game_id, user_id),
  UNIQUE KEY uq_leaderboard_placement_entry (leaderboard_entry_id),
  CONSTRAINT fk_leaderboard_placements_period FOREIGN KEY (leaderboard_period_id) REFERENCES leaderboard_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_leaderboard_placements_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE RESTRICT,
  CONSTRAINT fk_leaderboard_placements_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_leaderboard_placements_entry FOREIGN KEY (leaderboard_entry_id) REFERENCES leaderboard_entries (id) ON DELETE RESTRICT,
  CONSTRAINT chk_leaderboard_placement CHECK (placement BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE IF EXISTS leaderboard_placements;
DROP TABLE IF EXISTS leaderboard_entries;
ALTER TABLE game_sessions DROP FOREIGN KEY fk_game_sessions_period;
ALTER TABLE game_sessions DROP INDEX idx_game_sessions_period_status;
ALTER TABLE game_sessions DROP COLUMN leaderboard_period_id;
DROP TABLE IF EXISTS leaderboard_periods;
