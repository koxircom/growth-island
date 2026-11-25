-- ISOLATED R7 combined journal candidate; no grants, endpoints or transport.
ALTER TABLE private.switch_test_hold DROP CONSTRAINT switch_test_hold_phase_check;
ALTER TABLE private.switch_test_hold ADD CHECK(phase IN ('queued','prepared','dispatching','unknown','active','resolved'));
ALTER TABLE private.switch_test_hold ADD COLUMN id uuid GENERATED ALWAYS AS(request_id) STORED;
ALTER TABLE private.switch_test_hold ADD COLUMN binding uuid GENERATED ALWAYS AS(binding_id) STORED;
ALTER TABLE private.switch_test_hold ADD COLUMN command jsonb;
ALTER TABLE private.switch_test_hold ADD COLUMN hash text;
CREATE FUNCTION private.test_lock_binding(bid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f uuid;
BEGIN
 SELECT family_id INTO f FROM private.switch_binding WHERE singleton AND binding_id=bid;
 IF f IS NULL THEN RAISE EXCEPTION 'binding_changed';END IF;
 PERFORM 1 FROM public.families WHERE id=f FOR UPDATE;
 PERFORM 1 FROM private.switch_binding WHERE singleton AND binding_id=bid AND family_id=f FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'binding_changed';END IF;
END $$;
REVOKE ALL ON FUNCTION private.test_lock_binding(uuid) FROM PUBLIC;
CREATE FUNCTION private.test_prepare(i uuid,c jsonb,h text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o private.switch_test_hold;b uuid;
BEGIN
 SELECT binding INTO b FROM private.switch_test_hold WHERE id=i; IF NOT FOUND THEN RAISE EXCEPTION 'missing'; END IF;
 PERFORM private.test_lock_binding(b); SELECT * INTO o FROM private.switch_test_hold WHERE id=i FOR UPDATE;
 IF c->>'console_id' IS DISTINCT FROM o.console_id OR c->>'session_id' IS DISTINCT FROM o.request_id::text OR c IS NULL OR h IS NULL OR h!~'^[a-f0-9]{64}$' OR c->>'binding_id' IS DISTINCT FROM b::text OR c->>'request_id' IS DISTINCT FROM i::text OR c->>'sequence' IS DISTINCT FROM o.sequence::text OR c->>'total_seconds' IS DISTINCT FROM '600' OR c->>'action' IS DISTINCT FROM 'start' THEN RAISE EXCEPTION 'invalid_command'; END IF;
 IF o.phase='prepared' AND o.command=c AND o.hash=h THEN RETURN to_jsonb(o); END IF;
 IF o.phase<>'queued' THEN RAISE EXCEPTION 'prepare_forbidden'; END IF;
 UPDATE private.switch_test_hold SET phase='prepared',command=c,hash=h WHERE id=i RETURNING * INTO o; RETURN to_jsonb(o);
END $$;
CREATE FUNCTION private.test_dispatch_once(i uuid,h text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE o private.switch_test_hold;
BEGIN
 SELECT * INTO o FROM private.switch_test_hold WHERE request_id=i;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM private.test_lock_binding(o.binding_id);
 SELECT * INTO o FROM private.switch_test_hold WHERE request_id=i FOR UPDATE;
 IF o.phase<>'prepared' OR o.hash IS DISTINCT FROM h OR o.authorized_until<=clock_timestamp()
 OR EXISTS(SELECT 1 FROM private.switch_operations WHERE NOT resolved)
 OR EXISTS(SELECT 1 FROM private.switch_sessions WHERE state<>'ended') THEN RETURN false;END IF;
 PERFORM private.switch_assert_send_ready(o.family_id,o.binding_id,o.console_id);
 UPDATE private.switch_test_hold SET phase='dispatching' WHERE request_id=i;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.test_prepare(uuid,jsonb,text),private.test_dispatch_once(uuid,text) FROM PUBLIC;

-- ISOLATED ONLY. Callable only by trusted verifier; DB does not possess HMAC key.
ALTER TABLE private.switch_test_hold ADD COLUMN evidence_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE private.switch_test_hold ADD COLUMN terminal_wire text;
ALTER TABLE private.switch_test_hold ADD COLUMN terminal_state jsonb;

CREATE FUNCTION private.test_record_verified(i uuid,expected_revision bigint,wire text,s jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE o private.switch_test_hold;b uuid;w jsonb;
BEGIN
 SELECT binding INTO b FROM private.switch_test_hold WHERE id=i;
 IF NOT FOUND THEN RAISE EXCEPTION 'missing';END IF;
 PERFORM private.test_lock_binding(b);
 SELECT * INTO o FROM private.switch_test_hold WHERE id=i FOR UPDATE;
 IF o.terminal_wire=wire AND o.terminal_state=s AND o.phase IN ('active','resolved') THEN RETURN o.evidence_revision;END IF;
 IF o.evidence_revision IS DISTINCT FROM expected_revision OR o.phase NOT IN ('dispatching','unknown','active','resolved') THEN RAISE EXCEPTION 'evidence_conflict';END IF;
 w:=wire::jsonb;
 IF jsonb_typeof(s->'native_verified') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(s->'clock_trusted') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(s->'granted_seconds') IS DISTINCT FROM 'number'
 OR jsonb_typeof(s->'sequence') IS DISTINCT FROM 'number'
 OR jsonb_typeof(s->'sample_sequence') IS DISTINCT FROM 'number'
 OR (w-'mac') IS DISTINCT FROM s OR w->>'mac' IS NULL OR w->>'mac' !~ '^[0-9a-f]{64}$'
 OR s->>'binding_id' IS DISTINCT FROM b::text
 OR s->>'session_id' IS DISTINCT FROM o.request_id::text
 OR s->>'console_id' IS DISTINCT FROM o.console_id
 OR s->>'boot_id' IS DISTINCT FROM o.command->>'boot_id'
 OR s->>'sequence' IS DISTINCT FROM o.sequence::text
 OR s->>'granted_seconds' IS DISTINCT FROM '600'
 OR s->>'native_verified' IS DISTINCT FROM 'true' OR s->>'clock_trusted' IS DISTINCT FROM 'true'
 OR s->>'reason' IS DISTINCT FROM 'ok'
 OR coalesce(s->>'session_state','') NOT IN ('playing','paused','ended','exhausted')
 OR coalesce(s->>'sample_sequence','') !~ '^[1-9][0-9]*$'
 OR coalesce(s->>'consumed_ns','') !~ '^(0|[1-9][0-9]*)$'
 THEN RAISE EXCEPTION 'evidence_invalid';END IF;
 IF o.phase='resolved' AND (
 s->>'session_state' IS DISTINCT FROM o.terminal_state->>'session_state'
 OR s->>'consumed_ns' IS DISTINCT FROM o.terminal_state->>'consumed_ns'
 OR s->>'remaining_ns' IS DISTINCT FROM o.terminal_state->>'remaining_ns'
 ) THEN RAISE EXCEPTION 'terminal_conflict';END IF;
 IF o.terminal_state IS NOT NULL AND (
 s->>'boot_id' IS DISTINCT FROM o.terminal_state->>'boot_id'
 OR (s->>'sample_sequence')::bigint <= (o.terminal_state->>'sample_sequence')::bigint
 OR (s->>'consumed_ns')::numeric < (o.terminal_state->>'consumed_ns')::numeric
 ) THEN RAISE EXCEPTION 'evidence_regression';END IF;
 UPDATE private.switch_test_hold SET terminal_wire=wire,terminal_state=s,
 evidence_revision=evidence_revision+1,phase=CASE WHEN s->>'session_state' IN ('ended','exhausted') THEN 'resolved' ELSE 'active' END WHERE id=i
 RETURNING evidence_revision INTO expected_revision;
 RETURN expected_revision;
END $$;
REVOKE ALL ON FUNCTION private.test_record_verified(uuid,bigint,text,jsonb) FROM PUBLIC;
