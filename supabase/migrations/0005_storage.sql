-- Logo storage. The bucket is public-read (logos are meant to be seen on the public review
-- page) but only the owner can write, and only inside a folder named after their business id:
--   logos/<business_id>/logo.png
-- File size and type limits are enforced by the Storage service itself. SVG is deliberately
-- excluded because SVG files can carry scripts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy logos_owner_select on storage.objects for select to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.businesses b where b.owner_user_id = (select auth.uid())
    )
  );

create policy logos_owner_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.businesses b where b.owner_user_id = (select auth.uid())
    )
  );

create policy logos_owner_update on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.businesses b where b.owner_user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.businesses b where b.owner_user_id = (select auth.uid())
    )
  );

create policy logos_owner_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.businesses b where b.owner_user_id = (select auth.uid())
    )
  );
