-- migrate:up
CREATE TABLE progression_policy_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(32) NOT NULL,
  score_points_per_xp INT UNSIGNED NOT NULL,
  xp_per_level INT UNSIGNED NOT NULL,
  starting_level SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  rounding_mode VARCHAR(16) NOT NULL DEFAULT 'floor',
  effective_at DATETIME(6) NOT NULL,
  retired_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_progression_policy_version (version),
  CONSTRAINT chk_progression_score_ratio CHECK (score_points_per_xp > 0),
  CONSTRAINT chk_progression_level_ratio CHECK (xp_per_level > 0),
  CONSTRAINT chk_progression_start_level CHECK (starting_level >= 1),
  CONSTRAINT chk_progression_rounding CHECK (rounding_mode IN ('floor'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(80) NULL,
  bio VARCHAR(500) NULL,
  total_xp BIGINT UNSIGNED NOT NULL DEFAULT 0,
  level INT UNSIGNED NOT NULL DEFAULT 1,
  equipped_character_id BIGINT UNSIGNED NULL,
  all_time_best_score BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  KEY idx_player_profiles_level_xp (level, total_xp),
  CONSTRAINT fk_player_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_player_profiles_character FOREIGN KEY (equipped_character_id) REFERENCES characters (id) ON DELETE SET NULL,
  CONSTRAINT chk_player_profiles_level CHECK (level >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE xp_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_reference VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metadata JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_xp_ledger_idempotency (idempotency_key),
  KEY idx_xp_ledger_user_created (user_id, created_at, id),
  KEY idx_xp_ledger_source (source_type, source_reference),
  CONSTRAINT fk_xp_ledger_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_xp_ledger_amount CHECK (amount <> 0),
  CONSTRAINT chk_xp_ledger_source CHECK (source_type IN ('gameplay', 'leaderboard_reward', 'achievement', 'admin_adjustment', 'correction'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER trg_xp_ledger_prevent_update
BEFORE UPDATE ON xp_ledger
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_ledger is append-only';

CREATE TRIGGER trg_xp_ledger_prevent_delete
BEFORE DELETE ON xp_ledger
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_ledger is append-only';

CREATE TABLE player_character_unlocks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_reference VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  unlocked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_character (user_id, character_id),
  UNIQUE KEY uq_character_unlock_idempotency (idempotency_key),
  KEY idx_character_unlock_user_time (user_id, unlocked_at),
  CONSTRAINT fk_character_unlock_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_character_unlock_character FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE RESTRICT,
  CONSTRAINT chk_character_unlock_source CHECK (source_type IN ('starter', 'level', 'reward', 'admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE IF EXISTS player_character_unlocks;
DROP TRIGGER IF EXISTS trg_xp_ledger_prevent_delete;
DROP TRIGGER IF EXISTS trg_xp_ledger_prevent_update;
DROP TABLE IF EXISTS xp_ledger;
DROP TABLE IF EXISTS player_profiles;
DROP TABLE IF EXISTS progression_policy_versions;
