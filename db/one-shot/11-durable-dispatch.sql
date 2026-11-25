-- ISOLATED CANDIDATE. Existing prepared operations are NEVER presumed unsent.
CREATE TABLE private.switch_dispatch_journal(
 request_id uuid PRIMARY KEY REFERENCES private.switch_operations(request_id),
 state text NOT NULL CHECK(state IN ('unsent','dispatching','legacy_unknown')),
 command_hash text,
 dispatched_at timestamptz
);
INSERT INTO private.switch_dispatch_journal(request_id,state,command_hash)
 SELECT request_id,'legacy_unknown',command_hash FROM private.switch_operations WHERE command IS NOT NULL;
REVOKE ALL ON private.switch_dispatch_journal FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
ALTER FUNCTION public.switch_prepare_operation(uuid,jsonb,text) RENAME TO switch_prepare_before_dispatch;
ALTER FUNCTION public.switch_prepare_before_dispatch(uuid,jsonb,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.switch_prepare_before_dispatch(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;

CREATE FUNCTION public.switch_prepare_operation(p_request_id uuid,p_command jsonb,p_command_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.switch_operations%rowtype; j private.switch_dispatch_journal%rowtype;
BEGIN
 IF session_user<>'growth_switch_worker' AND NOT pg_has_role(session_user,'growth_switch_worker','member') THEN RAISE EXCEPTION 'worker_required'; END IF;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_switch_operation'; END IF;
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 PERFORM 1 FROM private.switch_binding WHERE singleton FOR UPDATE;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id FOR UPDATE;
 SELECT * INTO j FROM private.switch_dispatch_journal WHERE request_id=p_request_id FOR UPDATE;
 IF o.resolved THEN RAISE EXCEPTION 'operation_resolved'; END IF;
 IF EXISTS(SELECT 1 FROM private.switch_test_hold WHERE binding_id=o.binding_id AND phase<>'resolved') THEN RAISE EXCEPTION 'test_hold_active'; END IF;
 IF o.command IS NOT NULL THEN
  IF j.state IS DISTINCT FROM 'unsent' THEN RAISE EXCEPTION 'dispatch_may_have_occurred'; END IF;
  -- The only refresh allowed is a command proven never dispatched by this protocol.
  UPDATE private.switch_operations SET command=NULL,command_hash=NULL,phase=NULL WHERE request_id=p_request_id;
 END IF;
 PERFORM private.switch_prepare_before_dispatch(p_request_id,p_command,p_command_hash);
 INSERT INTO private.switch_dispatch_journal(request_id,state,command_hash)
 VALUES(p_request_id,'unsent',p_command_hash)
 ON CONFLICT(request_id) DO UPDATE SET command_hash=EXCLUDED.command_hash;
END $$;

CREATE FUNCTION public.switch_dispatch_state(p_request_id uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT state FROM private.switch_dispatch_journal WHERE request_id=p_request_id
$$;

CREATE FUNCTION public.switch_dispatch_once(p_request_id uuid,p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.switch_operations%rowtype; j private.switch_dispatch_journal%rowtype;
BEGIN
 IF session_user<>'growth_switch_worker' AND NOT pg_has_role(session_user,'growth_switch_worker','member') THEN RAISE EXCEPTION 'worker_required'; END IF;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 PERFORM 1 FROM private.switch_binding WHERE singleton FOR UPDATE;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id FOR UPDATE;
 SELECT * INTO j FROM private.switch_dispatch_journal WHERE request_id=p_request_id FOR UPDATE;
 IF o.resolved OR j.state IS DISTINCT FROM 'unsent' OR p_hash IS NULL
  OR o.command_hash IS DISTINCT FROM p_hash OR j.command_hash IS DISTINCT FROM p_hash THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM private.switch_test_hold WHERE binding_id=o.binding_id AND phase<>'resolved') THEN RETURN false; END IF;
 IF (o.command->>'accept_before')::bigint<=extract(epoch from clock_timestamp()) THEN RETURN false; END IF;
 PERFORM private.switch_assert_command_ready(o.family_id,o.binding_id,o.console_id,o.action,o.usage_id,o.sequence,o.command->>'boot_id');
 UPDATE private.switch_dispatch_journal SET state='dispatching',dispatched_at=clock_timestamp() WHERE request_id=p_request_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.switch_prepare_operation(uuid,jsonb,text),public.switch_dispatch_state(uuid),public.switch_dispatch_once(uuid,text) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_prepare_operation(uuid,jsonb,text),public.switch_dispatch_state(uuid),public.switch_dispatch_once(uuid,text) TO growth_switch_worker;
