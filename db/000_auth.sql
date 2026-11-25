-- Compatibility layer for the unchanged, independently tested business migration.
CREATE SCHEMA IF NOT EXISTS auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) <= 254),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON auth.sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth.login_attempts (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts >= 0),
  window_start timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC,anon,authenticated;
