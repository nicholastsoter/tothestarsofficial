-- Phase 3: survey editing rules, inbox queries, and low-rating alert bookkeeping.

-- One timestamp per feedback row marks "an alert email was claimed for this item".
-- Owners can read it but have no UPDATE grant on it (their grants are status/private_note only).
alter table public.feedback add column alert_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Survey question rules: at most 10 per survey; multiple-choice options must be
-- 2-10 distinct, non-empty strings of at most 100 characters.
-- (The column CHECK from 0002 already enforces "2-10 options, only for multiple choice".)
-- ---------------------------------------------------------------------------
create function public.survey_questions_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opt jsonb;
begin
  if tg_op = 'INSERT'
     and (select count(*) from public.survey_questions q where q.survey_id = new.survey_id) >= 10 then
    raise exception 'A survey can have at most 10 questions' using errcode = 'P0001';
  end if;

  if new.type = 'multiple_choice' and jsonb_typeof(new.options) = 'array' then
    for v_opt in select o from jsonb_array_elements(new.options) o loop
      if jsonb_typeof(v_opt) <> 'string'
         or btrim(v_opt #>> '{}') = ''
         or char_length(v_opt #>> '{}') > 100 then
        raise exception 'Each answer option must be 1-100 characters of text' using errcode = '23514';
      end if;
    end loop;
    if (select count(distinct o) from jsonb_array_elements_text(new.options) o) <> jsonb_array_length(new.options) then
      raise exception 'Answer options must all be different' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger survey_questions_validate
  before insert or update on public.survey_questions
  for each row execute function public.survey_questions_validate();

-- Reorders a whole survey in ONE statement. The (survey_id, position) unique constraint is
-- deferred to the end of the transaction, so positions can be reassigned freely inside it.
-- SECURITY INVOKER: row level security still applies, so a caller can only reorder their own survey.
create function public.reorder_survey_questions(p_survey_id uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected int;
  v_updated  int;
begin
  select count(*) into v_expected from public.survey_questions where survey_id = p_survey_id;
  if v_expected = 0
     or cardinality(p_ids) <> v_expected
     or (select count(distinct x) from unnest(p_ids) x) <> v_expected then
    raise exception 'The question list does not match this survey' using errcode = '22023';
  end if;

  update public.survey_questions q
     set position = o.ord::int - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where q.id = o.id and q.survey_id = p_survey_id;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'The question list does not match this survey' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbox: feedback with a message or survey answers (has_content), filtered, searched,
-- sorted and paginated. total_count is the size of the whole filtered set, for page controls.
-- SECURITY INVOKER: row level security restricts every row to the caller's own business.
-- Dates are interpreted in the business's own time zone.
-- ---------------------------------------------------------------------------
create function public.inbox_feedback(
  p_status        public.feedback_status default null,
  p_min_star      int     default 1,
  p_max_star      int     default 5,
  p_from          date    default null,
  p_to            date    default null,
  p_search        text    default null,
  p_only_surveys  boolean default false,
  p_sort          text    default 'newest',
  p_limit         int     default 20,
  p_offset        int     default 0
)
returns table (
  id              uuid,
  star_rating     smallint,
  message         text,
  survey_answers  jsonb,
  contact_name    text,
  contact_email   text,
  status          public.feedback_status,
  private_note    text,
  created_at      timestamptz,
  total_count     bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    -- escape LIKE wildcards so searching for "100%" or "a_b" matches those characters literally
    select '%' || replace(replace(replace(left(btrim(coalesce(p_search, '')), 200), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
           btrim(coalesce(p_search, '')) <> '' as searching
  )
  select f.id, f.star_rating, f.message, f.survey_answers, f.contact_name, f.contact_email,
         f.status, f.private_note, f.created_at,
         count(*) over () as total_count
    from public.feedback f
    join public.businesses b on b.id = f.business_id
    cross join q
   where f.has_content
     and (p_status is null or f.status = p_status)
     and f.star_rating between greatest(p_min_star, 1) and least(p_max_star, 5)
     and (p_from is null or f.created_at >= (p_from::timestamp at time zone b.timezone))
     and (p_to   is null or f.created_at <  ((p_to + 1)::timestamp at time zone b.timezone))
     and (not p_only_surveys or jsonb_array_length(f.survey_answers) > 0)
     and (
       not q.searching
       or f.message       ilike q.pattern escape '\'
       or f.contact_name  ilike q.pattern escape '\'
       or f.contact_email ilike q.pattern escape '\'
       or exists (
         select 1 from jsonb_array_elements(f.survey_answers) a
          where (a ->> 'prompt') ilike q.pattern escape '\'
             or (a ->> 'answer') ilike q.pattern escape '\'
       )
     )
   order by
     case when p_sort = 'oldest'     then f.created_at end asc,
     case when p_sort = 'stars_high' then f.star_rating end desc,
     case when p_sort = 'stars_low'  then f.star_rating end asc,
     f.created_at desc,
     f.id
   limit least(greatest(p_limit, 1), 500)
  offset greatest(p_offset, 0)
$$;

-- "New" items waiting in the inbox (shown as a badge in the side nav).
create function public.new_feedback_count()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) from public.feedback f where f.status = 'new' and f.has_content
$$;

-- ---------------------------------------------------------------------------
-- Low-rating alerts. Called by submit-public (service role) after a visit's feedback is saved.
-- It decides whether an alert is due AND claims it atomically, so at most one email is ever
-- sent per feedback item, even if the customer edits the same row repeatedly.
--   * only 1-3 stars, only once the item has content (a message or survey answers)
--   * only if the owner has alerts switched on
--   * at most 10 alerts per business per hour (so a spam wave can't flood an inbox)
-- Returns the data for the email (never contact details), or null when no alert is due.
-- ---------------------------------------------------------------------------
create function public.claim_low_rating_alert(p_slug text, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz     public.businesses;
  v_fb      public.feedback;
  v_claimed public.feedback;
  v_email   text;
begin
  select b.* into v_biz from public.businesses b where b.id = public.resolve_business_id(p_slug);
  if not found or not v_biz.alerts_enabled then
    return null;
  end if;

  select f.* into v_fb
    from public.feedback_secrets s
    join public.feedback f on f.id = s.feedback_id
   where s.token_hash = p_token_hash and f.business_id = v_biz.id;
  if not found or v_fb.star_rating > 3 or not v_fb.has_content or v_fb.alert_sent_at is not null then
    return null;
  end if;

  select u.email into v_email from auth.users u where u.id = v_biz.owner_user_id;
  if v_email is null or v_email = '' then
    return null;
  end if;

  if not public.rate_limit_hit('alert:' || v_biz.id::text, 10, 3600) then
    return null;
  end if;

  -- the atomic claim: only one concurrent caller can flip NULL -> now()
  update public.feedback set alert_sent_at = now()
   where id = v_fb.id and alert_sent_at is null
   returning * into v_claimed;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'feedback_id',   v_claimed.id,
    'to_email',      v_email,
    'business_name', v_biz.name,
    'star_rating',   v_claimed.star_rating,
    'message',       v_claimed.message,
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object('prompt', a ->> 'prompt', 'answer', a -> 'answer')), '[]'::jsonb)
        from jsonb_array_elements(v_claimed.survey_answers) a
    ),
    'created_at',    v_claimed.created_at
  );
end;
$$;

-- If sending the email fails, hand the claim back so the next edit of this item can try again.
create function public.release_alert(p_feedback_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.feedback set alert_sent_at = null where id = p_feedback_id
$$;

revoke execute on function public.survey_questions_validate()                         from public, anon, authenticated;
revoke execute on function public.reorder_survey_questions(uuid, uuid[])              from public, anon, authenticated;
revoke execute on function public.inbox_feedback(public.feedback_status, int, int, date, date, text, boolean, text, int, int) from public, anon, authenticated;
revoke execute on function public.new_feedback_count()                                from public, anon, authenticated;
revoke execute on function public.claim_low_rating_alert(text, text)                  from public, anon, authenticated;
revoke execute on function public.release_alert(uuid)                                 from public, anon, authenticated;

grant execute on function public.reorder_survey_questions(uuid, uuid[])              to authenticated;
grant execute on function public.inbox_feedback(public.feedback_status, int, int, date, date, text, boolean, text, int, int) to authenticated;
grant execute on function public.new_feedback_count()                                to authenticated;
grant execute on function public.claim_low_rating_alert(text, text)                  to service_role;
grant execute on function public.release_alert(uuid)                                 to service_role;
