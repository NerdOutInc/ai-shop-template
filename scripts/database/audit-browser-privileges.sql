-- Run as the migration owner. Zero rows means browser grants match the contract.
-- has_*_privilege includes grants inherited from PUBLIC and other roles.
with allowed_reads(table_name) as (
  values ('admin_memberships'), ('design_generation_batches'),
    ('design_generation_candidates'), ('design_generation_slots'),
    ('library_artwork_revisions'), ('library_collection_designs'),
    ('library_collections'), ('library_design_colors'), ('library_designs'),
    ('library_favorites'), ('library_product_bindings')
), unexpected as (
  select role_name, n.nspname || '.' || c.relname as object_name, privilege
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege
  where n.nspname in ('public', 'private', 'commerce') and c.relkind in ('r','p','v','m','f')
    and has_table_privilege(role_name, c.oid, privilege)
    and not (role_name = 'authenticated' and n.nspname = 'public' and (
      (privilege = 'SELECT' and c.relname in (select table_name from allowed_reads))
      or (c.relname = 'library_favorites' and privilege in ('INSERT','UPDATE','DELETE'))
    ))
  union all
  select role_name, n.nspname || '.' || c.relname, privilege
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['anon', 'authenticated']) role_name
  cross join unnest(array['USAGE','SELECT','UPDATE']) privilege
  where n.nspname in ('public', 'private', 'commerce') and c.relkind = 'S'
    and has_sequence_privilege(role_name, c.oid, privilege)
)
select role_name, object_name, privilege from unexpected
order by role_name, object_name, privilege;
