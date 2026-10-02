-- ============================================================================
-- 版本化文档中心 · PostgreSQL 存储模型
--
-- 三类核心数据：
--   1) 稳定文档节点 doc_nodes —— 跨版本身份（同一逻辑章节的多版本行）
--   2) 迁移边     migration_edges / term_edges —— 相邻版本间的映射
--   3) 公开范围   release_scopes + grants —— 公开/私有/草稿与授权
-- 另含构建登记表 builds：每次构建绑定 git commit，支撑“构建任务产出绑定提交的目录”。
-- 所有迁移边只允许相邻版本（由 trigger 校验），从结构上杜绝跨版本跳跃数据。
-- ============================================================================

CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_versions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  version       TEXT NOT NULL,              -- semver，如 2.0.0、3.0.0-beta
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'public', 'private', 'archived')),
  label         TEXT,
  base_path     TEXT NOT NULL,
  released_at   DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, version)
);

-- 稳定文档节点：每版本一行，跨版本身份由 stable_node_id 表示
CREATE TABLE doc_nodes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id),
  stable_node_id  TEXT NOT NULL,            -- 跨版本稳定 ID（绝不使用标题匹配）
  version         TEXT NOT NULL,
  title           TEXT NOT NULL,
  path            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'published'
                  CHECK (status IN ('published', 'draft', 'archived')),
  scope_required  TEXT[],                   -- 节点级公开范围（私有章节）
  legacy_paths    TEXT[] NOT NULL DEFAULT '{}',
  applicable_range TEXT,                    -- 过时示例适用范围，如 <2.0.0
  superseded_by   TEXT,                     -- 替代入口 stable_node_id
  body_ref        TEXT,                     -- 正文对象存储键（草稿/发布分离）
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, version, stable_node_id)
);

-- 章节迁移边：仅相邻版本
CREATE TABLE migration_edges (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id),
  from_version    TEXT NOT NULL,
  to_version      TEXT NOT NULL,
  from_node_id    TEXT NOT NULL,
  to_node_id      TEXT,                     -- removed 时允许 NULL
  kind            TEXT NOT NULL
                  CHECK (kind IN ('identity', 'rename', 'split', 'merge', 'removed')),
  anchor_map      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 源锚点 -> 目标锚点（''=删除）
  blocks_map      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 折叠块 ID 映射
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 术语：跨版本身份由 stable_term_id 表示
CREATE TABLE terms (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id),
  stable_term_id  TEXT NOT NULL,
  version         TEXT NOT NULL,
  slug            TEXT NOT NULL,
  scope           TEXT,                     -- NULL=全局；重名时必须显式 scope
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'published',
  UNIQUE (product_id, version, stable_term_id),
  UNIQUE (product_id, version, slug, scope)
);

-- 术语迁移边
CREATE TABLE term_edges (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  from_version  TEXT NOT NULL,
  to_version    TEXT NOT NULL,
  from_term_id  TEXT NOT NULL,
  to_term_id    TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('identity', 'rename', 'split', 'merge', 'removed')),
  note          TEXT
);

-- 公开范围（角色/能力）
CREATE TABLE scopes (
  id    TEXT PRIMARY KEY,                   -- 如 beta-preview、internal
  label TEXT NOT NULL
);
CREATE TABLE version_scopes (
  product_id TEXT NOT NULL REFERENCES products(id),
  version    TEXT NOT NULL,
  scope_id   TEXT NOT NULL REFERENCES scopes(id),
  PRIMARY KEY (product_id, version, scope_id)
);
CREATE TABLE grants (
  subject    TEXT NOT NULL,                 -- 用户/团队标识
  scope_id   TEXT NOT NULL REFERENCES scopes(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,                   -- 撤权：置时间戳后立即不可见
  PRIMARY KEY (subject, scope_id)
);

-- 构建登记：目录绑定 commit
CREATE TABLE builds (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id),
  commit_sha   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('building', 'succeeded', 'failed')),
  issue_count  JSONB NOT NULL DEFAULT '{}'::jsonb,
  manifest_key TEXT,                        -- 产物对象存储键
  built_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
-- 每个产品的“当前可用快照”（索引重建失败时不移动指针）
CREATE TABLE current_build (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  build_id   BIGINT NOT NULL REFERENCES builds(id)
);

-- 索引
CREATE INDEX idx_nodes_lookup   ON doc_nodes(product_id, version, stable_node_id);
CREATE INDEX idx_nodes_path     ON doc_nodes(product_id, version, path);
CREATE INDEX idx_edges_from     ON migration_edges(product_id, from_version, from_node_id);
CREATE INDEX idx_edges_to       ON migration_edges(product_id, to_version, to_node_id);
CREATE INDEX idx_term_edges_from ON term_edges(product_id, from_version, from_term_id);

-- ============================================================================
-- 相邻版本约束 + 成对/同层数据的环防护
-- 环的完整检测（跨多跳回环）在应用层 validateGraph 中完成（见 core/graph.js），
-- 数据库层负责最基础的“边必须连在相邻发布版本之间”。
-- ============================================================================
CREATE OR REPLACE FUNCTION assert_adjacent_versions() RETURNS TRIGGER AS $$
DECLARE
  v_from DATE; v_to DATE;
  pos_from INT; pos_to INT;
BEGIN
  SELECT ord INTO pos_from FROM (
    SELECT version, ROW_NUMBER() OVER (ORDER BY
      string_to_array(regexp_replace(version, '[^0-9.]', '', 'g'), '.')::INT[]) AS ord
    FROM product_versions WHERE product_id = NEW.product_id AND status <> 'draft'
  ) t WHERE version = NEW.from_version;
  SELECT ord INTO pos_to FROM (
    SELECT version, ROW_NUMBER() OVER (ORDER BY
      string_to_array(regexp_replace(version, '[^0-9.]', '', 'g'), '.')::INT[]) AS ord
    FROM product_versions WHERE product_id = NEW.product_id AND status <> 'draft'
  ) t WHERE version = NEW.to_version;
  IF pos_from IS NULL OR pos_to IS NULL OR abs(pos_from - pos_to) <> 1 THEN
    RAISE EXCEPTION '迁移边 % 必须连接相邻版本（% -> %）', NEW.id, NEW.from_version, NEW.to_version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_edges_adjacent BEFORE INSERT OR UPDATE ON migration_edges
  FOR EACH ROW EXECUTE FUNCTION assert_adjacent_versions();
CREATE TRIGGER trg_term_edges_adjacent BEFORE INSERT OR UPDATE ON term_edges
  FOR EACH ROW EXECUTE FUNCTION assert_adjacent_versions();

-- 撤权即时生效的视图：当前有效授权
CREATE VIEW active_grants AS
  SELECT subject, scope_id FROM grants WHERE revoked_at IS NULL;

-- 读者可见版本视图：public，或 private 且仍持有全部所需 scope 的读者（查询时按 subject 过滤）
CREATE OR REPLACE FUNCTION visible_versions(p_subject TEXT)
RETURNS TABLE(product_id TEXT, version TEXT, status TEXT, base_path TEXT) AS $$
  SELECT v.product_id, v.version, v.status, v.base_path
  FROM product_versions v
  WHERE v.status = 'public'
     OR (v.status = 'private' AND NOT EXISTS (
          SELECT 1 FROM version_scopes vs
          WHERE vs.product_id = v.product_id AND vs.version = v.version
            AND NOT EXISTS (SELECT 1 FROM active_grants g
                            WHERE g.subject = p_subject AND g.scope_id = vs.scope_id)));
$$ LANGUAGE sql STABLE;
