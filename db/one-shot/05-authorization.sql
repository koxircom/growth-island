-- ISOLATED CANDIDATE ONLY. Install on owner/worker side, NEVER in the test app DB.
CREATE TABLE private.switch_test_authorization (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 request_id uuid NOT NULL UNIQUE, owner_id uuid NOT NULL REFERENCES auth.users(id),
 family_id uuid NOT NULL REFERENCES public.families(id),
 binding_id uuid NOT NULL, device_id uuid NOT NULL, console_id text NOT NULL,
 seconds integer NOT NULL CHECK(seconds=600), source_reference text NOT NULL CHECK(length(source_reference)>0),
 not_before timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false,
 CHECK(expires_at>not_before AND expires_at<=not_before+interval '5 minutes')
);
REVOKE ALL ON private.switch_test_authorization FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
-- No endpoint can create/renew this row. Trusted operator provisions exactly the
-- documented owner's one-off authorization after checking prior action status.
CREATE FUNCTION public.request_switch_test(p_parent_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g private.switch_test_authorization; b private.switch_binding; f uuid; h jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required';END IF;
 f:=private.owned_family();
 IF f IS NULL OR NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required';END IF;
 -- Global lock order shared with dispatch and terminal reconciliation.
 PERFORM 1 FROM public.families WHERE id=f FOR UPDATE;
 SELECT * INTO b FROM private.switch_binding WHERE singleton FOR UPDATE;
 SELECT * INTO g FROM private.switch_test_authorization WHERE singleton FOR UPDATE;
 IF NOT FOUND OR g.owner_id<>auth.uid() OR g.family_id<>f OR g.revoked THEN RAISE EXCEPTION 'test_not_authorized';END IF;
 -- Replays are read-only, including after deadline. Never mint another request ID.
 SELECT to_jsonb(x) INTO h FROM private.switch_test_hold x WHERE request_id=g.request_id;
 IF h IS NULL THEN
  IF clock_timestamp()<g.not_before OR clock_timestamp()>=g.expires_at THEN RAISE EXCEPTION 'test_authorization_expired';END IF;
  IF b.family_id IS DISTINCT FROM g.family_id OR b.binding_id IS DISTINCT FROM g.binding_id
   OR b.device_id IS DISTINCT FROM g.device_id OR b.console_id IS DISTINCT FROM g.console_id THEN RAISE EXCEPTION 'test_binding_changed';END IF;
  h:=private.switch_test_admit(g.request_id,g.family_id,g.binding_id,g.expires_at);
 END IF;
 IF (h->>'family_id')::uuid IS DISTINCT FROM g.family_id OR (h->>'binding_id')::uuid IS DISTINCT FROM g.binding_id
 OR (h->>'device_id')::uuid IS DISTINCT FROM g.device_id OR h->>'console_id' IS DISTINCT FROM g.console_id
 OR (h->>'seconds')::int IS DISTINCT FROM 600 THEN RAISE EXCEPTION 'test_scope_conflict';END IF;
 -- No child identifiers, wallet data, raw signed packets, keys or transport details.
 RETURN jsonb_build_object('operationId',g.request_id,'seconds',600,'status',h->>'phase');
END $$;
REVOKE ALL ON FUNCTION public.request_switch_test(text) FROM PUBLIC,anon,growth_app,growth_switch_worker;
GRANT EXECUTE ON FUNCTION public.request_switch_test(text) TO authenticated;
