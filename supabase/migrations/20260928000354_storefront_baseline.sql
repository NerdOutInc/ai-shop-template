-- Fresh storefront schema for a new, isolated Supabase project.
-- Supabase owns auth.users/auth.sessions and anon/authenticated/service_role.
-- Apply as the database owner; the application uses store_app_runtime instead.
-- Provision its password separately. Never place credentials or shop data here.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'store_app_runtime') then
    create role store_app_runtime login nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;
  execute format('grant connect on database %I to store_app_runtime', current_database());
end $$;

CREATE SCHEMA commerce;

CREATE SCHEMA private;

CREATE SCHEMA IF NOT EXISTS public;

-- Supabase installations can auto-grant ALL on public tables and sequences.
-- Future objects created by the migration role must opt in to browser access.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

CREATE TABLE commerce.catalog_refreshes (
    shop_id text NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    CONSTRAINT catalog_refreshes_kind_check CHECK ((kind = ANY (ARRAY['stock'::text, 'popularity'::text]))),
    CONSTRAINT catalog_refreshes_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text))
);

CREATE TABLE commerce.checkout_orders (
    request_id uuid NOT NULL,
    snapshot jsonb NOT NULL,
    session_id text,
    checkout_url text,
    state text DEFAULT 'pending'::text NOT NULL,
    printify_order_id text,
    failure_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment jsonb,
    CONSTRAINT checkout_orders_payment_capture_valid CHECK (((payment IS NULL) OR COALESCE(((jsonb_typeof(payment) = 'object'::text) AND (payment @> '{"status": "paid", "currency": "usd"}'::jsonb) AND (jsonb_typeof((payment -> 'livemode'::text)) = 'boolean'::text) AND (jsonb_typeof((payment -> 'paymentIntentId'::text)) = 'string'::text) AND ((payment ->> 'paymentIntentId'::text) ~ '^pi_[a-zA-Z0-9]+$'::text) AND (jsonb_typeof((payment -> 'paidAt'::text)) = 'string'::text) AND ((payment ->> 'paidAt'::text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'::text) AND (jsonb_typeof((payment -> 'customerName'::text)) = ANY (ARRAY['string'::text, 'null'::text])) AND COALESCE((length((payment ->> 'customerName'::text)) <= 200), true) AND (jsonb_typeof((payment -> 'customerEmail'::text)) = ANY (ARRAY['string'::text, 'null'::text])) AND COALESCE((length((payment ->> 'customerEmail'::text)) <= 320), true) AND
CASE
    WHEN ((jsonb_typeof((payment -> 'subtotalAmount'::text)) = 'number'::text) AND ((payment ->> 'subtotalAmount'::text) ~ '^[0-9]{1,16}$'::text) AND (jsonb_typeof((payment -> 'shippingAmount'::text)) = 'number'::text) AND ((payment ->> 'shippingAmount'::text) ~ '^[0-9]{1,16}$'::text) AND (jsonb_typeof((payment -> 'taxAmount'::text)) = 'number'::text) AND ((payment ->> 'taxAmount'::text) ~ '^[0-9]{1,16}$'::text) AND (jsonb_typeof((payment -> 'totalAmount'::text)) = 'number'::text) AND ((payment ->> 'totalAmount'::text) ~ '^[0-9]{1,16}$'::text)) THEN ((((payment ->> 'totalAmount'::text))::numeric <= ('9007199254740991'::bigint)::numeric) AND (((payment ->> 'totalAmount'::text))::numeric = ((((payment ->> 'subtotalAmount'::text))::numeric + ((payment ->> 'shippingAmount'::text))::numeric) + ((payment ->> 'taxAmount'::text))::numeric)))
    ELSE false
END), false))),
    CONSTRAINT checkout_orders_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text)),
    CONSTRAINT checkout_orders_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'creating'::text, 'created'::text, 'submitting'::text, 'submitted'::text, 'simulated'::text])))
);

CREATE TABLE commerce.design_product_artwork (
    shop_id text NOT NULL,
    product_id text NOT NULL,
    production_fingerprint text NOT NULL,
    revision_id uuid NOT NULL,
    print_asset_id uuid NOT NULL,
    print_sha256 text NOT NULL,
    printify_image_id text NOT NULL,
    approved_by uuid NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT design_product_artwork_print_sha256_check CHECK ((print_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT design_product_artwork_production_fingerprint_check CHECK ((production_fingerprint ~ '^artwork-v1:[a-f0-9]{64}$'::text))
);

CREATE TABLE commerce.drop_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    source text NOT NULL,
    signup_ip inet,
    consent_copy_version text NOT NULL,
    consented_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    unsubscribed_at timestamp with time zone,
    last_unsubscribed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT drop_subscribers_consent_copy_version_check CHECK (((consent_copy_version <> ''::text) AND (length(consent_copy_version) <= 64))),
    CONSTRAINT drop_subscribers_email_check CHECK (((email = lower(btrim(email))) AND ((length(email) >= 6) AND (length(email) <= 254)) AND (email ~~ '%_@_%.__%'::text))),
    CONSTRAINT drop_subscribers_source_check CHECK (((source <> ''::text) AND (length(source) <= 64)))
);

CREATE TABLE commerce.garment_models (
    shop_id text NOT NULL,
    blueprint_id integer NOT NULL,
    manufacturer text NOT NULL,
    model text NOT NULL,
    category_slug text,
    google_product_category integer,
    gender text,
    age_group text,
    size_system text,
    complete boolean GENERATED ALWAYS AS (((category_slug IS NOT NULL) AND (google_product_category IS NOT NULL) AND (gender IS NOT NULL) AND (age_group IS NOT NULL) AND (size_system IS NOT NULL))) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT garment_models_age_group_check CHECK ((age_group = ANY (ARRAY['newborn'::text, 'infant'::text, 'toddler'::text, 'kids'::text, 'adult'::text]))),
    CONSTRAINT garment_models_blueprint_id_check CHECK ((blueprint_id > 0)),
    CONSTRAINT garment_models_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'unisex'::text]))),
    CONSTRAINT garment_models_google_product_category_check CHECK ((google_product_category > 0)),
    CONSTRAINT garment_models_manufacturer_check CHECK (((manufacturer <> ''::text) AND (manufacturer = btrim(manufacturer)) AND (length(manufacturer) <= 80))),
    CONSTRAINT garment_models_model_check CHECK (((model <> ''::text) AND (model = btrim(model)) AND (length(model) <= 80))),
    CONSTRAINT garment_models_shop_id_check CHECK ((shop_id <> ''::text)),
    CONSTRAINT garment_models_size_system_check CHECK ((size_system = ANY (ARRAY['US'::text, 'UK'::text, 'EU'::text, 'DE'::text, 'FR'::text, 'IT'::text, 'JP'::text, 'CN'::text, 'BR'::text, 'MEX'::text, 'AU'::text])))
);

