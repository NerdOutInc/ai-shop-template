-- Read-only operator check, using the migration-owner connection after all migrations.
-- Deliberately return no UUIDs, email addresses, credential hashes or session details.
select
  case
    when s.consumed_at is null then 'unclaimed'
    when s.claimed_by is not null and s.enrollment_user_id is not null
      and s.claimed_by = s.enrollment_user_id then 'reserved-enrollment'
    else 'owner-review'
  end as claim_method,
  case when s.claimed_by is not null then u.id is not null end as owner_account_present,
  case when u.id is not null then coalesce(u.encrypted_password, '') <> '' end as owner_has_password
from private.admin_setup_state s
left join auth.users u on u.id = s.claimed_by
where s.singleton;
