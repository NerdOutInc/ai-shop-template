-- Keep sustained denial separate from delivery errors; preserve the existing quota and grants.
alter table commerce.drop_signup_confirmation_budget add column blocked_since timestamptz;