CREATE TABLE commerce.order_shipping_alerts (
    request_id uuid NOT NULL,
    next_check_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_reason text,
    email_day text,
    email_payload jsonb,
    attempt_started_at timestamp with time zone,
    sent_at timestamp with time zone,
    provider_email_id text,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT alert_attempt_shape CHECK ((((email_day IS NULL) AND (email_payload IS NULL) AND (attempt_started_at IS NULL) AND (sent_at IS NULL)) OR ((email_day ~ '^\d{4}-\d{2}-\d{2}$'::text) AND (jsonb_typeof(email_payload) = 'object'::text) AND (attempt_started_at IS NOT NULL)))),
    CONSTRAINT order_shipping_alerts_completed_reason_check CHECK ((completed_reason = ANY (ARRAY['shipped'::text, 'refunded'::text]))),
    CONSTRAINT order_shipping_alerts_last_error_check CHECK ((last_error = ANY (ARRAY['check_failed'::text, 'send_unconfirmed'::text])))
);

CREATE TABLE commerce.printify_product_revisions (
    shop_id text NOT NULL,
    product_id text NOT NULL,
    revision bigint NOT NULL,
    event_id text,
    snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT printify_product_revisions_snapshot_check CHECK (((snapshot IS NULL) OR (jsonb_typeof(snapshot) = 'object'::text)))
);

CREATE TABLE commerce.printify_products (
    shop_id text NOT NULL,
    product_id text NOT NULL,
    sort_position bigint NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    snapshot jsonb,
    active boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hidden_at timestamp with time zone DEFAULT now(),
    reveal_at timestamp with time zone,
    revealed_at timestamp with time zone,
    blueprint_id integer GENERATED ALWAYS AS (
CASE
    WHEN ((jsonb_typeof((snapshot -> 'blueprint_id'::text)) = 'number'::text) AND ((snapshot ->> 'blueprint_id'::text) ~ '^[1-9][0-9]{0,8}$'::text)) THEN ((snapshot ->> 'blueprint_id'::text))::integer
    ELSE NULL::integer
END) STORED,
    added_to_shop_at timestamp with time zone,
    CONSTRAINT printify_products_check CHECK (((NOT active) OR (snapshot IS NOT NULL))),
    CONSTRAINT printify_products_reveal_while_hidden CHECK (((reveal_at IS NULL) OR (hidden_at IS NOT NULL))),
    CONSTRAINT printify_products_snapshot_check CHECK (((snapshot IS NULL) OR (jsonb_typeof(snapshot) = 'object'::text)))
);

ALTER TABLE commerce.printify_products ALTER COLUMN sort_position ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME commerce.printify_products_sort_position_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE commerce.printify_publish_jobs (
    event_id text NOT NULL,
    shop_id text NOT NULL,
    product_id text NOT NULL,
    event_created_at timestamp with time zone NOT NULL,
    event jsonb NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    outcome text,
    attempts integer DEFAULT 0 NOT NULL,
    source_fingerprint text,
    callback_attempted boolean DEFAULT false NOT NULL,
    failure_code text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT printify_publish_jobs_event_check CHECK ((jsonb_typeof(event) = 'object'::text)),
    CONSTRAINT printify_publish_jobs_outcome_check CHECK ((outcome = ANY (ARRAY['published'::text, 'unpublished'::text, 'failed'::text]))),
    CONSTRAINT printify_publish_jobs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'callback'::text, 'complete'::text, 'superseded'::text, 'attention'::text])))
);

CREATE TABLE commerce.product_week_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id text NOT NULL,
    product_id text NOT NULL,
    live_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    featured_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_week_schedule_ended_at_check CHECK (((ended_at IS NULL) OR isfinite(ended_at))),
    CONSTRAINT product_week_schedule_live_at_check CHECK (isfinite(live_at))
);

CREATE TABLE commerce.public_request_attempts (
    subject_hash text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    attempts integer NOT NULL,
    CONSTRAINT public_request_attempts_attempts_check CHECK ((attempts > 0)),
    CONSTRAINT public_request_attempts_subject_hash_check CHECK ((subject_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE commerce.published_image_uploads (
    shop_id text NOT NULL,
    product_id text NOT NULL,
    key_hash text NOT NULL,
    url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT published_image_uploads_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT published_image_uploads_url_check CHECK ((url ~~ 'https://%'::text))
);

CREATE TABLE commerce.shop_categories (
    shop_id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    sort_position integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shop_categories_name_check CHECK (((name <> ''::text) AND (name = btrim(name)) AND (length(name) <= 60))),
    CONSTRAINT shop_categories_shop_id_check CHECK ((shop_id <> ''::text)),
    CONSTRAINT shop_categories_slug_check CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 64))),
    CONSTRAINT shop_categories_sort_position_check CHECK ((sort_position > 0))
);

CREATE TABLE private.admin_auth_attempts (
    subject_hash text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    attempts integer NOT NULL,
    CONSTRAINT admin_auth_attempts_attempts_check CHECK ((attempts > 0))
);

CREATE TABLE private.admin_setup_state (
    singleton boolean DEFAULT true NOT NULL,
    consumed_at timestamp with time zone,
    claimed_by uuid,
    CONSTRAINT admin_setup_state_check CHECK (((consumed_at IS NULL) = (claimed_by IS NULL))),
    CONSTRAINT admin_setup_state_singleton_check CHECK (singleton)
);

CREATE VIEW private.auth_session_identity AS
 SELECT id,
    user_id,
    not_after
   FROM auth.sessions;

CREATE VIEW private.auth_user_identity AS
 SELECT id,
    email,
    email_confirmed_at,
    is_anonymous,
    banned_until
   FROM auth.users;

CREATE TABLE private.design_agent_grants (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    label text NOT NULL,
    token_hash text NOT NULL,
    scopes text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT design_agent_grants_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '7 days'::interval)))),
    CONSTRAINT design_agent_grants_label_check CHECK (((length(label) >= 1) AND (length(label) <= 100))),
    CONSTRAINT design_agent_grants_scopes_check CHECK (((cardinality(scopes) > 0) AND (scopes <@ ARRAY['library:read'::text, 'library:write'::text, 'drafts:create'::text]))),
    CONSTRAINT design_agent_grants_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE private.design_draft_items (
    request_id uuid NOT NULL,
    design_id uuid NOT NULL,
    canonical_design_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    frozen jsonb NOT NULL,
    input_error text,
    binding_id uuid
);

