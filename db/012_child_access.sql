
-- Owner-confirmed LAN child access and single existing parent password.
ALTER TABLE auth.household_login ADD COLUMN login_lockout_enabled boolean NOT NULL DEFAULT false;
CREATE FUNCTION auth.issue_password_parent(p_session text,p_expected_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; f uuid; t text;
BEGIN
 SELECT s.user_id INTO u FROM auth.sessions s JOIN auth.users a ON a.id=s.user_id
 JOIN auth.household_login h ON h.user_id=a.id
 WHERE s.token_hash=p_session AND s.expires_at>now() AND a.password_hash=p_expected_hash FOR UPDATE OF s;
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=u ORDER BY created_at,id LIMIT 1;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 t:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO private.parent_sessions(token_hash,family_id,user_id,expires_at,auth_session_hash)
 VALUES(encode(extensions.digest(t,'sha256'),'hex'),f,u,now()+interval '30 minutes',p_session);
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION auth.issue_password_parent(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.issue_password_parent(text,text) TO growth_app;

CREATE OR REPLACE FUNCTION private.parent_valid(f uuid,t text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT t IS NOT NULL AND EXISTS(
 SELECT 1 FROM private.parent_sessions p JOIN auth.sessions s ON s.token_hash=p.auth_session_hash
 WHERE p.token_hash=encode(extensions.digest(t,'sha256'),'hex') AND p.family_id=f
 AND p.user_id=auth.uid() AND p.auth_session_hash=current_setting('request.session_hash',true) AND p.expires_at>now() AND s.expires_at>now() AND s.user_id=p.user_id)
$$;
-- No old PIN entry point can create fresh parent capabilities.
REVOKE EXECUTE ON FUNCTION public.unlock_parent(text),public.unlock_parent_for_session(text,text) FROM authenticated;
ALTER FUNCTION public.get_dashboard() RENAME TO get_dashboard_before_child_access;
ALTER FUNCTION public.get_dashboard_before_child_access() SET SCHEMA private;
REVOKE ALL ON FUNCTION private.get_dashboard_before_child_access() FROM PUBLIC,anon,authenticated,growth_app;
CREATE FUNCTION public.get_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; enabled boolean;
BEGIN
 result:=private.get_dashboard_before_child_access();
 SELECT login_lockout_enabled INTO enabled FROM auth.household_login WHERE user_id=auth.uid();
 RETURN jsonb_set(result,'{family,login_lockout_enabled}',to_jsonb(coalesce(enabled,false)));
END $$;
REVOKE ALL ON FUNCTION public.get_dashboard() FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.get_dashboard() TO authenticated;
CREATE FUNCTION public.set_parent_lockout(p_enabled boolean,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;
BEGIN
 f:=private.owned_family();
 IF NOT private.parent_valid(f,p_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 UPDATE auth.household_login SET login_lockout_enabled=p_enabled WHERE user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'authentication_required'; END IF;
 DELETE FROM auth.login_attempts;
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.set_parent_lockout(boolean,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.set_parent_lockout(boolean,text) TO authenticated;

CREATE FUNCTION auth.child_household_owner() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT h.user_id FROM auth.household_login h JOIN public.families f ON f.owner_id=h.user_id WHERE h.singleton
$$;
REVOKE ALL ON FUNCTION auth.child_household_owner() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.child_household_owner() TO growth_app;
