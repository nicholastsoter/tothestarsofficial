-- Core tables. RLS and grants come in 0004; nothing here is safe to expose until then.

create type public.question_type   as enum ('short_text', 'long_text', 'multiple_choice', 'rating');
create type public.feedback_status as enum ('new', 'resolved');
create type public.event_type      as enum ('page_view', 'star_click', 'survey_started', 'survey_completed', 'google_link_click');

create table public.businesses (
  id                  uuid primary key default gen_random_uuid(),
  -- unique: one business per account for now. Dropped in Phase 5 (multi-location).
  owner_user_id       uuid not null unique references auth.users (id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 120),
  address             text check (char_length(address) <= 300),
  -- The ONLY piece of Google data we store. The format check keeps junk out of the review link.
  place_id            text check (place_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  slug                text not null unique check (
                        slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                        and char_length(slug) between 3 and 50
                        and not public.is_reserved_slug(slug)
                      ),
  logo_url            text check (logo_url ~ '^https://' and char_length(logo_url) <= 500),
  brand_color         text not null default '#2563eb' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  thank_you_message   text not null default 'Thank you for your feedback!'
                        check (char_length(thank_you_message) <= 500),
  tracking_start_date date not null default current_date,
  goal_rating         numeric(2, 1) check (goal_rating between 1 and 5),
  -- No default on purpose: the app sends the browser's detected time zone at signup.
  timezone            text not null check (public.is_valid_timezone(timezone)),
  alerts_enabled      boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Old slugs, so printed QR codes keep working after a rename.
create table public.slug_history (
  slug        text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index slug_history_business_idx on public.slug_history (business_id);

create table public.surveys (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  -- lets survey_questions prove its business_id matches its survey's business
  unique (id, business_id)
);

create table public.survey_questions (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  position    int  not null check (position >= 0),
  type        public.question_type not null,
  prompt      text not null check (char_length(prompt) between 1 and 300),
  options     jsonb,
  required    boolean not null default false,
  foreign key (survey_id, business_id) references public.surveys (id, business_id) on delete cascade,
  -- deferrable so a reorder can swap two positions inside one transaction
  unique (survey_id, position) deferrable initially deferred,
  -- multiple choice needs 2-10 string options; every other type must have none
  check (
    (type = 'multiple_choice') = (
      options is not null
      and jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) between 2 and 10
    )
  )
);
create index survey_questions_order_idx on public.survey_questions (survey_id, position);

-- One row per customer visit that picked a star rating. Created at the first star tap
-- and updated if they change the rating or add text.
create table public.feedback (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  star_rating     smallint not null check (star_rating between 1 and 5),
  message         text check (char_length(message) <= 2000),
  -- snapshot so editing a question later doesn't rewrite history:
  -- [{ "question_id": "...", "prompt": "...", "type": "...", "answer": ... }]
  survey_answers  jsonb not null default '[]'
                    check (jsonb_typeof(survey_answers) = 'array' and octet_length(survey_answers::text) <= 20000),
  contact_name    text check (char_length(contact_name) <= 120),
  contact_email   text check (char_length(contact_email) <= 254),
  contact_consent boolean not null default false,
  status          public.feedback_status not null default 'new',
  private_note    text check (char_length(private_note) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The inbox shows only rows where the customer actually wrote or answered something.
  has_content     boolean generated always as (
                    coalesce(btrim(message), '') <> ''
                    or (jsonb_typeof(survey_answers) = 'array' and jsonb_array_length(survey_answers) > 0)
                  ) stored,
  check (contact_email is null or contact_consent)
);
create index feedback_business_created_idx on public.feedback (business_id, created_at desc);
create index feedback_business_rating_idx  on public.feedback (business_id, star_rating, created_at);
create index feedback_business_status_idx  on public.feedback (business_id, status);
create index feedback_inbox_idx            on public.feedback (business_id, created_at desc) where has_content;

-- Proof that a visitor owns a feedback row they created (hash of a random token the browser
-- holds). Lives in its own table so business owners can never read it.
create table public.feedback_secrets (
  feedback_id uuid primary key references public.feedback (id) on delete cascade,
  token_hash  text not null
);

create table public.events (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  type        public.event_type not null,
  star_rating smallint check (star_rating between 1 and 5),
  created_at  timestamptz not null default now()
);
create index events_business_created_idx      on public.events (business_id, created_at);
create index events_business_type_created_idx on public.events (business_id, type, created_at);

-- Counters for Edge Functions only. Keys hold salted hashes, never raw IP addresses.
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);
