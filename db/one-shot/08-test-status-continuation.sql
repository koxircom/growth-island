-- ISOLATED: accept only exact already-HMAC-verified persisted test state.
CREATE OR REPLACE FUNCTION public.switch_update_status(p_status jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b private.switch_binding%rowtype; sid uuid; g integer; seq bigint; sample bigint; consumed numeric; remaining numeric; observed numeric; state text; session_id_text text; source_enabled boolean; read_only boolean;
BEGIN
 IF session_user<>'growth_switch_worker' AND NOT pg_has_role(session_user,'growth_switch_worker','member') THEN RAISE EXCEPTION 'worker_required'; END IF;
 IF jsonb_typeof(p_status) IS DISTINCT FROM 'object' OR octet_length(p_status::text)>65536 THEN RAISE EXCEPTION 'invalid_switch_status'; END IF;
 SELECT * INTO b FROM private.switch_binding WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'switch_not_bound'; END IF;
 IF p_status->>'v' IS DISTINCT FROM '1' OR lower(p_status->>'console_id') IS DISTINCT FROM b.console_id OR p_status->>'binding_id' IS DISTINCT FROM b.binding_id::text
  OR p_status->>'boot_id' !~ '^[0-9a-fA-F-]{36}$' OR jsonb_typeof(p_status->'sample_sequence') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_status->'observed_at') IS DISTINCT FROM 'number' OR jsonb_typeof(p_status->'granted_seconds') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_status->'clock_trusted') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_status->'native_verified') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_status->'consumed_ns') IS DISTINCT FROM 'string' OR jsonb_typeof(p_status->'remaining_ns') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_switch_status'; END IF;
 sample:=(p_status->>'sample_sequence')::bigint; observed:=(p_status->>'observed_at')::numeric; g:=(p_status->>'granted_seconds')::integer;
 IF sample<0 OR observed<extract(epoch FROM clock_timestamp())-30 OR observed>extract(epoch FROM clock_timestamp())+30 OR g<0 OR g>10800
  OR p_status->>'consumed_ns' !~ '^[0-9]+$' OR p_status->>'remaining_ns' !~ '^[0-9]+$' THEN RAISE EXCEPTION 'invalid_switch_status'; END IF;
 consumed:=(p_status->>'consumed_ns')::numeric; remaining:=(p_status->>'remaining_ns')::numeric;
 IF consumed<0 OR remaining<0 OR consumed+remaining<>g::numeric*1000000000 THEN RAISE EXCEPTION 'invalid_switch_status'; END IF;
 -- Exact verified replay is a no-op, not an older-state overwrite.
 IF b.status_snapshot->>'boot_id'=p_status->>'boot_id'
 AND (b.status_snapshot->>'sample_sequence')::bigint=sample
 AND b.status_snapshot @> p_status THEN RETURN;END IF;
 IF b.status_snapshot->>'boot_id' IS NOT DISTINCT FROM p_status->>'boot_id'
  AND coalesce((b.status_snapshot->>'sample_sequence')::bigint,-1)>=sample THEN RAISE EXCEPTION 'invalid_switch_status'; END IF;
 state:=p_status->>'session_state'; session_id_text:=coalesce(p_status->>'session_id','');
 IF state NOT IN ('none','playing','paused','exhausted','ended','unknown','sleeping')
  OR (session_id_text<>'' AND session_id_text !~ '^[0-9a-fA-F-]{36}$')
  OR (state='sleeping' AND (session_id_text<>'' OR g<>0 OR consumed<>0 OR remaining<>0)) THEN
  RAISE EXCEPTION 'invalid_switch_status';
 END IF;
 IF session_id_text<>'' THEN
  sid:=session_id_text::uuid;
  IF NOT EXISTS(SELECT 1 FROM private.switch_sessions WHERE id=sid AND family_id=b.family_id AND device_id=b.device_id)
   AND NOT EXISTS(SELECT 1 FROM private.switch_test_hold t
    WHERE t.request_id=sid AND t.family_id=b.family_id AND t.device_id=b.device_id
    AND t.binding_id=b.binding_id AND t.console_id=b.console_id
    AND t.phase IN ('active','resolved') AND t.terminal_wire IS NOT NULL
    AND t.terminal_state IS NOT NULL AND p_status @> t.terminal_state
    AND t.sequence=(p_status->>'sequence')::bigint)
   THEN RAISE EXCEPTION 'unknown_switch_session'; END IF;
 END IF;
 source_enabled:=coalesce((p_status->>'source_enabled')::boolean,true); read_only:=coalesce((p_status->>'read_only')::boolean,false);
 UPDATE private.switch_binding SET status_snapshot=jsonb_build_object('v',1,'console_id',b.console_id,'binding_id',b.binding_id,'boot_id',p_status->>'boot_id','sample_sequence',sample,'observed_at',observed,'session_id',session_id_text,'session_state',state,'granted_seconds',g,'consumed_ns',p_status->>'consumed_ns','remaining_ns',p_status->>'remaining_ns','consumed_seconds',ceil(consumed/1000000000.0)::integer,'remaining_seconds',ceil(remaining/1000000000.0)::integer,'clock_trusted',(p_status->>'clock_trusted')::boolean,'native_verified',(p_status->>'native_verified')::boolean,'sequence',coalesce((p_status->>'sequence')::bigint,0),'reason',coalesce(p_status->>'reason',''),'source_enabled',source_enabled,'read_only',read_only),status_checked_at=clock_timestamp() WHERE singleton;
END $$;

