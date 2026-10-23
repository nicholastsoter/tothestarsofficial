-- Phase 2: the database side of the public review page.
-- Visitors never touch tables. The submit-public Edge Function (service role) calls these
-- functions, which do the authoritative validation so the rules are the same everywhere
-- and are tested against real Postgres.

-- Onboarding step 4 ("download your QR code") needs real data to be marked done.
alter table public.businesses add column qr_downloaded_at timestamptz;
grant update (qr_downloaded_at) on public.businesses to authenticated;

-- A visit token maps to exactly one feedback row.
alter table public.feedback_secrets
  add constraint feedback_secrets_token_hash_key unique (token_hash),
  add constraint feedback_secrets_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$');

-- slug (current or old) -> business id
create function public.resolve_business_id(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.id from public.businesses b where b.slug = lower(p_slug)),
    (select h.business_id from public.slug_history h where h.slug = lower(p_slug))
  );
$$;

-- One call that (1) confirms the business exists and (2) counts this visitor against the
-- hourly limit. p_bucket is 'fb' (feedback writes) or 'ev' (events); the counter key is
-- bucket + business + salted IP hash, so each business and each visitor is counted separately.
create function public.public_gate(p_slug text, p_bucket text, p_ip_hash text, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.resolve_business_id(p_slug);
begin
  if p_bucket not in ('fb', 'ev') or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid gate arguments' using errcode = '22023';
  end if;
  if v_biz is null then
    return jsonb_build_object('found', false, 'allowed', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'allowed', public.rate_limit_hit(p_bucket || ':' || v_biz::text || ':' || p_ip_hash, p_limit, 3600)
  );
end;
$$;

-- page_view: no star. star_click: star required. google_link_click: star optional.
create function public.public_track_event(p_slug text, p_type public.event_type, p_star int default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.resolve_business_id(p_slug);
begin
  if v_biz is null then
    return false;
  end if;
  if p_type not in ('page_view', 'star_click', 'google_link_click') then
    raise exception 'event type not allowed' using errcode = '22023';
  end if;
  if p_star is not null and p_star not between 1 and 5 then
    raise exception 'invalid star' using errcode = '22023';
  end if;
  if (p_type = 'star_click' and p_star is null) or (p_type = 'page_view' and p_star is not null) then
    raise exception 'invalid star for event type' using errcode = '22023';
  end if;

  insert into public.events (business_id, type, star_rating) values (v_biz, p_type, p_star);
  return true;
end;
$$;

-- Creates the feedback row on a visit's first call and updates the SAME row afterwards.
-- Every call carries the visitor's complete current state (rating, text, answers, contact),
-- which replaces what was stored. Expected rejections come back as {ok:false, error:code}
-- with nothing written.
--   p_answers: [{ "question_id": uuid, "answer": string | number }]
create function public.public_submit_feedback(
  p_slug            text,
  p_token_hash      text,
  p_star            int,
  p_message         text,
  p_answers         jsonb,
  p_contact_name    text,
  p_contact_email   text,
  p_contact_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz        uuid := public.resolve_business_id(p_slug);
  v_msg        text;
  v_name       text;
  v_email      text;
  v_consent    boolean := coalesce(p_contact_consent, false);
  v_survey     uuid;
  v_enabled    boolean;
  v_answers    jsonb := '[]'::jsonb;
  v_input      jsonb := coalesce(p_answers, '[]'::jsonb);
  v_elem       jsonb;
  v_qid        uuid;
  v_seen       uuid[] := '{}';
  v_known      int;
  v_q          public.survey_questions;
  v_raw        jsonb;
  v_text       text;
  v_limit      int;
  v_val        jsonb;
  v_fb         public.feedback;
  v_created    boolean;
begin
  if v_biz is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if p_star is null or p_star not between 1 and 5 then
    return jsonb_build_object('ok', false, 'error', 'invalid_star');
  end if;

  v_msg := nullif(btrim(coalesce(p_message, '')), '');
  if char_length(v_msg) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_message');
  end if;

  v_name  := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_email := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  if (v_name is not null or v_email is not null) and not v_consent then
    return jsonb_build_object('ok', false, 'error', 'contact_requires_consent');
  end if;
  if char_length(v_name) > 120 or char_length(v_email) > 254
     or (v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  -- survey answers: each one must belong to this business's current survey and fit its type
  if jsonb_typeof(v_input) <> 'array' or jsonb_array_length(v_input) > 20 then
    return jsonb_build_object('ok', false, 'error', 'invalid_answers');
  end if;

  if jsonb_array_length(v_input) > 0 then
    select s.id, s.enabled into v_survey, v_enabled from public.surveys s where s.business_id = v_biz;
    if not coalesce(v_enabled, false) then
      return jsonb_build_object('ok', false, 'error', 'invalid_answers');
    end if;

    for v_elem in select e from jsonb_array_elements(v_input) e loop
      if jsonb_typeof(v_elem) <> 'object' then
        return jsonb_build_object('ok', false, 'error', 'invalid_answers');
      end if;
      begin
        v_qid := (v_elem ->> 'question_id')::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'invalid_answers');
      end;
      if v_qid = any (v_seen) then
        return jsonb_build_object('ok', false, 'error', 'invalid_answers');
      end if;
      v_seen := v_seen || v_qid;
    end loop;

    select count(*) into v_known from public.survey_questions q
      where q.survey_id = v_survey and q.id = any (v_seen);
    if v_known <> cardinality(v_seen) then
      return jsonb_build_object('ok', false, 'error', 'invalid_answers');
    end if;

    -- walk the CURRENT questions in order, snapshotting the prompt text next to each answer
    for v_q in select * from public.survey_questions q where q.survey_id = v_survey order by q.position loop
      select e -> 'answer' into v_raw
        from jsonb_array_elements(v_input) e
        where (e ->> 'question_id')::uuid = v_q.id;

      v_val := null;
      if v_raw is not null and jsonb_typeof(v_raw) <> 'null' then
        if v_q.type in ('short_text', 'long_text') then
          if jsonb_typeof(v_raw) <> 'string' then
            return jsonb_build_object('ok', false, 'error', 'invalid_answers');
          end if;
          v_text := btrim(v_raw #>> '{}');
          v_limit := case v_q.type when 'short_text' then 300 else 2000 end;
          if char_length(v_text) > v_limit then
            return jsonb_build_object('ok', false, 'error', 'invalid_answers');
          end if;
          if v_text <> '' then v_val := to_jsonb(v_text); end if;

        elsif v_q.type = 'multiple_choice' then
          if jsonb_typeof(v_raw) <> 'string' or not (v_q.options ? (v_raw #>> '{}')) then
            return jsonb_build_object('ok', false, 'error', 'invalid_answers');
          end if;
          v_val := v_raw;

        elsif v_q.type = 'rating' then
          if jsonb_typeof(v_raw) <> 'number'
             or (v_raw #>> '{}')::numeric <> trunc((v_raw #>> '{}')::numeric)
             or (v_raw #>> '{}')::numeric not between 1 and 5 then
            return jsonb_build_object('ok', false, 'error', 'invalid_answers');
          end if;
          v_val := v_raw;
        end if;
      end if;

      if v_val is null then
        if v_q.required then
          return jsonb_build_object('ok', false, 'error', 'invalid_answers');
        end if;
      else
        v_answers := v_answers || jsonb_build_object(
          'question_id', v_q.id, 'prompt', v_q.prompt, 'type', v_q.type, 'answer', v_val
        );
      end if;
    end loop;
  end if;

  -- two taps in quick succession must not race into two rows
  perform pg_advisory_xact_lock(hashtext(p_token_hash));

  select f.* into v_fb
    from public.feedback_secrets s join public.feedback f on f.id = s.feedback_id
    where s.token_hash = p_token_hash;

  if found then
    if v_fb.business_id <> v_biz then
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;
    if v_fb.created_at < now() - interval '24 hours' then
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    update public.feedback
      set star_rating = p_star, message = v_msg, survey_answers = v_answers,
          contact_name = v_name, contact_email = v_email, contact_consent = v_consent,
          updated_at = now()
      where id = v_fb.id;
    v_created := false;
  else
    insert into public.feedback
      (business_id, star_rating, message, survey_answers, contact_name, contact_email, contact_consent)
      values (v_biz, p_star, v_msg, v_answers, v_name, v_email, v_consent)
      returning * into v_fb;
    insert into public.feedback_secrets (feedback_id, token_hash) values (v_fb.id, p_token_hash);
    v_created := true;
    v_fb.survey_answers := '[]'::jsonb; -- so the check below treats a new row's answers as "new"
  end if;

  -- a survey counts as completed the first time answers appear on this visit
  if jsonb_array_length(v_answers) > 0 and jsonb_array_length(v_fb.survey_answers) = 0 then
    insert into public.events (business_id, type, star_rating) values (v_biz, 'survey_completed', p_star);
  end if;

  return jsonb_build_object('ok', true, 'created', v_created);
end;
$$;

revoke execute on function public.resolve_business_id(text) from public, anon, authenticated;
revoke execute on function public.public_gate(text, text, text, int) from public, anon, authenticated;
revoke execute on function public.public_track_event(text, public.event_type, int) from public, anon, authenticated;
revoke execute on function public.public_submit_feedback(text, text, int, text, jsonb, text, text, boolean) from public, anon, authenticated;

grant execute on function public.resolve_business_id(text) to service_role;
grant execute on function public.public_gate(text, text, text, int) to service_role;
grant execute on function public.public_track_event(text, public.event_type, int) to service_role;
grant execute on function public.public_submit_feedback(text, text, int, text, jsonb, text, text, boolean) to service_role;
