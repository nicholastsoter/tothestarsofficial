-- Functions and triggers. Every function pins search_path = '' and schema-qualifies names,
-- which stops a malicious schema from hijacking a SECURITY DEFINER function.

-- The single place that answers "does the current user own this business?".
-- Phase 5 team seats will change only this function.
create function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.owner_user_id = (select auth.uid())
  );
$$;

-- Slug rules: keep old slugs as redirects, never let one business take another's old slug,
-- and cap renames so someone can't squat names by cycling through them.
create function public.businesses_slug_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.slug = old.slug then
    return new;
  end if;

  if exists (
    select 1 from public.slug_history h
    where h.slug = new.slug and h.business_id <> new.id
  ) then
    raise exception 'This link name is already taken' using errcode = '23505';
  end if;

  if tg_op = 'UPDATE' then
    -- moving back to one of its own old slugs: it stops being history
    delete from public.slug_history where slug = new.slug and business_id = new.id;

    if (select count(*) from public.slug_history where business_id = old.id) >= 10 then
      raise exception 'This link name has been changed too many times' using errcode = 'P0001';
    end if;

    insert into public.slug_history (slug, business_id) values (old.slug, old.id);
  end if;

  return new;
end;
$$;

create trigger businesses_slug_guard
  before insert or update of slug on public.businesses
  for each row execute function public.businesses_slug_guard();

-- Every new business gets its one survey plus two starter questions to edit.
create function public.create_default_survey()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey_id uuid;
begin
  insert into public.surveys (business_id) values (new.id) returning id into v_survey_id;

  insert into public.survey_questions (survey_id, business_id, position, type, prompt, options)
  values
    (v_survey_id, new.id, 0, 'multiple_choice', 'What fell short of your expectations?',
      '["Service", "Product quality", "Wait time", "Cleanliness", "Price", "Something else"]'::jsonb),
    (v_survey_id, new.id, 1, 'long_text', 'Tell us more about what happened.', null);

  return new;
end;
$$;

create trigger businesses_create_default_survey
  after insert on public.businesses
  for each row execute function public.create_default_survey();

-- The ONLY way the public review page reads data. Returns a fixed whitelist of fields
-- (never owner_user_id or settings) and follows old slugs to the current one.
create function public.get_public_review_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.businesses;
begin
  select * into v from public.businesses where slug = lower(p_slug);

  if not found then
    select b.* into v
    from public.slug_history h
    join public.businesses b on b.id = h.business_id
    where h.slug = lower(p_slug);
  end if;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'slug', v.slug,
    'name', v.name,
    'logo_url', v.logo_url,
    'brand_color', v.brand_color,
    'thank_you_message', v.thank_you_message,
    'place_id', v.place_id,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id, 'type', q.type, 'prompt', q.prompt,
          'options', q.options, 'required', q.required
        ) order by q.position
      )
      from public.surveys s
      join public.survey_questions q on q.survey_id = s.id
      where s.business_id = v.id and s.enabled
    ), '[]'::jsonb)
  );
end;
$$;

-- Fixed-window counter. Returns true while the caller is still within the limit.
-- Callable only by Edge Functions (service role).
create function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Schedule this daily (pg_cron or a scheduled Edge Function) once the app is deployed.
create function public.cleanup_rate_limits()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;
