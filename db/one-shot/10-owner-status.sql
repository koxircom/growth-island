-- Owner-only sanitized status. Never admits, renews, dispatches, or returns child data.
CREATE FUNCTION public.get_switch_test_status(p_parent_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; g private.switch_test_authorization; h private.switch_test_hold;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 f:=private.owned_family();
 IF f IS NULL OR NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 SELECT * INTO g FROM private.switch_test_authorization WHERE singleton AND owner_id=auth.uid() AND family_id=f;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO h FROM private.switch_test_hold WHERE request_id=g.request_id AND family_id=f;
 RETURN jsonb_build_object('operationId',g.request_id,'seconds',600,
 'status',CASE WHEN h.request_id IS NOT NULL THEN h.phase WHEN g.revoked THEN 'revoked'
 WHEN clock_timestamp()<g.not_before OR clock_timestamp()>=g.expires_at THEN 'expired' ELSE 'ready' END);
END $$;
REVOKE ALL ON FUNCTION public.get_switch_test_status(text) FROM PUBLIC,anon,growth_app,growth_switch_worker;
GRANT EXECUTE ON FUNCTION public.get_switch_test_status(text) TO authenticated;
