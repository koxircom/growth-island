-- ISOLATED: apply after authorized-dispatch.sql and worker-main-selector.sql.
-- Existing growth_switch_worker is the trusted HMAC verifier/publisher already.
-- No browser roles, private-table grants, new credentials, or pre-auth bypass.
CREATE FUNCTION public.switch_test_current(i uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.test_current(i); $$;
REVOKE ALL ON FUNCTION public.switch_test_current(uuid) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_current(uuid) TO growth_switch_worker;
CREATE FUNCTION public.switch_test_prepare(i uuid,c jsonb,h text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.test_prepare(i,c,h); $$;
REVOKE ALL ON FUNCTION public.switch_test_prepare(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_prepare(uuid,jsonb,text) TO growth_switch_worker;
CREATE FUNCTION public.switch_test_dispatch_once(i uuid,h text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.test_dispatch_once(i,h); $$;
REVOKE ALL ON FUNCTION public.switch_test_dispatch_once(uuid,text) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_dispatch_once(uuid,text) TO growth_switch_worker;
CREATE FUNCTION public.switch_test_unknown(i uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.test_unknown(i); $$;
REVOKE ALL ON FUNCTION public.switch_test_unknown(uuid) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_unknown(uuid) TO growth_switch_worker;
CREATE FUNCTION public.switch_test_receipt(i uuid,h text,wire text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.test_receipt(i,h,wire); $$;
REVOKE ALL ON FUNCTION public.switch_test_receipt(uuid,text,text) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_receipt(uuid,text,text) TO growth_switch_worker;
CREATE FUNCTION public.switch_test_record_verified(i uuid,r bigint,wire text,s jsonb) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.test_record_verified(i,r,wire,s); $$;
REVOKE ALL ON FUNCTION public.switch_test_record_verified(uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_record_verified(uuid,bigint,text,jsonb) TO growth_switch_worker;
CREATE FUNCTION public.switch_test_select_request(s text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT private.test_select_request(s); $$;
REVOKE ALL ON FUNCTION public.switch_test_select_request(text) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_select_request(text) TO growth_switch_worker;
CREATE FUNCTION public.switch_test_evidence_context(i uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bid uuid; o private.switch_test_hold;
BEGIN
 SELECT binding_id INTO bid FROM private.switch_test_hold WHERE request_id=i;
 IF NOT FOUND THEN RAISE EXCEPTION 'missing'; END IF;
 PERFORM private.test_lock_binding(bid);
 SELECT * INTO o FROM private.switch_test_hold WHERE request_id=i FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'missing'; END IF;
 RETURN to_jsonb(o);
END $$;
REVOKE ALL ON FUNCTION public.switch_test_evidence_context(uuid) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_test_evidence_context(uuid) TO growth_switch_worker;
-- Defense in depth: the role can invoke only guarded wrappers, never either
-- underlying dispatch function, admission, or raw table modification.
REVOKE ALL ON private.switch_test_hold,private.switch_test_authorization FROM growth_switch_worker;
REVOKE ALL ON FUNCTION private.test_current(uuid),private.test_prepare(uuid,jsonb,text),
 private.test_dispatch_once(uuid,text),private.test_dispatch_before_authorization(uuid,text),
 private.test_unknown(uuid),private.test_receipt(uuid,text,text),
 private.test_record_verified(uuid,bigint,text,jsonb),private.test_lock_binding(uuid),
 private.test_select_request(text),private.switch_test_admit(uuid,uuid,uuid,timestamptz)
 FROM growth_switch_worker;