CREATE TABLE private.design_draft_requests (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    shop_id text NOT NULL,
    input jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE private.design_draft_write_receipts (
    id bigint NOT NULL,
    binding_id uuid NOT NULL,
    request_id uuid NOT NULL,
    kind text NOT NULL,
    http_status integer,
    product_payload jsonb,
    upload_receipt jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT design_draft_write_receipts_http_status_check CHECK ((http_status = ANY (ARRAY[400, 401, 403, 404, 422]))),
    CONSTRAINT design_draft_write_receipts_kind_check CHECK ((kind = ANY (ARRAY['product-not-sent'::text, 'product-rejected'::text, 'upload-mismatch'::text])))
);

ALTER TABLE private.design_draft_write_receipts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME private.design_draft_write_receipts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE private.design_product_attempts (
    binding_id uuid NOT NULL,
    request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    grant_id uuid,
    asset_id uuid NOT NULL,
    recipe jsonb NOT NULL,
    title text NOT NULL,
    stage text DEFAULT 'pending'::text NOT NULL,
    lease_id uuid,
    lease_expires_at timestamp with time zone,
    uploaded_image_id text,
    product_payload jsonb,
    observed_product_id text,
    failure_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_product_ids text[] DEFAULT '{}'::text[] NOT NULL,
    provider_readback jsonb,
    CONSTRAINT design_product_attempts_check CHECK (((stage <> ALL (ARRAY['ready'::text, 'creating'::text, 'verified'::text])) OR (uploaded_image_id IS NOT NULL))),
    CONSTRAINT design_product_attempts_check1 CHECK (((stage <> ALL (ARRAY['creating'::text, 'verified'::text])) OR (product_payload IS NOT NULL))),
    CONSTRAINT design_product_attempts_stage_check CHECK ((stage = ANY (ARRAY['pending'::text, 'uploading'::text, 'ready'::text, 'creating'::text, 'verified'::text, 'attention'::text])))
);

CREATE TABLE private.design_product_candidates (
    binding_id uuid NOT NULL,
    product_id text NOT NULL,
    image_id text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE private.design_provider_capabilities (
    token_hash text NOT NULL,
    binding_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    asset_sha256 text NOT NULL,
    user_id uuid NOT NULL,
    grant_id uuid,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT design_provider_capabilities_asset_sha256_check CHECK ((asset_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT design_provider_capabilities_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE private.design_provider_source_evidence (
    shop_id text NOT NULL,
    image_id text NOT NULL,
    source_url_sha256 text NOT NULL,
    sha256 text NOT NULL,
    pixel_sha256 text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT design_provider_source_evidence_height_check CHECK ((height > 0)),
    CONSTRAINT design_provider_source_evidence_pixel_sha256_check CHECK ((pixel_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT design_provider_source_evidence_sha256_check CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT design_provider_source_evidence_source_url_sha256_check CHECK ((source_url_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT design_provider_source_evidence_width_check CHECK ((width > 0))
);

CREATE TABLE public.admin_memberships (
    user_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.design_generation_batches (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    collection_id text NOT NULL,
    title text NOT NULL,
    brief text NOT NULL,
    requested_count integer NOT NULL,
    request_hash text NOT NULL,
    plan_hash text,
    status text DEFAULT 'planning'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    completion_receipt jsonb,
    CONSTRAINT design_generation_batches_requested_count_check CHECK (((requested_count >= 1) AND (requested_count <= 200))),
    CONSTRAINT design_generation_batches_status_check CHECK ((status = ANY (ARRAY['planning'::text, 'generating'::text, 'ready'::text])))
);

CREATE TABLE public.design_generation_candidates (
    id uuid NOT NULL,
    batch_id uuid NOT NULL,
    slot integer NOT NULL,
    payload jsonb NOT NULL,
    payload_hash text NOT NULL,
    status text DEFAULT 'registering'::text NOT NULL,
    rejection_reason text,
    review jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT design_generation_candidates_status_check CHECK ((status = ANY (ARRAY['registering'::text, 'registered'::text, 'failed'::text, 'rejected'::text, 'ready'::text])))
);

CREATE TABLE public.design_generation_slots (
    batch_id uuid NOT NULL,
    slot integer NOT NULL,
    direction jsonb,
    status text DEFAULT 'planned'::text NOT NULL,
    lease_owner uuid,
    lease_expires_at timestamp with time zone,
    candidate_id uuid,
    CONSTRAINT design_generation_slots_slot_check CHECK (((slot >= 1) AND (slot <= 200))),
    CONSTRAINT design_generation_slots_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'generating'::text, 'registering'::text, 'registered'::text, 'ready'::text])))
);

CREATE TABLE public.library_artwork_fingerprints (
    kind text NOT NULL,
    fingerprint text NOT NULL,
    canonical_design_id uuid NOT NULL,
    CONSTRAINT library_artwork_fingerprints_fingerprint_check CHECK ((fingerprint ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT library_artwork_fingerprints_kind_check CHECK ((kind = ANY (ARRAY['bytes'::text, 'pixels'::text])))
);

CREATE TABLE public.library_artwork_revisions (
    id uuid NOT NULL,
    design_id uuid NOT NULL,
    print_readiness text NOT NULL,
    print_notes text,
    width_inches double precision,
    height_inches double precision,
    native_ppi double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    assessed_by uuid,
    assessed_at timestamp with time zone,
    CONSTRAINT library_artwork_revisions_height_inches_check CHECK ((height_inches > (0)::double precision)),
    CONSTRAINT library_artwork_revisions_native_ppi_check CHECK ((native_ppi > (0)::double precision)),
    CONSTRAINT library_artwork_revisions_print_readiness_check CHECK ((print_readiness = ANY (ARRAY['unverified'::text, 'needs-preparation'::text, 'ready'::text]))),
    CONSTRAINT library_artwork_revisions_width_inches_check CHECK ((width_inches > (0)::double precision)),
    CONSTRAINT library_assessment_actor_pair CHECK (((assessed_by IS NULL) = (assessed_at IS NULL)))
);

CREATE TABLE public.library_assets (
    id uuid NOT NULL,
    revision_id uuid NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    pathname text,
    source_path text,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    width integer,
    height integer,
    bytes bigint,
    sha256 text,
    pixel_sha256 text,
    perceptual_hash text,
    has_alpha boolean,
    has_transparency boolean,
    enlarged boolean,
    CONSTRAINT library_assets_bytes_check CHECK ((bytes > 0)),
    CONSTRAINT library_assets_check CHECK (((status <> 'ready'::text) OR (pathname IS NOT NULL))),
    CONSTRAINT library_assets_check1 CHECK (((status = 'unavailable'::text) OR ((width IS NOT NULL) AND (height IS NOT NULL) AND (bytes IS NOT NULL) AND (sha256 IS NOT NULL) AND (pixel_sha256 IS NOT NULL)))),
    CONSTRAINT library_assets_height_check CHECK ((height > 0)),
    CONSTRAINT library_assets_kind_check CHECK ((kind = ANY (ARRAY['original'::text, 'print'::text, 'preview'::text]))),
    CONSTRAINT library_assets_mime_type_check CHECK ((mime_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text]))),
    CONSTRAINT library_assets_perceptual_hash_check CHECK ((perceptual_hash ~ '^[a-f0-9]{16}$'::text)),
    CONSTRAINT library_assets_pixel_sha256_check CHECK ((pixel_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT library_assets_sha256_check CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT library_assets_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'unavailable'::text]))),
    CONSTRAINT library_assets_width_check CHECK ((width > 0))
);

CREATE TABLE public.library_collection_designs (
    collection_id text NOT NULL,
    design_id uuid NOT NULL
);

CREATE TABLE public.library_collections (
    id text NOT NULL,
    title text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    review_state text DEFAULT 'ready'::text NOT NULL,
    CONSTRAINT library_collections_id_check CHECK (((id <> ''::text) AND (id = btrim(id)))),
    CONSTRAINT library_collections_review_state_check CHECK ((review_state = ANY (ARRAY['draft'::text, 'ready'::text]))),
    CONSTRAINT library_collections_title_check CHECK ((title <> ''::text))
);

CREATE TABLE public.library_design_colors (
    design_id uuid NOT NULL,
    color_name text NOT NULL,
    "position" smallint NOT NULL,
    source text DEFAULT 'assigned'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT library_design_colors_color_name_check CHECK (((color_name <> ''::text) AND (color_name = btrim(color_name)))),
    CONSTRAINT library_design_colors_position_check CHECK ((("position" >= 1) AND ("position" <= 5))),
    CONSTRAINT library_design_colors_source_check CHECK ((source = ANY (ARRAY['assigned'::text, 'printify'::text, 'promoted'::text])))
);

CREATE TABLE public.library_designs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_design_id uuid NOT NULL,
    display_number bigint NOT NULL,
    title text NOT NULL,
    family text DEFAULT ''::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    mechanism text DEFAULT ''::text NOT NULL,
    prompt text DEFAULT ''::text NOT NULL,
    background jsonb,
    state text DEFAULT 'active'::text NOT NULL,
    current_revision_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT library_designs_display_number_check CHECK ((display_number > 0)),
    CONSTRAINT library_designs_state_check CHECK ((state = ANY (ARRAY['active'::text, 'archived'::text, 'rejected'::text]))),
    CONSTRAINT library_designs_title_check CHECK ((title <> ''::text))
);

ALTER TABLE public.library_designs ALTER COLUMN display_number ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.library_designs_display_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.library_favorites (
    user_id uuid NOT NULL,
    design_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    color_name text,
    CONSTRAINT library_favorites_color_name_check CHECK (((color_name IS NULL) OR ((color_name <> ''::text) AND (color_name = btrim(color_name)))))
);

CREATE TABLE public.library_product_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_design_id uuid NOT NULL,
    shop_id text NOT NULL,
    product_model_id text NOT NULL,
    product_model_label text NOT NULL,
    product_id text,
    revision_id uuid,
    status text DEFAULT 'unverified'::text NOT NULL,
    verified_at timestamp with time zone,
    storefront_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT library_product_bindings_check CHECK (((status <> ALL (ARRAY['draft'::text, 'published'::text])) OR ((product_id IS NOT NULL) AND (revision_id IS NOT NULL) AND (verified_at IS NOT NULL)))),
    CONSTRAINT library_product_bindings_product_model_id_check CHECK ((product_model_id <> ''::text)),
    CONSTRAINT library_product_bindings_shop_id_check CHECK ((shop_id <> ''::text)),
    CONSTRAINT library_product_bindings_status_check CHECK ((status = ANY (ARRAY['unverified'::text, 'reserved'::text, 'creating'::text, 'draft'::text, 'published'::text, 'needs-reconciliation'::text, 'removed'::text])))
);

ALTER TABLE ONLY commerce.catalog_refreshes
    ADD CONSTRAINT catalog_refreshes_pkey PRIMARY KEY (shop_id, kind);

ALTER TABLE ONLY commerce.checkout_orders
    ADD CONSTRAINT checkout_orders_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY commerce.checkout_orders
    ADD CONSTRAINT checkout_orders_printify_order_id_key UNIQUE (printify_order_id);

ALTER TABLE ONLY commerce.checkout_orders
    ADD CONSTRAINT checkout_orders_session_id_key UNIQUE (session_id);

ALTER TABLE ONLY commerce.design_product_artwork
    ADD CONSTRAINT design_product_artwork_pkey PRIMARY KEY (shop_id, product_id, production_fingerprint);

ALTER TABLE ONLY commerce.drop_subscribers
    ADD CONSTRAINT drop_subscribers_email_key UNIQUE (email);

ALTER TABLE ONLY commerce.drop_subscribers
    ADD CONSTRAINT drop_subscribers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY commerce.garment_models
    ADD CONSTRAINT garment_models_pkey PRIMARY KEY (shop_id, blueprint_id);

ALTER TABLE ONLY commerce.order_shipping_alerts
    ADD CONSTRAINT order_shipping_alerts_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY commerce.printify_product_revisions
    ADD CONSTRAINT printify_product_revisions_event_id_key UNIQUE (event_id);

ALTER TABLE ONLY commerce.printify_product_revisions
    ADD CONSTRAINT printify_product_revisions_pkey PRIMARY KEY (shop_id, product_id, revision);

ALTER TABLE ONLY commerce.printify_products
    ADD CONSTRAINT printify_products_pkey PRIMARY KEY (shop_id, product_id);

ALTER TABLE ONLY commerce.printify_publish_jobs
    ADD CONSTRAINT printify_publish_jobs_pkey PRIMARY KEY (event_id);

ALTER TABLE ONLY commerce.product_week_schedule
    ADD CONSTRAINT product_week_schedule_pkey PRIMARY KEY (id);

ALTER TABLE ONLY commerce.public_request_attempts
    ADD CONSTRAINT public_request_attempts_pkey PRIMARY KEY (subject_hash);

ALTER TABLE ONLY commerce.published_image_uploads
    ADD CONSTRAINT published_image_uploads_pkey PRIMARY KEY (shop_id, product_id, key_hash);

ALTER TABLE ONLY commerce.shop_categories
    ADD CONSTRAINT shop_categories_pkey PRIMARY KEY (shop_id, slug);

ALTER TABLE ONLY private.admin_auth_attempts
    ADD CONSTRAINT admin_auth_attempts_pkey PRIMARY KEY (subject_hash);

ALTER TABLE ONLY private.admin_setup_state
    ADD CONSTRAINT admin_setup_state_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY private.design_agent_grants
    ADD CONSTRAINT design_agent_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY private.design_agent_grants
    ADD CONSTRAINT design_agent_grants_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY private.design_draft_items
    ADD CONSTRAINT design_draft_items_pkey PRIMARY KEY (request_id, design_id);

ALTER TABLE ONLY private.design_draft_requests
    ADD CONSTRAINT design_draft_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY private.design_draft_write_receipts
    ADD CONSTRAINT design_draft_write_receipts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY private.design_product_attempts
    ADD CONSTRAINT design_product_attempts_pkey PRIMARY KEY (binding_id);

ALTER TABLE ONLY private.design_product_candidates
    ADD CONSTRAINT design_product_candidates_pkey PRIMARY KEY (binding_id, product_id);

ALTER TABLE ONLY private.design_provider_capabilities
    ADD CONSTRAINT design_provider_capabilities_pkey PRIMARY KEY (token_hash);

ALTER TABLE ONLY private.design_provider_source_evidence
    ADD CONSTRAINT design_provider_source_evidence_pkey PRIMARY KEY (shop_id, image_id, source_url_sha256);

ALTER TABLE ONLY public.admin_memberships
    ADD CONSTRAINT admin_memberships_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.design_generation_batches
    ADD CONSTRAINT design_generation_batches_collection_id_key UNIQUE (collection_id);

ALTER TABLE ONLY public.design_generation_batches
    ADD CONSTRAINT design_generation_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.design_generation_batches
    ADD CONSTRAINT design_generation_batches_user_id_request_id_key UNIQUE (user_id, request_id);

ALTER TABLE ONLY public.design_generation_candidates
    ADD CONSTRAINT design_generation_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.design_generation_slots
    ADD CONSTRAINT design_generation_slots_pkey PRIMARY KEY (batch_id, slot);

ALTER TABLE ONLY public.library_artwork_fingerprints
    ADD CONSTRAINT library_artwork_fingerprints_pkey PRIMARY KEY (kind, fingerprint);

ALTER TABLE ONLY public.library_artwork_revisions
    ADD CONSTRAINT library_artwork_revisions_id_design_id_key UNIQUE (id, design_id);

ALTER TABLE ONLY public.library_artwork_revisions
    ADD CONSTRAINT library_artwork_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_assets
    ADD CONSTRAINT library_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_assets
    ADD CONSTRAINT library_assets_revision_id_kind_key UNIQUE (revision_id, kind);

ALTER TABLE ONLY public.library_collection_designs
    ADD CONSTRAINT library_collection_designs_pkey PRIMARY KEY (collection_id, design_id);

ALTER TABLE ONLY public.library_collections
    ADD CONSTRAINT library_collections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_design_colors
    ADD CONSTRAINT library_design_colors_design_id_position_key UNIQUE (design_id, "position");

ALTER TABLE ONLY public.library_design_colors
    ADD CONSTRAINT library_design_colors_pkey PRIMARY KEY (design_id, color_name);

ALTER TABLE ONLY public.library_designs
    ADD CONSTRAINT library_designs_display_number_key UNIQUE (display_number);

ALTER TABLE ONLY public.library_designs
    ADD CONSTRAINT library_designs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_favorites
    ADD CONSTRAINT library_favorites_pkey PRIMARY KEY (user_id, design_id);

ALTER TABLE ONLY public.library_product_bindings
    ADD CONSTRAINT library_product_bindings_canonical_design_id_shop_id_produc_key UNIQUE (canonical_design_id, shop_id, product_model_id);

ALTER TABLE ONLY public.library_product_bindings
    ADD CONSTRAINT library_product_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_product_bindings
    ADD CONSTRAINT library_product_bindings_shop_id_product_id_key UNIQUE (shop_id, product_id);

CREATE INDEX checkout_orders_alert_candidates_idx ON commerce.checkout_orders USING btree (((snapshot ->> 'shopId'::text)), request_id) WHERE (((payment ->> 'status'::text) = 'paid'::text) AND ((payment ->> 'livemode'::text) = 'true'::text) AND (state <> 'simulated'::text));

CREATE INDEX checkout_orders_shop_created_idx ON commerce.checkout_orders USING btree (((snapshot ->> 'shopId'::text)), created_at DESC, request_id DESC);

CREATE INDEX order_shipping_alerts_due_idx ON commerce.order_shipping_alerts USING btree (next_check_at, request_id) WHERE (completed_reason IS NULL);

CREATE INDEX printify_products_catalog ON commerce.printify_products USING btree (shop_id, sort_position) WHERE active;

CREATE INDEX printify_publish_jobs_due ON commerce.printify_publish_jobs USING btree (shop_id, next_attempt_at) WHERE (state = ANY (ARRAY['pending'::text, 'callback'::text]));

CREATE INDEX printify_publish_jobs_product ON commerce.printify_publish_jobs USING btree (shop_id, product_id, event_created_at DESC);

CREATE UNIQUE INDEX product_week_schedule_product_slot ON commerce.product_week_schedule USING btree (shop_id, product_id, live_at) WHERE (ended_at IS NULL);

CREATE INDEX product_week_schedule_slots ON commerce.product_week_schedule USING btree (shop_id, live_at) WHERE (ended_at IS NULL);

CREATE INDEX public_request_attempts_window_start_idx ON commerce.public_request_attempts USING btree (window_start);

CREATE UNIQUE INDEX shop_categories_name ON commerce.shop_categories USING btree (shop_id, lower(name));

CREATE INDEX admin_auth_attempts_window_start_idx ON private.admin_auth_attempts USING btree (window_start);

CREATE INDEX design_agent_grants_user ON private.design_agent_grants USING btree (user_id, created_at DESC);

CREATE INDEX design_draft_receipts_binding ON private.design_draft_write_receipts USING btree (binding_id, created_at);

CREATE INDEX design_product_attempt_request ON private.design_product_attempts USING btree (request_id, stage, created_at);

CREATE INDEX design_provider_capability_binding ON private.design_provider_capabilities USING btree (binding_id);

CREATE INDEX design_generation_candidates_batch ON public.design_generation_candidates USING btree (batch_id, slot);

CREATE INDEX library_asset_revision ON public.library_assets USING btree (revision_id);

CREATE INDEX library_collection_design ON public.library_collection_designs USING btree (design_id);

CREATE INDEX library_design_canonical ON public.library_designs USING btree (canonical_design_id);

CREATE INDEX library_design_color_design ON public.library_design_colors USING btree (design_id, "position");

CREATE INDEX library_design_family ON public.library_designs USING btree (family);

CREATE INDEX library_revision_design ON public.library_artwork_revisions USING btree (design_id);

CREATE FUNCTION private.claim_admin_owner(expected_user_id uuid, expected_email text) RETURNS boolean
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

CREATE FUNCTION private.consume_admin_setup() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.active then
    perform 1 from private.admin_setup_state where singleton = true for update;
    if not found then
      raise exception 'Admin setup state is missing';
    end if;
    update private.admin_setup_state set consumed_at = now(), claimed_by = new.user_id
      where singleton and consumed_at is null;
  end if;
  return new;
end;
$$;

CREATE FUNCTION private.is_active_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.admin_memberships m
    join auth.users u on u.id = m.user_id
    where m.user_id = (select auth.uid()) and m.active
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

CREATE FUNCTION private.protect_design_artwork_receipt() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'Verified product artwork receipts are immutable';
end;
$$;

CREATE TRIGGER immutable_design_product_artwork BEFORE DELETE OR UPDATE ON commerce.design_product_artwork FOR EACH ROW EXECUTE FUNCTION private.protect_design_artwork_receipt();

CREATE TRIGGER consume_admin_setup AFTER INSERT OR UPDATE OF active ON public.admin_memberships FOR EACH ROW EXECUTE FUNCTION private.consume_admin_setup();

ALTER TABLE ONLY commerce.design_product_artwork
    ADD CONSTRAINT design_product_artwork_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);

ALTER TABLE ONLY commerce.design_product_artwork
    ADD CONSTRAINT design_product_artwork_print_asset_id_fkey FOREIGN KEY (print_asset_id) REFERENCES public.library_assets(id);

ALTER TABLE ONLY commerce.design_product_artwork
    ADD CONSTRAINT design_product_artwork_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.library_artwork_revisions(id);

ALTER TABLE ONLY commerce.garment_models
    ADD CONSTRAINT garment_models_category FOREIGN KEY (shop_id, category_slug) REFERENCES commerce.shop_categories(shop_id, slug);

ALTER TABLE ONLY commerce.order_shipping_alerts
    ADD CONSTRAINT order_shipping_alerts_request_id_fkey FOREIGN KEY (request_id) REFERENCES commerce.checkout_orders(request_id) ON DELETE CASCADE;

ALTER TABLE ONLY commerce.printify_product_revisions
    ADD CONSTRAINT printify_product_revisions_event_id_fkey FOREIGN KEY (event_id) REFERENCES commerce.printify_publish_jobs(event_id);

ALTER TABLE ONLY commerce.printify_product_revisions
    ADD CONSTRAINT printify_product_revisions_shop_id_product_id_fkey FOREIGN KEY (shop_id, product_id) REFERENCES commerce.printify_products(shop_id, product_id);

ALTER TABLE ONLY commerce.printify_publish_jobs
    ADD CONSTRAINT printify_publish_jobs_shop_id_product_id_fkey FOREIGN KEY (shop_id, product_id) REFERENCES commerce.printify_products(shop_id, product_id);

ALTER TABLE ONLY commerce.product_week_schedule
    ADD CONSTRAINT product_week_schedule_shop_id_product_id_fkey FOREIGN KEY (shop_id, product_id) REFERENCES commerce.printify_products(shop_id, product_id);

ALTER TABLE ONLY commerce.published_image_uploads
    ADD CONSTRAINT published_image_uploads_shop_id_product_id_fkey FOREIGN KEY (shop_id, product_id) REFERENCES commerce.printify_products(shop_id, product_id);

ALTER TABLE ONLY private.design_agent_grants
    ADD CONSTRAINT design_agent_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY private.design_draft_items
    ADD CONSTRAINT design_draft_items_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.library_product_bindings(id);

ALTER TABLE ONLY private.design_draft_items
    ADD CONSTRAINT design_draft_items_canonical_design_id_fkey FOREIGN KEY (canonical_design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY private.design_draft_items
    ADD CONSTRAINT design_draft_items_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY private.design_draft_items
    ADD CONSTRAINT design_draft_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES private.design_draft_requests(id);

ALTER TABLE ONLY private.design_draft_items
    ADD CONSTRAINT design_draft_items_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.library_artwork_revisions(id);

ALTER TABLE ONLY private.design_draft_requests
    ADD CONSTRAINT design_draft_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY private.design_draft_write_receipts
    ADD CONSTRAINT design_draft_write_receipts_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.library_product_bindings(id);

ALTER TABLE ONLY private.design_draft_write_receipts
    ADD CONSTRAINT design_draft_write_receipts_request_id_fkey FOREIGN KEY (request_id) REFERENCES private.design_draft_requests(id);

ALTER TABLE ONLY private.design_product_attempts
    ADD CONSTRAINT design_product_attempts_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.library_assets(id);

ALTER TABLE ONLY private.design_product_attempts
    ADD CONSTRAINT design_product_attempts_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.library_product_bindings(id);

ALTER TABLE ONLY private.design_product_attempts
    ADD CONSTRAINT design_product_attempts_request_id_fkey FOREIGN KEY (request_id) REFERENCES private.design_draft_requests(id);

ALTER TABLE ONLY private.design_product_attempts
    ADD CONSTRAINT design_product_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY private.design_product_candidates
    ADD CONSTRAINT design_product_candidates_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES public.library_product_bindings(id);

ALTER TABLE ONLY private.design_provider_capabilities
    ADD CONSTRAINT design_provider_capabilities_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.library_assets(id);

ALTER TABLE ONLY private.design_provider_capabilities
    ADD CONSTRAINT design_provider_capabilities_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES private.design_product_attempts(binding_id);

ALTER TABLE ONLY private.design_provider_capabilities
    ADD CONSTRAINT design_provider_capabilities_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.library_artwork_revisions(id);

ALTER TABLE ONLY private.design_provider_capabilities
    ADD CONSTRAINT design_provider_capabilities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.admin_memberships
    ADD CONSTRAINT admin_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.design_generation_batches
    ADD CONSTRAINT design_generation_batches_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.library_collections(id);

ALTER TABLE ONLY public.design_generation_batches
    ADD CONSTRAINT design_generation_batches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.design_generation_candidates
    ADD CONSTRAINT design_generation_candidates_batch_id_slot_fkey FOREIGN KEY (batch_id, slot) REFERENCES public.design_generation_slots(batch_id, slot);

ALTER TABLE ONLY public.design_generation_slots
    ADD CONSTRAINT design_generation_slots_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.design_generation_batches(id);

ALTER TABLE ONLY public.design_generation_slots
    ADD CONSTRAINT design_generation_slots_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.design_generation_candidates(id);

ALTER TABLE ONLY public.library_artwork_fingerprints
    ADD CONSTRAINT library_artwork_fingerprints_canonical_design_id_fkey FOREIGN KEY (canonical_design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY public.library_artwork_revisions
    ADD CONSTRAINT library_artwork_revisions_assessed_by_fkey FOREIGN KEY (assessed_by) REFERENCES auth.users(id);

ALTER TABLE ONLY public.library_artwork_revisions
    ADD CONSTRAINT library_artwork_revisions_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY public.library_assets
    ADD CONSTRAINT library_assets_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.library_artwork_revisions(id);

ALTER TABLE ONLY public.library_collection_designs
    ADD CONSTRAINT library_collection_designs_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.library_collections(id);

ALTER TABLE ONLY public.library_collection_designs
    ADD CONSTRAINT library_collection_designs_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY public.library_designs
    ADD CONSTRAINT library_current_revision_owner FOREIGN KEY (current_revision_id, id) REFERENCES public.library_artwork_revisions(id, design_id);

ALTER TABLE ONLY public.library_design_colors
    ADD CONSTRAINT library_design_colors_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY public.library_designs
    ADD CONSTRAINT library_designs_canonical_design_id_fkey FOREIGN KEY (canonical_design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY public.library_favorites
    ADD CONSTRAINT library_favorites_design_id_fkey FOREIGN KEY (design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY public.library_favorites
    ADD CONSTRAINT library_favorites_revision_id_design_id_fkey FOREIGN KEY (revision_id, design_id) REFERENCES public.library_artwork_revisions(id, design_id);

ALTER TABLE ONLY public.library_favorites
    ADD CONSTRAINT library_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.library_product_bindings
    ADD CONSTRAINT library_product_bindings_canonical_design_id_fkey FOREIGN KEY (canonical_design_id) REFERENCES public.library_designs(id);

ALTER TABLE ONLY public.library_product_bindings
    ADD CONSTRAINT library_product_bindings_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.library_artwork_revisions(id);

ALTER TABLE commerce.catalog_refreshes ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.checkout_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.design_product_artwork ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.drop_subscribers ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.garment_models ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.order_shipping_alerts ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.printify_product_revisions ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.printify_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.printify_publish_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.product_week_schedule ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.public_request_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.published_image_uploads ENABLE ROW LEVEL SECURITY;

ALTER TABLE commerce.shop_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_runtime_delete ON commerce.public_request_attempts FOR DELETE TO store_app_runtime USING (true);

CREATE POLICY store_runtime_delete ON commerce.shop_categories FOR DELETE TO store_app_runtime USING (true);

CREATE POLICY store_runtime_insert ON commerce.catalog_refreshes FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.checkout_orders FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.design_product_artwork FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.drop_subscribers FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.garment_models FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.order_shipping_alerts FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.printify_product_revisions FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.printify_products FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.printify_publish_jobs FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.product_week_schedule FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.public_request_attempts FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.published_image_uploads FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON commerce.shop_categories FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_select ON commerce.catalog_refreshes FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.checkout_orders FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.design_product_artwork FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.drop_subscribers FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.garment_models FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.order_shipping_alerts FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.printify_product_revisions FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.printify_products FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.printify_publish_jobs FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.product_week_schedule FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.public_request_attempts FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.published_image_uploads FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON commerce.shop_categories FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_update ON commerce.catalog_refreshes FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.checkout_orders FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.drop_subscribers FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.garment_models FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.order_shipping_alerts FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.printify_products FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.printify_publish_jobs FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.product_week_schedule FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.public_request_attempts FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.published_image_uploads FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON commerce.shop_categories FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

ALTER TABLE private.admin_auth_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.admin_setup_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_agent_grants ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_draft_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_draft_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_draft_write_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_product_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_product_candidates ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_provider_capabilities ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.design_provider_source_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_runtime_delete ON private.admin_auth_attempts FOR DELETE TO store_app_runtime USING (true);

CREATE POLICY store_runtime_insert ON private.admin_auth_attempts FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_agent_grants FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_draft_items FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_draft_requests FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_draft_write_receipts FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_product_attempts FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_product_candidates FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_provider_capabilities FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON private.design_provider_source_evidence FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_select ON private.admin_auth_attempts FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.admin_setup_state FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_agent_grants FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_draft_items FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_draft_requests FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_draft_write_receipts FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_product_attempts FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_product_candidates FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_provider_capabilities FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON private.design_provider_source_evidence FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_update ON private.admin_auth_attempts FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON private.admin_setup_state FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON private.design_agent_grants FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON private.design_product_attempts FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON private.design_provider_capabilities FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY active_admin_read ON public.library_artwork_revisions FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY active_admin_read ON public.library_collection_designs FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY active_admin_read ON public.library_collections FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY active_admin_read ON public.library_design_colors FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY active_admin_read ON public.library_designs FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY active_admin_read ON public.library_product_bindings FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY admin_membership_self_read ON public.admin_memberships FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.admin_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.design_generation_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.design_generation_candidates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.design_generation_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY favorite_owner_delete ON public.library_favorites FOR DELETE TO authenticated USING ((( SELECT private.is_active_admin() AS is_active_admin) AND (user_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY favorite_owner_insert ON public.library_favorites FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_active_admin() AS is_active_admin) AND (user_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY favorite_owner_read ON public.library_favorites FOR SELECT TO authenticated USING ((( SELECT private.is_active_admin() AS is_active_admin) AND (user_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY favorite_owner_update ON public.library_favorites FOR UPDATE TO authenticated USING ((( SELECT private.is_active_admin() AS is_active_admin) AND (user_id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((( SELECT private.is_active_admin() AS is_active_admin) AND (user_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY generation_batches_admin_read ON public.design_generation_batches FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY generation_candidates_admin_read ON public.design_generation_candidates FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

CREATE POLICY generation_slots_admin_read ON public.design_generation_slots FOR SELECT TO authenticated USING (( SELECT private.is_active_admin() AS is_active_admin));

ALTER TABLE public.library_artwork_fingerprints ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_artwork_revisions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_assets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_collection_designs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_collections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_design_colors ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_designs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_favorites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_product_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_runtime_delete ON public.library_collection_designs FOR DELETE TO store_app_runtime USING (true);

CREATE POLICY store_runtime_delete ON public.library_design_colors FOR DELETE TO store_app_runtime USING (true);

CREATE POLICY store_runtime_delete ON public.library_favorites FOR DELETE TO store_app_runtime USING (true);

CREATE POLICY store_runtime_insert ON public.admin_memberships FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.design_generation_batches FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.design_generation_candidates FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.design_generation_slots FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_artwork_fingerprints FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_artwork_revisions FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_assets FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_collection_designs FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_collections FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_design_colors FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_designs FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_favorites FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_insert ON public.library_product_bindings FOR INSERT TO store_app_runtime WITH CHECK (true);

CREATE POLICY store_runtime_select ON public.admin_memberships FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.design_generation_batches FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.design_generation_candidates FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.design_generation_slots FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_artwork_fingerprints FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_artwork_revisions FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_assets FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_collection_designs FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_collections FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_design_colors FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_designs FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_favorites FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_select ON public.library_product_bindings FOR SELECT TO store_app_runtime USING (true);

CREATE POLICY store_runtime_update ON public.admin_memberships FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.design_generation_batches FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.design_generation_candidates FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.design_generation_slots FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.library_artwork_revisions FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.library_assets FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.library_collections FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.library_design_colors FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.library_designs FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.library_favorites FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

CREATE POLICY store_runtime_update ON public.library_product_bindings FOR UPDATE TO store_app_runtime USING (true) WITH CHECK (true);

-- Defaults and previous grants are additive: narrow GRANTs below do not replace
-- inherited ALL privileges. RLS does not protect TRUNCATE or sequence mutation.
REVOKE ALL ON ALL TABLES IN SCHEMA public, private, commerce FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, private, commerce FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA commerce TO store_app_runtime;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT USAGE ON SCHEMA private TO store_app_runtime;

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO store_app_runtime;

REVOKE ALL ON FUNCTION private.claim_admin_owner(expected_user_id uuid, expected_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.claim_admin_owner(expected_user_id uuid, expected_email text) TO service_role;
GRANT ALL ON FUNCTION private.claim_admin_owner(expected_user_id uuid, expected_email text) TO store_app_runtime;

REVOKE ALL ON FUNCTION private.consume_admin_setup() FROM PUBLIC;
GRANT ALL ON FUNCTION private.consume_admin_setup() TO service_role;
GRANT ALL ON FUNCTION private.consume_admin_setup() TO store_app_runtime;

REVOKE ALL ON FUNCTION private.is_active_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_active_admin() TO authenticated;
GRANT ALL ON FUNCTION private.is_active_admin() TO service_role;

REVOKE ALL ON FUNCTION private.protect_design_artwork_receipt() FROM PUBLIC;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.catalog_refreshes TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.checkout_orders TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE commerce.design_product_artwork TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.drop_subscribers TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.garment_models TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.order_shipping_alerts TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE commerce.printify_product_revisions TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.printify_products TO store_app_runtime;

GRANT USAGE ON SEQUENCE commerce.printify_products_sort_position_seq TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.printify_publish_jobs TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.product_week_schedule TO store_app_runtime;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE commerce.public_request_attempts TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE commerce.published_image_uploads TO store_app_runtime;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE commerce.shop_categories TO store_app_runtime;

GRANT ALL ON TABLE private.admin_auth_attempts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.admin_auth_attempts TO store_app_runtime;

GRANT ALL ON TABLE private.admin_setup_state TO service_role;
GRANT SELECT,UPDATE ON TABLE private.admin_setup_state TO store_app_runtime;

GRANT SELECT ON TABLE private.auth_session_identity TO store_app_runtime;

GRANT SELECT ON TABLE private.auth_user_identity TO store_app_runtime;

GRANT ALL ON TABLE private.design_agent_grants TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE private.design_agent_grants TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE private.design_draft_items TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE private.design_draft_requests TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE private.design_draft_write_receipts TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE private.design_product_attempts TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE private.design_product_candidates TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE private.design_provider_capabilities TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE private.design_provider_source_evidence TO store_app_runtime;

GRANT SELECT ON TABLE public.admin_memberships TO authenticated;
GRANT ALL ON TABLE public.admin_memberships TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.admin_memberships TO store_app_runtime;

GRANT SELECT ON TABLE public.design_generation_batches TO authenticated;
GRANT ALL ON TABLE public.design_generation_batches TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.design_generation_batches TO store_app_runtime;

GRANT SELECT ON TABLE public.design_generation_candidates TO authenticated;
GRANT ALL ON TABLE public.design_generation_candidates TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.design_generation_candidates TO store_app_runtime;

GRANT SELECT ON TABLE public.design_generation_slots TO authenticated;
GRANT ALL ON TABLE public.design_generation_slots TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.design_generation_slots TO store_app_runtime;

GRANT SELECT,INSERT ON TABLE public.library_artwork_fingerprints TO store_app_runtime;

GRANT SELECT ON TABLE public.library_artwork_revisions TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.library_artwork_revisions TO store_app_runtime;

GRANT SELECT,INSERT,UPDATE ON TABLE public.library_assets TO store_app_runtime;

GRANT SELECT ON TABLE public.library_collection_designs TO authenticated;
GRANT SELECT,INSERT,DELETE ON TABLE public.library_collection_designs TO store_app_runtime;

GRANT SELECT ON TABLE public.library_collections TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.library_collections TO store_app_runtime;

GRANT SELECT ON TABLE public.library_design_colors TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.library_design_colors TO store_app_runtime;

GRANT SELECT ON TABLE public.library_designs TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.library_designs TO store_app_runtime;

GRANT ALL ON SEQUENCE public.library_designs_display_number_seq TO store_app_runtime;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.library_favorites TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.library_favorites TO store_app_runtime;

GRANT SELECT ON TABLE public.library_product_bindings TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.library_product_bindings TO store_app_runtime;

-- One unclaimed owner setup slot; no owners, products, garments, or designs are seeded.
insert into private.admin_setup_state(singleton) values (true);
