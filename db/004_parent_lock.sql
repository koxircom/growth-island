
-- Parent capabilities are individually revocable and scoped to the login that issued them.
ALTER TABLE private.parent_sessions ADD COLUMN auth_session_hash text;
CREATE INDEX parent_sessions_auth_session ON private.parent_sessions(auth_session_hash);

CREATE FUNCTION public.unlock_parent_for_session(p_pin text,p_session_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t text;
BEGIN
 PERFORM 1 FROM auth.sessions WHERE token_hash=p_session_hash AND user_id=auth.uid() AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'authentication_required';
 END IF;
 t:=public.unlock_parent(p_pin);
 IF t IS NOT NULL THEN
  UPDATE private.parent_sessions SET auth_session_hash=p_session_hash
  WHERE token_hash=encode(extensions.digest(t,'sha256'),'hex') AND user_id=auth.uid();
 END IF;
 RETURN t;
END $$;
CREATE FUNCTION public.lock_parent(p_parent_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_parent_token IS NULL OR p_parent_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 DELETE FROM private.parent_sessions
 WHERE token_hash=encode(extensions.digest(p_parent_token,'sha256'),'hex')
 AND user_id=auth.uid() AND family_id=private.owned_family();
 RETURN jsonb_build_object('revoked',true);
END $$;
REVOKE ALL ON FUNCTION public.unlock_parent_for_session(text,text),public.lock_parent(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.unlock_parent_for_session(text,text),public.lock_parent(text) TO authenticated;

CREATE FUNCTION auth.logout_session(p_session_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid;
BEGIN
 SELECT user_id INTO u FROM auth.sessions WHERE token_hash=p_session_hash FOR UPDATE;
 IF u IS NOT NULL THEN
  DELETE FROM private.parent_sessions WHERE auth_session_hash=p_session_hash AND user_id=u;
  DELETE FROM auth.sessions WHERE token_hash=p_session_hash;
 END IF;
END $$;
REVOKE ALL ON FUNCTION auth.logout_session(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.logout_session(text) TO growth_app;
