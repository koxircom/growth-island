
-- ISOLATED integration candidate only, no public admission grants, no transport.
CREATE TABLE private.switch_test_hold(
 request_id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES public.families,
 binding_id uuid NOT NULL, console_id text NOT NULL, device_id uuid NOT NULL,
 sequence bigint NOT NULL, seconds int NOT NULL CHECK(seconds=600),
 authorized_until timestamptz NOT NULL,
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','dispatching','unknown','active','resolved')),
 UNIQUE(binding_id,sequence));
CREATE UNIQUE INDEX switch_test_one_hold ON private.switch_test_hold((true)) WHERE phase<>'resolved';
REVOKE ALL ON private.switch_test_hold FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
CREATE FUNCTION private.switch_test_admit(i uuid,f uuid,bid uuid,deadline timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE b private.switch_binding%rowtype;old private.switch_test_hold%rowtype;
BEGIN
 -- Trusted owner-authorizing endpoint must establish scope before this function.
 IF i IS NULL OR f IS NULL OR bid IS NULL OR deadline IS NULL THEN RAISE EXCEPTION 'invalid_request';END IF;
 PERFORM 1 FROM public.families WHERE id=f FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'family_not_found';END IF;
 SELECT * INTO b FROM private.switch_binding WHERE singleton FOR UPDATE;
 SELECT * INTO old FROM private.switch_test_hold WHERE request_id=i;
 IF FOUND THEN
 IF old.family_id<>f OR old.binding_id<>bid OR old.authorized_until<>deadline THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
 RETURN to_jsonb(old);END IF;
 IF b.family_id IS DISTINCT FROM f OR b.binding_id IS DISTINCT FROM bid OR NOT b.enabled
 OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'test_scope_invalid';END IF;
 IF EXISTS(SELECT 1 FROM private.switch_test_hold WHERE phase<>'resolved')
 OR EXISTS(SELECT 1 FROM private.switch_operations WHERE NOT resolved)
 OR EXISTS(SELECT 1 FROM private.switch_sessions WHERE state<>'ended') THEN RAISE EXCEPTION 'switch_busy';END IF;
 PERFORM private.switch_assert_send_ready(f,bid,b.console_id);
 UPDATE private.switch_binding SET next_sequence=next_sequence+1 WHERE singleton RETURNING * INTO b;
 INSERT INTO private.switch_test_hold(request_id,family_id,binding_id,console_id,device_id,sequence,seconds,authorized_until)
 VALUES(i,f,bid,b.console_id,b.device_id,b.next_sequence,600,deadline) RETURNING * INTO old;
 RETURN to_jsonb(old);
END $$;
REVOKE ALL ON FUNCTION private.switch_test_admit(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
ALTER FUNCTION public.family_mutate(text,jsonb,uuid,text) RENAME TO family_mutate_before_test_hold;
ALTER FUNCTION public.family_mutate_before_test_hold(text,jsonb,uuid,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.family_mutate_before_test_hold(text,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
CREATE FUNCTION public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;b private.switch_binding%rowtype;target_device uuid;target_usage uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required';END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 -- Preserve the existing authenticated idempotency/conflict check verbatim by
 -- delegating already committed request IDs before applying a new-operation hold.
 IF EXISTS(SELECT 1 FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id) THEN
  RETURN private.family_mutate_before_test_hold(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 SELECT * INTO b FROM private.switch_binding WHERE singleton FOR UPDATE;
 IF p_action='device_time_start' THEN target_device:=(p_payload->>'device_id')::uuid;
 ELSIF p_action='device_save' THEN target_device:=(p_payload->>'id')::uuid;
 ELSIF p_action IN ('device_time_extend','device_time_stop') THEN
  target_usage:=(p_payload->>'id')::uuid;
  SELECT ss.device_id INTO target_device FROM private.switch_sessions ss WHERE ss.family_id=f AND ss.id=target_usage;
 END IF;
 IF b.family_id=f AND EXISTS(SELECT 1 FROM private.switch_test_hold WHERE phase<>'resolved')
 AND (p_action='switch_bind' OR
 (p_action='device_time_start' AND target_device=b.device_id) OR
 (p_action IN ('device_time_extend','device_time_stop') AND target_device=b.device_id) OR
 (p_action='device_save' AND target_device=b.device_id))
 THEN RAISE EXCEPTION 'switch_test_in_progress';END IF;
 RETURN private.family_mutate_before_test_hold(p_action,p_payload,p_request_id,p_parent_token);
END $$;
REVOKE ALL ON FUNCTION public.family_mutate(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_mutate(text,jsonb,uuid,text) TO authenticated;
