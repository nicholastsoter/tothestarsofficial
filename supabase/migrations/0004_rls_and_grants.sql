-- Row Level Security + grants.
-- Two independent layers: GRANTs say which columns a role may touch at all; RLS policies
-- say which rows. Both must allow an action. Supabase hands anon/authenticated broad
-- default grants on new tables, so we revoke everything first and add back only what's needed.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.businesses       enable row level security;
alter table public.slug_history     enable row level security;
alter table public.surveys          enable row level security;
alter table public.survey_questions enable row level security;
alter table public.feedback         enable row level security;
alter table public.feedback_secrets enable row level security;
alter table public.events           enable row level security;
alter table public.rate_limits      enable row level security;

-- ---------- anonymous visitors: no table access at all ----------
-- The public page uses get_public_review_page() to read and the submit-public
-- Edge Function (service role) to write.

-- ---------- logged-in owners ----------

-- businesses: full control of their own row, but never owner_user_id or id after creation
grant select, delete on public.businesses to authenticated;
grant insert (owner_user_id, name, address, place_id, slug, logo_url, brand_color,
              thank_you_message, tracking_start_date, goal_rating, timezone, alerts_enabled)
  on public.businesses to authenticated;
grant update (name, address, place_id, slug, logo_url, brand_color,
              thank_you_message, tracking_start_date, goal_rating, timezone, alerts_enabled)
  on public.businesses to authenticated;

create policy businesses_select on public.businesses for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy businesses_insert on public.businesses for insert to authenticated
  with check (owner_user_id = (select auth.uid()));
create policy businesses_update on public.businesses for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
create policy businesses_delete on public.businesses for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- slug_history: read-only (the trigger writes it)
grant select on public.slug_history to authenticated;
create policy slug_history_select on public.slug_history for select to authenticated
  using (public.is_business_owner(business_id));

-- surveys: created by trigger; owners can only switch it on/off
grant select on public.surveys to authenticated;
grant update (enabled) on public.surveys to authenticated;
create policy surveys_select on public.surveys for select to authenticated
  using (public.is_business_owner(business_id));
create policy surveys_update on public.surveys for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

-- survey_questions: full control. The composite foreign key guarantees business_id matches
-- the survey, so the ownership check on business_id is enough.
grant select, insert, update, delete on public.survey_questions to authenticated;
create policy survey_questions_all on public.survey_questions for all to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

-- feedback: owners read, triage, and delete. They can NEVER edit what the customer wrote
-- or the rating (column-level grant), and never create rows (only submit-public does).
grant select, delete on public.feedback to authenticated;
grant update (status, private_note) on public.feedback to authenticated;
create policy feedback_select on public.feedback for select to authenticated
  using (public.is_business_owner(business_id));
create policy feedback_update on public.feedback for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));
create policy feedback_delete on public.feedback for delete to authenticated
  using (public.is_business_owner(business_id));

-- events: read-only for owners
grant select on public.events to authenticated;
create policy events_select on public.events for select to authenticated
  using (public.is_business_owner(business_id));

-- feedback_secrets and rate_limits: RLS on, no policies, no grants => service role only.

-- ---------- service role (Edge Functions) ----------
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------- function permissions ----------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_business_owner(uuid)        to authenticated;
grant execute on function public.get_public_review_page(text)   to anon, authenticated;
grant execute on function public.is_reserved_slug(text)         to authenticated;
grant execute on function public.is_valid_timezone(text)        to authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.cleanup_rate_limits()          to service_role;
