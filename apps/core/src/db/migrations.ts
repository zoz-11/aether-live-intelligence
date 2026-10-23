/**
 * Ordered, append-only migrations. Never edit an applied migration; add a new one.
 * Works on PGlite (embedded) and on any Postgres 14+ (for example Supabase).
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'core',
    sql: `
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists secrets (
  name text primary key,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table if not exists conversations (
  id text primary key,
  title text,
  kind text not null default 'chat',
  summary text,
  summary_upto bigint not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  seq bigserial,
  role text not null,
  channel text not null default 'text',
  content text not null default '',
  tool_calls jsonb,
  tool_call_id text,
  tool_name text,
  cards jsonb,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_seq on messages(conversation_id, seq);
create table if not exists facts (
  id text primary key,
  text text not null,
  kind text not null default 'note',
  source text,
  pinned boolean not null default false,
  uses integer not null default 0,
  embedding jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists facts_fts on facts using gin (to_tsvector('simple', text));
create table if not exists memory_files (
  name text primary key,
  content text not null,
  updated_at timestamptz not null default now()
);
create table if not exists plugin_state (
  id text primary key,
  enabled boolean not null,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists approvals (
  id text primary key,
  kind text not null default 'tool',
  tool text not null,
  action text,
  risk text not null,
  summary text not null,
  args jsonb,
  conversation_id text,
  task_id text,
  channel text,
  status text not null default 'pending',
  decision text,
  input_schema jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists approvals_status on approvals(status, created_at);
create table if not exists grants (
  id text primary key,
  tool text not null,
  action text not null default '',
  note text,
  created_at timestamptz not null default now()
);
create table if not exists activity (
  id bigserial primary key,
  ts timestamptz not null default now(),
  kind text not null,
  title text not null,
  detail jsonb,
  conversation_id text,
  task_id text,
  level text not null default 'info'
);
create index if not exists activity_ts on activity(ts desc);
create table if not exists app_items (
  collection text not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create table if not exists tasks (
  id text primary key,
  title text not null,
  goal text not null,
  status text not null default 'queued',
  schedule text,
  schedule_kind text,
  next_run_at timestamptz,
  last_run_at timestamptz,
  conversation_id text,
  result text,
  error text,
  runs integer not null default 0,
  notify boolean not null default true,
  origin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_due on tasks(status, next_run_at);
`,
  },
  {
    id: 2,
    name: 'identity',
    sql: `
create table if not exists mail_messages (
  id text primary key,
  direction text not null,
  status text not null,
  message_id text,
  in_reply_to text,
  thread_id text,
  from_addr text,
  from_name text,
  to_addrs jsonb not null default '[]'::jsonb,
  cc_addrs jsonb not null default '[]'::jsonb,
  subject text not null default '',
  text_body text not null default '',
  html_body text,
  snippet text not null default '',
  codes jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  read boolean not null default false,
  error text,
  provider text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists mail_created on mail_messages(created_at desc);
create index if not exists mail_thread on mail_messages(thread_id);
create table if not exists calls (
  id text primary key,
  provider text not null,
  direction text not null,
  from_number text,
  to_number text,
  status text not null,
  goal text,
  mode text not null default 'conversation',
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  provider_sid text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
create index if not exists calls_created on calls(created_at desc);
create table if not exists sms_messages (
  id text primary key,
  direction text not null,
  from_number text,
  to_number text,
  body text not null,
  status text not null,
  provider text,
  provider_sid text,
  error text,
  created_at timestamptz not null default now()
);
create table if not exists push_subscriptions (
  endpoint text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists mcp_servers (
  name text primary key,
  config jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
`,
  },
];
