-- Pure helper functions used by CHECK constraints in the next migration.

-- Slugs that must never be handed out, so a business can't pose as an app page.
create function public.is_reserved_slug(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p = any (array[
    'admin', 'api', 'app', 'auth', 'login', 'logout', 'signup', 'register',
    'r', 'settings', 'dashboard', 'onboarding', 'survey', 'inbox', 'analytics',
    'qr', 'account', 'billing', 'pricing', 'privacy', 'terms', 'help',
    'support', 'about', 'contact', 'www', 'static', 'assets', 'public',
    'verify-email', 'forgot-password', 'reset-password', 'new', 'null',
    'undefined', 'root', 'system', 'tothestars', 'to-the-stars'
  ]);
$$;

-- True if Postgres recognises the name as a time zone (e.g. 'America/Chicago').
create function public.is_valid_timezone(p text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone p;
  return true;
exception when others then
  return false;
end;
$$;
