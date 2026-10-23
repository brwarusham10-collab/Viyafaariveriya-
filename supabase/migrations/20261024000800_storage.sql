-- VIYAFAARIVERIYAA · 0008 Private file storage (logos, product images, expense receipts)
-- Object paths: <organization_id>/<area>/<file>, area in (branding, products, expenses).
-- Skipped automatically where the Supabase storage schema is not installed (plain Postgres test runs).

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present; skipping storage policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('org-files', 'org-files', false, 5242880, array['image/png','image/jpeg','image/webp','application/pdf'])
  on conflict (id) do nothing;

  execute $p$
    create or replace function private.storage_org(p_name text) returns uuid
    language sql immutable as $f$
      select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
    $f$;
    grant execute on function private.storage_org(text) to authenticated;

    create or replace function private.storage_write_perm(p_name text) returns text
    language sql immutable as $f$
      select case split_part(p_name, '/', 2)
               when 'branding' then 'settings.manage'
               when 'products' then 'products.manage'
               when 'expenses' then 'expenses.manage'
             end
    $f$;
    grant execute on function private.storage_write_perm(text) to authenticated;

    create policy org_files_read on storage.objects for select to authenticated
      using (bucket_id = 'org-files' and private.is_member(private.storage_org(name))
             and (split_part(name, '/', 2) <> 'expenses' or private.has_perm(private.storage_org(name), 'expenses.view')));
    create policy org_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'org-files' and private.storage_write_perm(name) is not null
                  and private.has_perm(private.storage_org(name), private.storage_write_perm(name)));
    create policy org_files_update on storage.objects for update to authenticated
      using (bucket_id = 'org-files' and private.storage_write_perm(name) is not null
             and private.has_perm(private.storage_org(name), private.storage_write_perm(name)));
    create policy org_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'org-files' and private.storage_write_perm(name) is not null
             and private.has_perm(private.storage_org(name), private.storage_write_perm(name)));
  $p$;
end
$outer$;
