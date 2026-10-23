-- Phase 4: analytics, computed in the database.
--
-- Every function is SECURITY INVOKER: it runs with the caller's own permissions, so row level
-- security still applies and an owner can only ever aggregate THEIR business's rows. None of them
-- take a business id, so there is nothing to point at someone else's data.
-- Days are the business's own local days (businesses.timezone), including across daylight-saving
-- changes. Ratings are counted from feedback rows (one per visit), never from star_click events.
-- All date ranges are inclusive: p_from = p_to means "that one local day".

-- The numbers the page needs to build its ranges: today in the business's time zone, the date of
-- the first data, and the tracking start date.
create function public.analytics_context()
returns table (timezone text, today date, first_date date, tracking_start_date date)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.timezone,
         (now() at time zone b.timezone)::date,
         (select min(x) from (
            select min((f.created_at at time zone b.timezone)::date) as x from public.feedback f
            union all
            select min((e.created_at at time zone b.timezone)::date) from public.events e
          ) m),
         b.tracking_start_date
    from public.businesses b
$$;

-- KPI numbers and the funnel for one range.
create function public.analytics_summary(p_from date, p_to date)
returns table (
  page_views         bigint,
  star_taps          bigint,
  ratings            bigint,
  avg_rating         numeric,
  with_content       bigint,
  survey_completions bigint,
  google_clicks      bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (select timezone as tz from public.businesses limit 1),
  rng as (
    select (coalesce(p_from, date '1970-01-01')::timestamp at time zone b.tz) as t0,
           ((coalesce(p_to, date '2100-01-01') + 1)::timestamp at time zone b.tz) as t1
      from b
  ),
  ev as (
    select e.type, count(*) as n
      from public.events e, rng
     where e.created_at >= rng.t0 and e.created_at < rng.t1
     group by e.type
  ),
  fb as (
    select count(*) as ratings,
           round(avg(f.star_rating)::numeric, 2) as avg_rating,
           count(*) filter (where f.has_content) as with_content
      from public.feedback f, rng
     where f.created_at >= rng.t0 and f.created_at < rng.t1
  )
  select coalesce((select n from ev where type = 'page_view'), 0),
         coalesce((select n from ev where type = 'star_click'), 0),
         fb.ratings,
         fb.avg_rating,
         fb.with_content,
         coalesce((select n from ev where type = 'survey_completed'), 0),
         coalesce((select n from ev where type = 'google_link_click'), 0)
    from fb
   where exists (select 1 from rng)   -- no business, no row
$$;

-- One row per bucket (day, week starting Monday, or month) with zeros for empty buckets, so the
-- charts have no gaps. p_from null = from the first data; p_to is clamped to today.
create function public.analytics_timeseries(p_from date, p_to date, p_bucket text default 'day')
returns table (
  bucket_start  date,
  ratings       bigint,
  avg_rating    numeric,
  page_views    bigint,
  google_clicks bigint,
  star1         bigint,
  star2         bigint,
  star3         bigint,
  star4         bigint,
  star5         bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (select timezone as tz from public.businesses limit 1),
  unit as (
    select case when p_bucket in ('week', 'month') then p_bucket else 'day' end as u
  ),
  bounds as (
    select b.tz,
           coalesce(
             p_from,
             (select min(x) from (
                select min((f.created_at at time zone b.tz)::date) as x from public.feedback f
                union all
                select min((e.created_at at time zone b.tz)::date) from public.events e
              ) m),
             (now() at time zone b.tz)::date
           ) as d0,
           least(coalesce(p_to, (now() at time zone b.tz)::date), (now() at time zone b.tz)::date) as d1
      from b
  ),
  series as (
    select (generate_series(
              date_trunc(unit.u, bounds.d0::timestamp),
              bounds.d1::timestamp,
              case unit.u when 'week' then interval '1 week' when 'month' then interval '1 month' else interval '1 day' end
            ))::date as bs
      from bounds, unit
     where bounds.d1 - bounds.d0 <= 3700          -- about ten years: a guard against runaway ranges
  ),
  fb as (
    select date_trunc(unit.u, (f.created_at at time zone bounds.tz))::date as bs, f.star_rating
      from public.feedback f, bounds, unit
     where f.created_at >= (bounds.d0::timestamp at time zone bounds.tz)
       and f.created_at <  ((bounds.d1 + 1)::timestamp at time zone bounds.tz)
  ),
  ev as (
    select date_trunc(unit.u, (e.created_at at time zone bounds.tz))::date as bs,
           count(*) filter (where e.type = 'page_view')         as pv,
           count(*) filter (where e.type = 'google_link_click') as gc
      from public.events e, bounds, unit
     where e.created_at >= (bounds.d0::timestamp at time zone bounds.tz)
       and e.created_at <  ((bounds.d1 + 1)::timestamp at time zone bounds.tz)
     group by 1
  ),
  fbagg as (
    select bs,
           count(*)                                  as n,
           round(avg(star_rating)::numeric, 2)       as avg_r,
           count(*) filter (where star_rating = 1)   as s1,
           count(*) filter (where star_rating = 2)   as s2,
           count(*) filter (where star_rating = 3)   as s3,
           count(*) filter (where star_rating = 4)   as s4,
           count(*) filter (where star_rating = 5)   as s5
      from fb
     group by bs
  )
  select s.bs,
         coalesce(fa.n, 0), fa.avg_r,
         coalesce(ea.pv, 0), coalesce(ea.gc, 0),
         coalesce(fa.s1, 0), coalesce(fa.s2, 0), coalesce(fa.s3, 0), coalesce(fa.s4, 0), coalesce(fa.s5, 0)
    from series s
    left join fbagg fa on fa.bs = s.bs
    left join ev    ea on ea.bs = s.bs
   order by s.bs
$$;

-- Star distribution for a range: always five rows, zeros included.
create function public.analytics_distribution(p_from date, p_to date)
returns table (star int, ratings bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (select timezone as tz from public.businesses limit 1),
  rng as (
    select (coalesce(p_from, date '1970-01-01')::timestamp at time zone b.tz) as t0,
           ((coalesce(p_to, date '2100-01-01') + 1)::timestamp at time zone b.tz) as t1
      from b
  )
  select s.star, count(f.id)
    from generate_series(1, 5) as s(star)
    cross join rng
    left join public.feedback f
      on f.star_rating = s.star and f.created_at >= rng.t0 and f.created_at < rng.t1
   group by s.star
   order by s.star
$$;

-- Before/after the owner's tracking_start_date, using equal-length windows (up to p_max_days):
-- the N days before the start date versus the first N days from it. Our own data only.
create function public.analytics_before_after(p_max_days int default 90)
returns table (
  period     text,
  from_date  date,
  to_date    date,
  days       int,
  ratings    bigint,
  avg_rating numeric,
  star1      bigint,
  star2      bigint,
  star3      bigint,
  star4      bigint,
  star5      bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select timezone as tz, tracking_start_date as ts, (now() at time zone timezone)::date as today
      from public.businesses limit 1
  ),
  win as (
    -- n days: capped, and never longer than the time since tracking started
    select b.tz, b.ts, least(greatest(p_max_days, 1), b.today - b.ts + 1) as n from b where b.ts <= b.today
  ),
  periods as (
    select 'before'::text as period, w.ts - w.n as d0, w.ts - 1 as d1, w.n, w.tz from win w
    union all
    select 'after', w.ts, w.ts + w.n - 1, w.n, w.tz from win w
  )
  select p.period, p.d0, p.d1, p.n::int,
         count(f.id),
         round(avg(f.star_rating)::numeric, 2),
         count(f.id) filter (where f.star_rating = 1),
         count(f.id) filter (where f.star_rating = 2),
         count(f.id) filter (where f.star_rating = 3),
         count(f.id) filter (where f.star_rating = 4),
         count(f.id) filter (where f.star_rating = 5)
    from periods p
    left join public.feedback f
      on f.created_at >= (p.d0::timestamp at time zone p.tz)
     and f.created_at <  ((p.d1 + 1)::timestamp at time zone p.tz)
   group by p.period, p.d0, p.d1, p.n
   order by p.period desc   -- 'before' sorts after 'after' alphabetically; descending puts before first
$$;

revoke execute on function public.analytics_context()                           from public, anon, authenticated;
revoke execute on function public.analytics_summary(date, date)                 from public, anon, authenticated;
revoke execute on function public.analytics_timeseries(date, date, text)        from public, anon, authenticated;
revoke execute on function public.analytics_distribution(date, date)            from public, anon, authenticated;
revoke execute on function public.analytics_before_after(int)                   from public, anon, authenticated;

grant execute on function public.analytics_context()                            to authenticated;
grant execute on function public.analytics_summary(date, date)                  to authenticated;
grant execute on function public.analytics_timeseries(date, date, text)         to authenticated;
grant execute on function public.analytics_distribution(date, date)             to authenticated;
grant execute on function public.analytics_before_after(int)                    to authenticated;
