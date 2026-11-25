-- Child spending identity; no balances/history rewritten.
CREATE TABLE private.child_credentials (
 child_id uuid PRIMARY KEY REFERENCES public.children(id), family_id uuid NOT NULL,
 password_hash text NOT NULL, password_cipher text NOT NULL, version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id)
);
CREATE TABLE private.child_access_sessions (
 browser_hash text PRIMARY KEY, family_id uuid NOT NULL REFERENCES public.families(id),
 child_id uuid NOT NULL, credential_version bigint NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id)
);
CREATE TABLE private.child_enrollments (
 browser_hash text PRIMARY KEY, family_id uuid NOT NULL, child_id uuid NOT NULL,
 expires_at timestamptz NOT NULL, FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id)
);
CREATE TABLE private.child_password_attempts (
 family_id uuid NOT NULL, child_id uuid NOT NULL, attempts integer NOT NULL DEFAULT 0,
 window_start timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(family_id,child_id)
);
REVOKE ALL ON private.child_credentials,private.child_access_sessions,private.child_enrollments,private.child_password_attempts FROM PUBLIC,anon,authenticated,growth_app;

CREATE FUNCTION public.child_access(p_action text,p_payload jsonb,p_parent_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; c uuid; bh text; pw text; cipher text; cr private.child_credentials%rowtype;
 rate private.child_password_attempts%rowtype; ss private.child_access_sessions%rowtype;
BEGIN
 f:=private.owned_family();
 -- Serializes enrollment/password reset/lock with spending guards.
 PERFORM 1 FROM public.families WHERE id=f FOR UPDATE;
 bh:=current_setting('request.child_browser_hash',true);
 IF bh IS NULL OR bh !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'child_unlock_required'; END IF;
 IF p_action='lock' THEN
  DELETE FROM private.child_access_sessions WHERE browser_hash=bh AND family_id=f;
  DELETE FROM private.child_enrollments WHERE browser_hash=bh AND family_id=f;
 ELSIF p_action<>'status' THEN
  c:=(p_payload->>'child_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
  SELECT * INTO cr FROM private.child_credentials WHERE child_id=c AND family_id=f;
  IF p_action IN ('enroll','change','view') AND NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
  IF p_action='enroll' THEN
   IF cr.child_id IS NOT NULL THEN RAISE EXCEPTION 'child_password_already_set'; END IF;
   INSERT INTO private.child_enrollments VALUES(bh,f,c,clock_timestamp()+interval '5 minutes')
   ON CONFLICT(browser_hash) DO UPDATE SET family_id=excluded.family_id,child_id=excluded.child_id,expires_at=excluded.expires_at;
   DELETE FROM private.child_access_sessions WHERE browser_hash=bh;
  ELSIF p_action='view' THEN
   IF cr.child_id IS NULL THEN RAISE EXCEPTION 'child_password_not_set'; END IF;
   RETURN jsonb_build_object('password_cipher',cr.password_cipher);
  ELSIF p_action IN ('setup','change') THEN
   IF p_action='setup' THEN
    IF cr.child_id IS NOT NULL THEN RAISE EXCEPTION 'child_password_already_set'; END IF;
    IF NOT EXISTS(SELECT 1 FROM private.child_enrollments WHERE browser_hash=bh AND family_id=f AND child_id=c AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'parent_required'; END IF;
   END IF;
   pw:=p_payload->>'password'; cipher:=p_payload->>'password_cipher';
   IF pw IS NULL OR char_length(pw)<4 OR char_length(pw)>32 OR octet_length(pw)>72 OR cipher IS NULL OR length(cipher)>2048 OR cipher NOT LIKE 'v1.%' THEN RAISE EXCEPTION 'invalid_child_password'; END IF;
   INSERT INTO private.child_credentials(child_id,family_id,password_hash,password_cipher)
   VALUES(c,f,extensions.crypt(pw,extensions.gen_salt('bf',10)),cipher)
   ON CONFLICT(child_id) DO UPDATE SET password_hash=excluded.password_hash,password_cipher=excluded.password_cipher,version=private.child_credentials.version+1,updated_at=clock_timestamp();
   DELETE FROM private.child_access_sessions WHERE child_id=c AND family_id=f;
   DELETE FROM private.child_enrollments WHERE child_id=c AND family_id=f;
   DELETE FROM private.child_password_attempts WHERE child_id=c AND family_id=f;
  ELSIF p_action='unlock' THEN
   pw:=p_payload->>'password';
   IF pw IS NULL OR char_length(pw)>32 OR octet_length(pw)>72 THEN RETURN jsonb_build_object('error','child_password_invalid'); END IF;
   INSERT INTO private.child_password_attempts(family_id,child_id) VALUES(f,c) ON CONFLICT DO NOTHING;
   SELECT * INTO rate FROM private.child_password_attempts WHERE family_id=f AND child_id=c FOR UPDATE;
   IF rate.window_start<=clock_timestamp()-interval '10 minutes' THEN
    UPDATE private.child_password_attempts SET attempts=0,window_start=clock_timestamp() WHERE family_id=f AND child_id=c; rate.attempts:=0;
   END IF;
   IF rate.attempts>=5 THEN RETURN jsonb_build_object('error','child_password_rate_limited'); END IF;
   UPDATE private.child_password_attempts SET attempts=attempts+1 WHERE family_id=f AND child_id=c;
   IF cr.child_id IS NULL OR extensions.crypt(pw,cr.password_hash) IS DISTINCT FROM cr.password_hash THEN RETURN jsonb_build_object('error','child_password_invalid'); END IF;
   DELETE FROM private.child_password_attempts WHERE family_id=f AND child_id=c;
   INSERT INTO private.child_access_sessions VALUES(bh,f,c,cr.version,clock_timestamp()+interval '10 minutes')
   ON CONFLICT(browser_hash) DO UPDATE SET family_id=excluded.family_id,child_id=excluded.child_id,credential_version=excluded.credential_version,expires_at=excluded.expires_at;
   DELETE FROM private.child_enrollments WHERE browser_hash=bh;
  ELSE RAISE EXCEPTION 'invalid_request';
  END IF;
 END IF;
 SELECT s.* INTO ss FROM private.child_access_sessions s JOIN private.child_credentials k ON k.child_id=s.child_id AND k.version=s.credential_version
 WHERE s.browser_hash=bh AND s.family_id=f AND s.expires_at>clock_timestamp();
 RETURN jsonb_build_object(
 'children',coalesce((SELECT jsonb_agg(jsonb_build_object('id',ch.id,'configured',EXISTS(SELECT 1 FROM private.child_credentials k WHERE k.child_id=ch.id))) FROM public.children ch WHERE ch.family_id=f),'[]'::jsonb),
 'unlocked_child_id',ss.child_id,'expires_at',ss.expires_at,'server_now',clock_timestamp(),
 'enrollment_child_id',(SELECT child_id FROM private.child_enrollments WHERE browser_hash=bh AND family_id=f AND expires_at>clock_timestamp()));
END $$;
REVOKE ALL ON FUNCTION public.child_access(text,jsonb,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.child_access(text,jsonb,text) TO authenticated;

CREATE FUNCTION private.child_spending_guard(f uuid,c uuid,p_parent text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF c IS NULL THEN RAISE EXCEPTION 'child_unlock_required'; END IF;
 IF private.parent_valid(f,p_parent) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.child_access_sessions s JOIN private.child_credentials k ON k.child_id=s.child_id AND k.version=s.credential_version
 WHERE s.browser_hash=current_setting('request.child_browser_hash',true) AND s.family_id=f AND s.child_id=c AND s.expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'child_unlock_required'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.child_spending_guard(uuid,uuid,text) FROM PUBLIC,anon,authenticated,growth_app;

ALTER FUNCTION public.family_mutate(text,jsonb,uuid,text) RENAME TO family_mutate_before_child_password;
ALTER FUNCTION public.family_mutate_before_child_password(text,jsonb,uuid,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.family_mutate_before_child_password(text,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,growth_app;
CREATE FUNCTION public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; c uuid;
BEGIN
 f:=private.owned_family();
 PERFORM 1 FROM public.families WHERE id=f FOR UPDATE;
 IF p_action IN ('redeem','device_time_start','undo_checkin','redeem_undo','device_time_extend','device_time_stop') THEN
  IF p_action IN ('redeem','device_time_start') THEN c:=(p_payload->>'child_id')::uuid;
  ELSIF p_action='redeem_undo' THEN SELECT child_id INTO c FROM public.redemptions WHERE id=(p_payload->>'id')::uuid AND family_id=f;
  ELSIF p_action='undo_checkin' THEN SELECT child_id INTO c FROM public.checkins WHERE id=(p_payload->>'id')::uuid AND family_id=f;
  ELSE
   SELECT child_id INTO c FROM private.switch_sessions WHERE id=(p_payload->>'id')::uuid AND family_id=f;
   IF c IS NULL THEN SELECT child_id INTO c FROM private.tv_sessions WHERE id=(p_payload->>'id')::uuid AND family_id=f; END IF;
   IF c IS NULL THEN SELECT child_id INTO c FROM public.device_usage_sessions WHERE id=(p_payload->>'id')::uuid AND family_id=f; END IF;
  END IF;
  PERFORM private.child_spending_guard(f,c,p_parent_token);
 END IF;
 RETURN private.family_mutate_before_child_password(p_action,p_payload,p_request_id,p_parent_token);
END $$;
REVOKE ALL ON FUNCTION public.family_mutate(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_mutate(text,jsonb,uuid,text) TO authenticated;
