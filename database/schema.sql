-- VitePress documentation versioning schema.
-- Node and edge identities are stable; per-release snapshots are immutable once
-- published. Draft edits live in revisions and are never read by public builds.

create extension if not exists pgcrypto;

create table product_release (
  release_id text primary key,
  name text not null,
  status text not null check (status in ('archived', 'stable', 'latest', 'draft')),
  visibility text not null check (visibility in ('public', 'private')),
  access_state text not null check (access_state in ('granted', 'revoked')),
  route_base jsonb not null default '{"zh-CN":"","en-US":"/en"}'::jsonb,
  created_at timestamptz not null default now()
);

create table doc_node (
  node_id text not null,
  locale text not null check (locale in ('zh-CN', 'en-US')),
  product text not null default 'default',
  title text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (product, locale, node_id)
);

create table doc_node_release (
  product text not null,
  locale text not null check (locale in ('zh-CN', 'en-US')),
  node_id text not null,
  release_id text not null references product_release(release_id),
  chapter text not null,
  path text not null check (path like '/%'),
  anchors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (release_id, locale, node_id),
  foreign key (product, locale, node_id) references doc_node(product, locale, node_id),
  unique (release_id, locale, path)
);

create table doc_migration_edge (
  edge_id uuid primary key default gen_random_uuid(),
  from_release_id text not null references product_release(release_id),
  from_locale text not null,
  from_node_id text not null,
  to_release_id text not null references product_release(release_id),
  to_locale text not null,
  to_node_id text not null,
  relation_type text not null check (relation_type in ('same', 'split', 'merge', 'renamed', 'private')),
  anchor_map jsonb not null default '{}'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (from_release_id <> to_release_id),
  unique (from_release_id, from_locale, from_node_id, to_release_id, to_locale, to_node_id),
  foreign key (from_release_id, from_locale, from_node_id)
    references doc_node_release(release_id, locale, node_id),
  foreign key (to_release_id, to_locale, to_node_id)
    references doc_node_release(release_id, locale, node_id)
);

create index migration_edge_from_idx
  on doc_migration_edge(from_release_id, from_locale, from_node_id);
create index migration_edge_to_idx
  on doc_migration_edge(to_release_id, to_locale, to_node_id);

create table term (
  term_id text not null,
  locale text not null,
  product text not null default 'default',
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (product, locale, term_id)
);

create table term_release (
  release_id text not null references product_release(release_id),
  locale text not null,
  term_id text not null,
  product text not null default 'default',
  display_name text not null,
  definition text not null,
  primary key (release_id, locale, term_id),
  foreign key (product, locale, term_id) references term(product, locale, term_id),
  -- Duplicate display names are allowed; term_id is the disambiguation key.
  unique (release_id, locale, term_id)
);

create index term_release_name_idx on term_release(release_id, locale, display_name);

create table editor (
  editor_id uuid primary key default gen_random_uuid(),
  email text not null unique
);

create table release_scope (
  release_id text not null references product_release(release_id),
  editor_id uuid not null references editor(editor_id),
  scope text not null check (scope in ('view', 'edit', 'publish', 'admin')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (release_id, editor_id, scope)
);

create table doc_revision (
  revision_id uuid primary key default gen_random_uuid(),
  product text not null,
  locale text not null,
  node_id text not null,
  release_id text not null references product_release(release_id),
  editor_id uuid not null references editor(editor_id),
  commit_sha text,
  content text not null,
  status text not null check (status in ('draft', 'submitted', 'published', 'withdrawn')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  foreign key (product, locale, node_id) references doc_node(product, locale, node_id)
);

create index doc_revision_node_idx
  on doc_revision(release_id, locale, node_id, status, published_at desc);

create table build_catalog (
  catalog_id uuid primary key default gen_random_uuid(),
  release_id text references product_release(release_id),
  commit_sha text not null,
  root_tree text not null,
  output_uri text not null,
  source_scope text not null check (source_scope in ('HEAD', 'working-tree')),
  status text not null check (status in ('building', 'succeeded', 'failed')),
  diagnostics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (commit_sha, release_id)
);

-- Public API function: it only emits public/granted releases. Revoking a row
-- immediately removes the release and its terms from subsequent API responses.
create or replace function public_version_catalog()
returns jsonb
language sql
stable as $$
  select jsonb_build_object(
    'releases', (
      select jsonb_agg(jsonb_build_object(
        'id', r.release_id,
        'name', r.name,
        'status', r.status,
        'visibility', r.visibility,
        'access', r.access_state,
        'routeBase', r.route_base,
        'selectable', true,
        'disabledReason', ''
      ) order by r.created_at desc)
      from product_release r
      where r.visibility = 'public' and r.access_state = 'granted'
    ),
    'nodes', (
      select jsonb_agg(to_jsonb(n) - 'product')
      from doc_node_release n
      join product_release r on r.release_id = n.release_id
      where r.visibility = 'public' and r.access_state = 'granted'
    ),
    'edges', (
      select jsonb_agg(to_jsonb(e) - 'edge_id' - 'created_at')
      from doc_migration_edge e
      join product_release fr on fr.release_id = e.from_release_id
      join product_release tr on tr.release_id = e.to_release_id
      where fr.visibility = 'public' and fr.access_state = 'granted'
        and tr.visibility = 'public' and tr.access_state = 'granted'
    )
  )
$$;
