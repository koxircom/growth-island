
CREATE TABLE auth.household_login (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 user_id uuid UNIQUE REFERENCES auth.users(id),
 setup_until timestamptz
);
INSERT INTO auth.household_login(singleton) VALUES(true);
REVOKE ALL ON auth.household_login FROM PUBLIC,anon,authenticated,growth_app;
GRANT SELECT ON auth.household_login TO growth_app;

CREATE FUNCTION auth.initialize_household(p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s auth.household_login; u uuid;
BEGIN
 SELECT * INTO s FROM auth.household_login WHERE singleton FOR UPDATE;
 IF s.user_id IS NOT NULL OR s.setup_until IS NULL OR s.setup_until<=now() THEN
  RAISE EXCEPTION 'setup_closed';
 END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE email !~ '^qa-nas-[ab]-[0-9]+@example[.]test$') THEN
  RAISE EXCEPTION 'existing_account_requires_adoption';
 END IF;
 IF p_hash !~ '^scrypt[$][a-f0-9]{32}[$][a-f0-9]{128}$' THEN RAISE EXCEPTION 'invalid_hash'; END IF;
 INSERT INTO auth.users(email,password_hash) VALUES('household@local.invalid',p_hash) RETURNING id INTO u;
 UPDATE auth.household_login SET user_id=u,setup_until=NULL WHERE singleton;
 RETURN u;
END $$;
REVOKE ALL ON FUNCTION auth.initialize_household(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.initialize_household(text) TO growth_app;

CREATE FUNCTION auth.replace_household_password(p_user uuid,p_hash text,p_token text,p_expected text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended((SELECT email FROM auth.users WHERE id=p_user),1));
 PERFORM 1 FROM auth.household_login WHERE singleton AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_household_owner'; END IF;
 IF p_hash !~ '^scrypt[$][a-f0-9]{32}[$][a-f0-9]{128}$' THEN RAISE EXCEPTION 'invalid_hash'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND password_hash=p_expected) OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE token_hash=p_token AND user_id=p_user AND expires_at>now()) THEN RAISE EXCEPTION 'stale_credentials'; END IF;
 UPDATE auth.users SET password_hash=p_hash WHERE id=p_user;
 DELETE FROM auth.sessions WHERE user_id=p_user AND token_hash<>p_token;
 DELETE FROM private.parent_sessions WHERE user_id=p_user;
END $$;
REVOKE ALL ON FUNCTION auth.replace_household_password(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.replace_household_password(uuid,text,text,text) TO growth_app;
