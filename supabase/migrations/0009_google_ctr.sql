-- Phase 4b: Google click-through by star rating.
--
-- For each star: how many ratings were collected, how many Google link clicks were recorded for that
-- star, and the click-through rate. SECURITY INVOKER like the other analytics functions, so row level
-- security scopes every number to the caller's own business, and days are the business's local days.
--
-- A click event carries the star the customer had picked when they clicked, but no visit identifier
-- (by design: nothing identifies a visitor). One customer can click more than once, and the review
-- link appears twice on the page, so raw clicks can exceed ratings. To keep the rate honest it can
-- never go above 100%: counted_clicks = least(clicks, ratings). The raw clicks stay visible beside it.
--
-- star = 0 is a single extra row (only present when there are any) for clicks that carry no star,
-- so every click is accounted for and the totals match analytics_summary.

create function public.analytics_google_ctr(p_from date, p_to date)
returns table (
  star           int,
  ratings        bigint,
  clicks         bigint,
  counted_clicks bigint,
  click_through  numeric
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
  r as (
    select f.star_rating as s, count(*) as n
      from public.feedback f, rng
     where f.created_at >= rng.t0 and f.created_at < rng.t1
     group by f.star_rating
  ),
  c as (
    select e.star_rating as s, count(*) as n
      from public.events e, rng
     where e.type = 'google_link_click' and e.created_at >= rng.t0 and e.created_at < rng.t1
     group by e.star_rating
  ),
  per_star as (
    select st.star,
           coalesce(r.n, 0) as ratings,
           coalesce(c.n, 0) as clicks
      from rng
     cross join generate_series(1, 5) as st(star)
      left join r on r.s = st.star
      left join c on c.s = st.star
  )
  select p.star, p.ratings, p.clicks,
         least(p.clicks, p.ratings) as counted_clicks,
         case when p.ratings > 0 then round(least(p.clicks, p.ratings)::numeric / p.ratings, 4) end as click_through
    from per_star p
  union all
  select 0, 0::bigint, c.n, 0::bigint, null::numeric
    from c
   where c.s is null and c.n > 0
  order by 1
$$;

revoke execute on function public.analytics_google_ctr(date, date) from public, anon, authenticated;
grant  execute on function public.analytics_google_ctr(date, date) to authenticated;
