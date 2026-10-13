-- migrate:up
CREATE TABLE achievements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  criteria JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_achievements_public_id (public_id),
  UNIQUE KEY uq_achievements_code (code),
  CONSTRAINT chk_achievements_status CHECK (status IN ('active', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_achievements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  achievement_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_reference VARCHAR(191) NOT NULL,
  earned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_achievement (user_id, achievement_id),
  UNIQUE KEY uq_player_achievement_idempotency (idempotency_key),
  KEY idx_player_achievements_time (user_id, earned_at),
  CONSTRAINT fk_player_achievements_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_player_achievements_achievement FOREIGN KEY (achievement_id) REFERENCES achievements (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE badges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_badges_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reward_policy_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  effective_at DATETIME(6) NOT NULL,
  retired_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reward_policy_version (version),
  CONSTRAINT chk_reward_policy_status CHECK (status IN ('active', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leaderboard_reward_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reward_policy_version_id BIGINT UNSIGNED NOT NULL,
  placement_from SMALLINT UNSIGNED NOT NULL,
  placement_to SMALLINT UNSIGNED NOT NULL,
  xp_amount BIGINT UNSIGNED NOT NULL,
  badge_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_leaderboard_reward_rule_range (reward_policy_version_id, placement_from, placement_to),
  CONSTRAINT fk_reward_rules_policy FOREIGN KEY (reward_policy_version_id) REFERENCES reward_policy_versions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_rules_badge FOREIGN KEY (badge_id) REFERENCES badges (id) ON DELETE RESTRICT,
  CONSTRAINT chk_reward_rule_placements CHECK (placement_from BETWEEN 1 AND 10 AND placement_to BETWEEN placement_from AND 10),
  CONSTRAINT chk_reward_rule_xp CHECK (xp_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_badges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  badge_id BIGINT UNSIGNED NOT NULL,
  source_reference VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  awarded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_badge_source (user_id, badge_id, source_reference),
  UNIQUE KEY uq_player_badge_idempotency (idempotency_key),
  CONSTRAINT fk_player_badges_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_player_badges_badge FOREIGN KEY (badge_id) REFERENCES badges (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reward_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  leaderboard_period_id BIGINT UNSIGNED NULL,
  leaderboard_placement_id BIGINT UNSIGNED NULL,
  reward_rule_id BIGINT UNSIGNED NULL,
  reward_type VARCHAR(32) NOT NULL,
  xp_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  badge_id BIGINT UNSIGNED NULL,
  xp_ledger_id BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  granted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reward_grants_idempotency (idempotency_key),
  UNIQUE KEY uq_reward_grants_period_player_type (leaderboard_period_id, user_id, reward_type),
  KEY idx_reward_grants_user_time (user_id, granted_at),
  CONSTRAINT fk_reward_grants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_grants_period FOREIGN KEY (leaderboard_period_id) REFERENCES leaderboard_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_grants_placement FOREIGN KEY (leaderboard_placement_id) REFERENCES leaderboard_placements (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_grants_rule FOREIGN KEY (reward_rule_id) REFERENCES leaderboard_reward_rules (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_grants_badge FOREIGN KEY (badge_id) REFERENCES badges (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reward_grants_xp FOREIGN KEY (xp_ledger_id) REFERENCES xp_ledger (id) ON DELETE RESTRICT,
  CONSTRAINT chk_reward_grants_type CHECK (reward_type IN ('leaderboard', 'achievement', 'admin')),
  CONSTRAINT chk_reward_grants_value CHECK (xp_amount > 0 OR badge_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE IF EXISTS reward_grants;
DROP TABLE IF EXISTS player_badges;
DROP TABLE IF EXISTS leaderboard_reward_rules;
DROP TABLE IF EXISTS reward_policy_versions;
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS player_achievements;
DROP TABLE IF EXISTS achievements;
