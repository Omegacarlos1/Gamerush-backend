-- migrate:up
CREATE TABLE games (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  active_version_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_games_public_id (public_id),
  UNIQUE KEY uq_games_slug (slug),
  KEY idx_games_status (status),
  CONSTRAINT chk_games_status CHECK (status IN ('draft', 'active', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  game_id BIGINT UNSIGNED NOT NULL,
  version_number VARCHAR(32) NOT NULL,
  rules_version VARCHAR(32) NOT NULL,
  scoring_rules JSON NOT NULL,
  max_session_seconds SMALLINT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  published_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_game_versions_public_id (public_id),
  UNIQUE KEY uq_game_versions_game_number (game_id, version_number),
  KEY idx_game_versions_game_status (game_id, status),
  CONSTRAINT fk_game_versions_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE RESTRICT,
  CONSTRAINT chk_game_versions_duration CHECK (max_session_seconds BETWEEN 1 AND 3600),
  CONSTRAINT chk_game_versions_status CHECK (status IN ('draft', 'published', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE games
  ADD CONSTRAINT fk_games_active_version FOREIGN KEY (active_version_id) REFERENCES game_versions (id) ON DELETE SET NULL;

CREATE TABLE characters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  game_id BIGINT UNSIGNED NOT NULL,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  unlock_level SMALLINT UNSIGNED NOT NULL,
  is_cosmetic_only TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_characters_public_id (public_id),
  UNIQUE KEY uq_characters_game_slug (game_id, slug),
  KEY idx_characters_game_level (game_id, unlock_level),
  CONSTRAINT fk_characters_game FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE RESTRICT,
  CONSTRAINT chk_characters_unlock_level CHECK (unlock_level >= 1),
  CONSTRAINT chk_characters_cosmetic CHECK (is_cosmetic_only = 1),
  CONSTRAINT chk_characters_status CHECK (status IN ('active', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- migrate:down
DROP TABLE IF EXISTS characters;
ALTER TABLE games DROP FOREIGN KEY fk_games_active_version;
DROP TABLE IF EXISTS game_versions;
DROP TABLE IF EXISTS games;
