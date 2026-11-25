\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('growth.cancel_request', :'request_id', true);
CREATE TABLE private.switch_cancelled_operations (
 request_id uuid PRIMARY KEY, family_id uuid NOT NULL, binding_id uuid NOT NULL,
 sequence bigint NOT NULL, operation_snapshot jsonb NOT NULL, session_snapshot jsonb NOT NULL,
 cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp(), reason text NOT NULL
);
REVOKE ALL ON private.switch_cancelled_operations FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
DO $cancel$
DECLARE o private.switch_operations%rowtype; s private.switch_sessions%rowtype; b private.switch_binding%rowtype; owner uuid; balance_before bigint; balance_after bigint;
BEGIN
 SELECT * INTO o FROM private.switch_operations WHERE request_id=current_setting('growth.cancel_request')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_missing'; END IF;
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=o.binding_id AND family_id=o.family_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'binding_missing'; END IF;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=o.request_id FOR UPDATE;
 SELECT * INTO s FROM private.switch_sessions WHERE id=o.usage_id AND family_id=o.family_id FOR UPDATE;
 IF NOT FOUND OR s.binding_id IS DISTINCT FROM o.binding_id OR o.action<>'start' OR o.seconds_delta<>1260 OR o.total_seconds<>1260
 OR o.sequence<>8 OR b.next_sequence<>o.sequence OR o.resolved OR o.attempts<>0 OR o.command IS NOT NULL OR o.command_hash IS NOT NULL OR o.phase IS NOT NULL OR o.result IS NOT NULL
 OR s.state<>'pending' OR s.granted_seconds<>0 OR s.consumed_ns<>0 OR s.consumed_seconds<>0
 OR EXISTS(SELECT 1 FROM private.switch_dispatch_journal WHERE request_id=o.request_id)
 OR EXISTS(SELECT 1 FROM private.switch_operations WHERE binding_id=o.binding_id AND sequence>o.sequence)
 OR EXISTS(SELECT 1 FROM private.switch_test_hold WHERE binding_id=o.binding_id AND sequence>=o.sequence)
 OR NOT EXISTS(SELECT 1 FROM private.switch_operations WHERE binding_id=o.binding_id AND sequence=o.sequence-1 AND resolved)
 OR NOT EXISTS(SELECT 1 FROM public.device_time_ledger WHERE source_type='reserve' AND source_id=o.request_id AND family_id=o.family_id AND child_id=s.child_id AND device_id=s.device_id AND seconds_delta=-1260)
 OR EXISTS(SELECT 1 FROM public.device_time_ledger WHERE source_type='refund' AND source_id=o.request_id)
 THEN RAISE EXCEPTION 'cancellation_guard_failed'; END IF;
 SELECT coalesce(sum(seconds_delta),0) INTO balance_before FROM public.device_time_ledger WHERE family_id=o.family_id AND child_id=s.child_id AND device_id=s.device_id;
 INSERT INTO private.switch_cancelled_operations(request_id,family_id,binding_id,sequence,operation_snapshot,session_snapshot,reason)
 VALUES(o.request_id,o.family_id,o.binding_id,o.sequence,to_jsonb(o),to_jsonb(s),'Parent requested cancellation of verified unsent reservation');
 INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(o.family_id,s.child_id,s.device_id,1260,'refund',o.request_id);
 UPDATE private.switch_sessions SET state='ended',ended_at=clock_timestamp(),remote=jsonb_build_object('phase','cancelled_unsent','cancelled_at',clock_timestamp()) WHERE id=s.id;
 DELETE FROM private.switch_operations WHERE request_id=o.request_id;
 UPDATE private.switch_binding SET next_sequence=o.sequence-1 WHERE binding_id=o.binding_id;
 SELECT owner_id INTO owner FROM public.families WHERE id=o.family_id;
 INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(o.family_id,owner,'switch_cancel_unsent_parent_request',o.request_id);
 SELECT coalesce(sum(seconds_delta),0) INTO balance_after FROM public.device_time_ledger WHERE family_id=o.family_id AND child_id=s.child_id AND device_id=s.device_id;
 IF balance_after<>balance_before+1260 THEN RAISE EXCEPTION 'refund_verification_failed'; END IF;
 RAISE NOTICE 'cancelled verified unsent start; returned 1260 seconds; sequence restored to %; balance before %, after %',o.sequence-1,balance_before,balance_after;
END $cancel$;
COMMIT;
