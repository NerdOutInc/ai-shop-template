-- Reserve a fresh identity before provisioning Auth. No FK: the Auth user does not exist yet.
-- Existing memberships/consumed claims stay untouched; old accounts are never enrolled by email.
ALTER TABLE private.admin_setup_state
  ADD COLUMN enrollment_user_id uuid,
  ADD COLUMN enrollment_email text,
  ADD CONSTRAINT admin_owner_enrollment_pair CHECK (
    (enrollment_user_id IS NULL) = (enrollment_email IS NULL)
    AND (enrollment_email IS NULL OR (
      enrollment_email = lower(enrollment_email) AND length(enrollment_email) BETWEEN 3 AND 254
    ))
  );

CREATE OR REPLACE FUNCTION private.claim_admin_owner(expected_user_id uuid, expected_email text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  -- Also serializes INSERT/UPDATE/DELETE from the Supabase Table Editor.
  lock table public.admin_memberships in share row exclusive mode;
  perform 1 from private.admin_setup_state where singleton = true for update;
  if not found then
    raise exception 'Admin setup state is missing';
  end if;
  if exists(select 1 from private.admin_setup_state where singleton and consumed_at is not null)
    or exists(select 1 from public.admin_memberships where active) then
    return false;
  end if;
  if not exists (
    select 1 from private.admin_setup_state where singleton
      and enrollment_user_id = expected_user_id and enrollment_email = lower(expected_email)
  ) then
    return false;
  end if;
  if not exists (
    select 1 from private.auth_user_identity where id = expected_user_id
      and lower(email) = lower(expected_email) and email_confirmed_at is not null
      and coalesce(is_anonymous, false) = false
      and (banned_until is null or banned_until <= now())
  ) then
    return false;
  end if;
  insert into public.admin_memberships(user_id, active) values (expected_user_id, true)
    on conflict (user_id) do update set active = true;
  update private.admin_setup_state set consumed_at = now(), claimed_by = expected_user_id where singleton;
  return true;
end;
$$;

