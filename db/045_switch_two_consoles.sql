-- Two-console migration; executed transactionally by scripts/migrate.mjs.
-- Device identity is separate from the logical wallet device. Keep the old
-- singleton key unique so old code retains its original first-console scope.
ALTER TABLE private.switch_binding DROP CONSTRAINT switch_binding_pkey;
ALTER TABLE private.switch_binding ALTER COLUMN singleton DROP NOT NULL;
ALTER TABLE private.switch_binding ADD COLUMN binding_row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
ALTER TABLE private.switch_binding ADD CONSTRAINT switch_binding_singleton_unique UNIQUE(singleton);
ALTER TABLE private.switch_binding DROP CONSTRAINT switch_binding_device_id_key;
ALTER TABLE private.switch_binding ADD COLUMN display_name text;
UPDATE private.switch_binding SET display_name='Switch 1' WHERE singleton;
CREATE UNIQUE INDEX switch_binding_console_id_unique ON private.switch_binding(console_id) WHERE console_id IS NOT NULL;
ALTER TABLE private.switch_sessions ADD COLUMN binding_id uuid;
UPDATE private.switch_sessions s SET binding_id=(SELECT o.binding_id FROM private.switch_operations o WHERE o.usage_id=s.id ORDER BY o.created_at,o.request_id LIMIT 1);
ALTER TABLE private.switch_sessions ADD CONSTRAINT active_switch_session_has_binding CHECK (state='ended' OR binding_id IS NOT NULL);
DROP INDEX private.switch_one_physical_session;
CREATE UNIQUE INDEX switch_one_session_per_console ON private.switch_sessions(binding_id) WHERE state <> 'ended';

CREATE OR REPLACE FUNCTION private.switch_assert_ready(p_family uuid, p_binding uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE b private.switch_binding%rowtype;
BEGIN
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=p_binding;
 IF NOT FOUND OR b.family_id IS DISTINCT FROM p_family OR NOT b.enabled THEN
  RAISE EXCEPTION 'switch_not_ready';
 END IF;
 -- A missing or expired status is an offline queue condition, not proof that
 -- the device has received the command.  The worker must revalidate and only
 -- a correlated receipt can settle the reserved operation.
 IF b.status_checked_at IS NULL OR b.status_checked_at < clock_timestamp()-interval '15 seconds' THEN
  RETURN;
 END IF;
 IF jsonb_typeof(b.status_snapshot) IS DISTINCT FROM 'object'
  OR b.status_snapshot->>'console_id' IS DISTINCT FROM b.console_id
  OR b.status_snapshot->>'binding_id' IS DISTINCT FROM b.binding_id::text
  OR b.status_snapshot->>'clock_trusted' IS DISTINCT FROM 'true'
  OR coalesce(b.status_snapshot->>'source_enabled','true') IS DISTINCT FROM 'true'
  OR coalesce(b.status_snapshot->>'read_only','false') IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'switch_not_ready';
 END IF;
 -- Sleep can leave a fresh status with an unverified native counter or an
 -- unknown session. Queue the reservation, but let worker preparation reject
 -- it until a fresh safe status is available.
END $function$
;
CREATE OR REPLACE FUNCTION private.family_mutate_before_test_hold(p_action text, p_payload jsonb, p_request_id uuid, p_parent_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 f uuid; c uuid; d uuid; n integer; total integer; bal bigint; seq bigint; obj uuid;
 h text; en boolean; console text; bid uuid; wait_until timestamptz; initial_sequence bigint; identity_change boolean;
 b private.switch_binding%rowtype; s private.switch_sessions%rowtype;
 r public.rewards%rowtype; device public.family_devices%rowtype;
 prior private.mutation_requests%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 h:=encode(extensions.digest(((p_payload-'pin') || CASE WHEN p_payload?'pin' THEN '{"pin_change":true}'::jsonb ELSE '{}'::jsonb END)::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>p_action OR prior.payload_hash<>h THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 SELECT * INTO b FROM private.switch_binding WHERE singleton FOR UPDATE;

  -- Once prepared, a signed request may already be in flight. Serialize
  -- device_save with prepare using the family row lock above, and do not let
  -- a parent deactivate the physical device until that request resolves.
  -- An active session must first be stopped through the device protocol.
  IF p_action='device_save' AND lower(p_payload->>'id') IS NOT DISTINCT FROM b.device_id::text
   AND jsonb_typeof(p_payload->'active')='boolean' AND p_payload->'active'='false'::jsonb
   AND private.parent_valid(f,p_parent_token) THEN
   IF EXISTS(SELECT 1 FROM private.switch_operations o WHERE o.family_id=f AND NOT o.resolved AND o.command IS NOT NULL) THEN
    RAISE EXCEPTION 'switch_operation_pending';
   END IF;
   IF EXISTS(SELECT 1 FROM private.switch_sessions WHERE family_id=f AND device_id=b.device_id AND state='active') THEN
    RAISE EXCEPTION 'device_time_already_running';
   END IF;
  END IF;

  -- Switch sessions are device-authoritative.  Without a device-side schedule
  -- fence, changing the bound device to a scheduled mode during an active
  -- session would let the already-granted allowance run across that window.
  -- Let migration 024 validate malformed payloads; only block a valid request
  -- that would leave this physical Switch session schedule-controlled.
  IF p_action='device_save' AND lower(p_payload->>'id') IS NOT DISTINCT FROM b.device_id::text
   AND (p_payload?'schedule_enabled' OR p_payload?'schedules')
   AND private.parent_valid(f,p_parent_token)
   AND EXISTS(SELECT 1 FROM private.switch_sessions WHERE family_id=f AND device_id=b.device_id AND state<>'ended') THEN
   SELECT * INTO device FROM public.family_devices WHERE id=b.device_id AND family_id=f;
   IF (p_payload?'schedule_enabled' AND jsonb_typeof(p_payload->'schedule_enabled') IS DISTINCT FROM 'boolean') THEN
    NULL;
   ELSIF coalesce((p_payload->>'schedule_enabled')::boolean,device.schedule_enabled,false) THEN
    RAISE EXCEPTION 'switch_schedule_unsupported';
   END IF;
  END IF;

 IF p_action='switch_bind' THEN
  IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
  IF jsonb_typeof(p_payload->'device_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'console_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'binding_id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  d:=(p_payload->>'device_id')::uuid; bid:=(p_payload->>'binding_id')::uuid; console:=lower(trim(p_payload->>'console_id'));
  IF console !~ '^[0-9a-f]{8}$' THEN RAISE EXCEPTION 'invalid_console_id'; END IF;
  en:=coalesce((p_payload->>'enabled')::boolean,true);
  initial_sequence:=0;
  IF p_payload?'initial_sequence' THEN
   IF jsonb_typeof(p_payload->'initial_sequence') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_switch_binding'; END IF;
   IF (p_payload->>'initial_sequence')::numeric<>trunc((p_payload->>'initial_sequence')::numeric)
    OR (p_payload->>'initial_sequence')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'invalid_switch_binding'; END IF;
   initial_sequence:=(p_payload->>'initial_sequence')::bigint;
  END IF;
  IF b.family_id IS NOT NULL AND b.family_id<>f THEN RAISE EXCEPTION 'switch_already_bound'; END IF;
  identity_change:=b.binding_id IS NULL OR b.binding_id IS DISTINCT FROM bid OR b.device_id IS DISTINCT FROM d OR b.console_id IS DISTINCT FROM console OR b.family_id IS DISTINCT FROM f;
  IF identity_change AND EXISTS(SELECT 1 FROM private.switch_binding WHERE singleton IS NULL AND family_id=f) THEN RAISE EXCEPTION 'switch_secondary_bound'; END IF;
  IF EXISTS(SELECT 1 FROM private.switch_sessions WHERE state<>'ended') THEN RAISE EXCEPTION 'switch_busy'; END IF;
  IF identity_change AND EXISTS(SELECT 1 FROM private.switch_operations WHERE NOT resolved) THEN RAISE EXCEPTION 'switch_busy'; END IF;
  SELECT * INTO device FROM public.family_devices WHERE id=d AND family_id=f AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found'; END IF;
  IF EXISTS(SELECT 1 FROM private.tv_binding WHERE device_id=d) THEN RAISE EXCEPTION 'switch_already_bound'; END IF;
  IF EXISTS(SELECT 1 FROM public.device_usage_sessions WHERE device_id=d AND status='running') THEN RAISE EXCEPTION 'device_time_already_running'; END IF;
  INSERT INTO private.switch_binding(singleton,family_id,device_id,console_id,binding_id,enabled,next_sequence,status_snapshot,status_checked_at)
  VALUES(true,f,d,console,bid,en,CASE WHEN identity_change THEN greatest(coalesce(b.next_sequence,0),initial_sequence) ELSE coalesce(b.next_sequence,0) END,NULL,NULL)
  ON CONFLICT(singleton) DO UPDATE SET family_id=excluded.family_id,device_id=excluded.device_id,console_id=excluded.console_id,
   binding_id=excluded.binding_id,enabled=excluded.enabled,next_sequence=excluded.next_sequence,status_snapshot=NULL,status_checked_at=NULL;
  INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,h);
  INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,d);
  RETURN public.get_dashboard();
 END IF;

 IF p_action='redeem' THEN
  c:=(p_payload->>'child_id')::uuid;
  SELECT * INTO r FROM public.rewards WHERE id=(p_payload->>'reward_id')::uuid AND family_id=f AND active AND (child_id IS NULL OR child_id=c);
  IF r.id IS NULL THEN RETURN private.family_mutate_before_switch(p_action,p_payload,p_request_id,p_parent_token); END IF;
  IF r.kind<>'device_time' THEN RETURN private.family_mutate_before_switch(p_action,p_payload,p_request_id,p_parent_token); END IF;
  IF b.family_id IS DISTINCT FROM f OR b.device_id IS DISTINCT FROM r.device_id THEN
   RETURN private.family_mutate_before_switch(p_action,p_payload,p_request_id,p_parent_token);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
  SELECT * INTO device FROM public.family_devices WHERE id=r.device_id AND family_id=f AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_inactive'; END IF;
  SELECT coalesce(sum(amount),0) INTO bal FROM public.star_ledger WHERE family_id=f AND child_id=c;
  IF bal<r.cost THEN RAISE EXCEPTION 'insufficient_stars'; END IF;
  INSERT INTO public.redemptions(family_id,child_id,reward_id,reward_name,cost,kind,device_id,device_name,duration_seconds,status,reviewed_at,request_id)
   VALUES(f,c,r.id,r.name,r.cost,r.kind,r.device_id,device.name,r.duration_seconds,'approved',clock_timestamp(),p_request_id) RETURNING id INTO obj;
  INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES(f,c,-r.cost,'redemption',obj);
  INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(f,c,r.device_id,r.duration_seconds,'grant',obj);
  INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,h);
  INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),'switch_redemption_auto_credit',obj);
  RETURN public.get_dashboard();
 END IF;

 -- Keep unrelated actions on the existing 024 path without interpreting
 -- their unrelated 'id' field as a Switch session UUID.
 IF p_action NOT IN ('device_time_start','device_time_extend','device_time_stop') THEN
  RETURN private.family_mutate_before_switch(p_action,p_payload,p_request_id,p_parent_token);
 END IF;

 IF p_action='device_time_start' THEN
  d:=(p_payload->>'device_id')::uuid;
 ELSE
  SELECT * INTO s FROM private.switch_sessions WHERE id=(p_payload->>'id')::uuid AND family_id=f FOR UPDATE;
  IF FOUND THEN d:=s.device_id; END IF;
 END IF;
 -- A Switch wallet is shared by the consoles; the explicit target determines
 -- physical delivery. TV and other devices still follow the previous path.
 IF b.family_id IS NULL OR b.family_id<>f OR d IS DISTINCT FROM b.device_id THEN
  RETURN private.family_mutate_before_switch(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 IF p_action='device_time_start' THEN
  IF p_payload ? 'binding_id' THEN
   IF jsonb_typeof(p_payload->'binding_id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_switch_binding'; END IF;
   SELECT * INTO b FROM private.switch_binding WHERE binding_id=(p_payload->>'binding_id')::uuid AND family_id=f AND device_id=d AND enabled FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'invalid_switch_binding'; END IF;
  ELSIF (SELECT count(*) FROM private.switch_binding WHERE family_id=f AND device_id=d AND enabled)>1 THEN
   RAISE EXCEPTION 'switch_selection_required';
  END IF;
 ELSE
  SELECT * INTO b FROM private.switch_binding WHERE binding_id=s.binding_id AND family_id=f AND device_id=d AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_switch_binding'; END IF;
 END IF;
 IF p_action<>'device_time_stop' THEN
  IF jsonb_typeof(p_payload->'seconds') IS DISTINCT FROM 'number'
   OR (p_payload->>'seconds')::numeric<>trunc((p_payload->>'seconds')::numeric)
   OR (p_payload->>'seconds')::numeric NOT BETWEEN 1 AND 10800 THEN RAISE EXCEPTION 'invalid_device_duration'; END IF;
  n:=(p_payload->>'seconds')::integer;
 END IF;

 IF p_action='device_time_start' THEN
  c:=(p_payload->>'child_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
  SELECT * INTO device FROM public.family_devices WHERE id=d AND family_id=f AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_inactive'; END IF;
   -- 024 protects ordinary wall-clock sessions.  A Switch command can be
   -- executed while the console sleeps or is offline, so the server cannot
   -- enforce the same pause; fail closed instead of granting a bypass.
   IF coalesce(device.schedule_enabled,false) THEN RAISE EXCEPTION 'switch_schedule_unsupported'; END IF;
  PERFORM private.switch_assert_ready(f,b.binding_id);
  SELECT max(ended_at+device.cooldown_seconds*interval '1 second') INTO wait_until FROM private.switch_sessions WHERE device_id=d AND state='ended';
  IF wait_until>clock_timestamp() THEN RAISE EXCEPTION 'device_time_cooldown'; END IF;
  IF EXISTS(SELECT 1 FROM private.switch_sessions WHERE binding_id=b.binding_id AND state<>'ended') THEN RAISE EXCEPTION 'switch_busy'; END IF;
  SELECT coalesce(sum(seconds_delta),0) INTO bal FROM public.device_time_ledger WHERE family_id=f AND child_id=c AND device_id=d;
  IF bal<n THEN RAISE EXCEPTION 'insufficient_device_time'; END IF;
  UPDATE private.switch_binding SET next_sequence=next_sequence+1 WHERE binding_id=b.binding_id RETURNING next_sequence INTO seq;
  INSERT INTO private.switch_sessions(id,family_id,child_id,device_id,binding_id,state) VALUES(gen_random_uuid(),f,c,d,b.binding_id,'pending') RETURNING id INTO obj;
  INSERT INTO private.switch_operations(request_id,usage_id,family_id,action,seconds_delta,total_seconds,sequence,console_id,binding_id,payload)
   VALUES(p_request_id,obj,f,'start',n,n,seq,b.console_id,b.binding_id,p_payload);
  INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(f,c,d,-n,'reserve',p_request_id);
 ELSIF p_action='device_time_extend' THEN
  IF s.id IS NULL OR s.state<>'active' THEN RAISE EXCEPTION 'switch_not_active'; END IF;
  IF EXISTS(SELECT 1 FROM private.switch_operations WHERE usage_id=s.id AND NOT resolved) THEN RAISE EXCEPTION 'switch_operation_pending'; END IF;
  SELECT * INTO device FROM public.family_devices WHERE id=s.device_id AND family_id=f AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_inactive'; END IF;
   -- See the start path: do not claim that a server-side window can stop a
   -- device-authoritative session after sleep, power-off, or a network gap.
   IF coalesce(device.schedule_enabled,false) THEN RAISE EXCEPTION 'switch_schedule_unsupported'; END IF;
  PERFORM private.switch_assert_ready(f,b.binding_id);
  total:=s.granted_seconds+n;
  IF total>10800 THEN RAISE EXCEPTION 'invalid_device_duration'; END IF;
  SELECT coalesce(sum(seconds_delta),0) INTO bal FROM public.device_time_ledger WHERE family_id=f AND child_id=s.child_id AND device_id=s.device_id;
  IF bal<n THEN RAISE EXCEPTION 'insufficient_device_time'; END IF;
  UPDATE private.switch_binding SET next_sequence=next_sequence+1 WHERE binding_id=b.binding_id RETURNING next_sequence INTO seq;
  INSERT INTO private.switch_operations(request_id,usage_id,family_id,action,seconds_delta,total_seconds,sequence,console_id,binding_id,payload)
   VALUES(p_request_id,s.id,f,'extend',n,total,seq,b.console_id,b.binding_id,p_payload);
  INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(f,s.child_id,s.device_id,-n,'reserve',p_request_id);
 ELSIF p_action='device_time_stop' THEN
  IF s.id IS NULL OR s.state<>'active' THEN RAISE EXCEPTION 'switch_not_active'; END IF;
  IF EXISTS(SELECT 1 FROM private.switch_operations WHERE usage_id=s.id AND NOT resolved) THEN RAISE EXCEPTION 'switch_operation_pending'; END IF;
  UPDATE private.switch_binding SET next_sequence=next_sequence+1 WHERE binding_id=b.binding_id RETURNING next_sequence INTO seq;
  INSERT INTO private.switch_operations(request_id,usage_id,family_id,action,seconds_delta,total_seconds,sequence,console_id,binding_id,payload)
   VALUES(p_request_id,s.id,f,'stop',0,0,seq,b.console_id,b.binding_id,p_payload);
 END IF;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,h);
 INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,coalesce(obj,s.id));
 RETURN public.get_dashboard();
END $function$
;
CREATE OR REPLACE FUNCTION private.get_dashboard_before_posting_snapshots()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE f uuid; result jsonb;
BEGIN
 result:=private.get_dashboard_before_switch(); f:=private.owned_family();
 RETURN result || jsonb_build_object(
  'switch_settings',(SELECT jsonb_build_object('device_id',device_id,'console_id',console_id,'binding_id',binding_id,'enabled',enabled) FROM private.switch_binding WHERE singleton AND family_id=f),
  'switch_status',(SELECT jsonb_build_object('checked_at',status_checked_at,'snapshot',status_snapshot) FROM private.switch_binding WHERE singleton AND family_id=f),
  'switch_consoles',coalesce((SELECT jsonb_agg(jsonb_build_object('binding_id',binding_id,'device_id',device_id,'label',coalesce(display_name,'Switch'),'enabled',enabled,'online',coalesce(status_checked_at >= statement_timestamp()-interval '30 seconds',false),'status',jsonb_build_object('checked_at',status_checked_at,'snapshot',status_snapshot)) ORDER BY binding_row_id) FROM private.switch_binding WHERE family_id=f AND binding_id IS NOT NULL),'[]'::jsonb),
  'switch_sessions',coalesce((SELECT jsonb_agg(x.item ORDER BY x.created_at DESC) FROM (SELECT s.created_at,jsonb_build_object('id',s.id,'child_id',s.child_id,'device_id',s.device_id,'binding_id',s.binding_id,'state',s.state,'granted_seconds',s.granted_seconds,'consumed_seconds',s.consumed_seconds,'remote',s.remote,'pending',EXISTS(SELECT 1 FROM private.switch_operations o WHERE o.usage_id=s.id AND NOT o.resolved),'last_result',(SELECT o.result FROM private.switch_operations o WHERE o.usage_id=s.id ORDER BY o.created_at DESC LIMIT 1)) item FROM private.switch_sessions s WHERE s.family_id=f ORDER BY s.created_at DESC LIMIT 100)x),'[]'::jsonb)
 );
END $function$
;

-- Two-console Switch worker routing candidate.
--
-- This file is intentionally limited to worker-side routing and settlement
-- functions.  It assumes the companion multi-binding schema has already made
-- binding_id unique, made singleton nullable (true for the first binding and
-- NULL for later bindings), and added switch_sessions.binding_id.

-- A shared worker role is not a physical identity.  Keep the login role that
-- owns a worker loop bound to exactly one console.  A dedicated second login
-- must be an independent LOGIN NOINHERIT role with no membership in
-- growth_switch_worker; the deploy owner grants the regular public worker
-- RPCs directly and inserts its login-role mapping below.  This migration
-- preserves only the existing first-console login.
CREATE TABLE IF NOT EXISTS private.switch_worker_binding (
 login_role name PRIMARY KEY,
 binding_id uuid NOT NULL,
 created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS switch_worker_binding_binding_id_key
 ON private.switch_worker_binding(binding_id);
INSERT INTO private.switch_worker_binding(login_role,binding_id)
 SELECT 'growth_switch_worker'::name,binding_id
 FROM private.switch_binding
 WHERE singleton AND binding_id IS NOT NULL
 ON CONFLICT(login_role) DO UPDATE SET binding_id=EXCLUDED.binding_id;
REVOKE ALL ON TABLE private.switch_worker_binding FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;

CREATE OR REPLACE FUNCTION private.switch_assert_worker_binding(p_binding_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE mapped uuid;
BEGIN
 SELECT binding_id INTO mapped FROM private.switch_worker_binding WHERE login_role=session_user::name;
 IF NOT FOUND OR mapped IS DISTINCT FROM p_binding_id THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION private.switch_assert_command_ready(p_family uuid, p_binding uuid, p_console text, p_action text, p_usage_id uuid, p_sequence bigint, p_boot_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE b private.switch_binding%rowtype; state text; session_id_text text; snapshot_sequence bigint;
BEGIN
 PERFORM private.switch_assert_worker_binding(p_binding);
 PERFORM private.switch_assert_send_ready(p_family,p_binding,p_console);
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=p_binding;
 IF NOT FOUND THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 -- Every operation, including a start operation's pending session, must stay
 -- on the physical binding that owns the operation.
 IF NOT EXISTS(SELECT 1 FROM private.switch_sessions current_session
               WHERE current_session.id=p_usage_id
                 AND current_session.family_id=p_family
                 AND current_session.binding_id=p_binding) THEN
  RAISE EXCEPTION 'switch_binding_required';
 END IF;
 state:=b.status_snapshot->>'session_state';
 session_id_text:=coalesce(b.status_snapshot->>'session_id','');
 snapshot_sequence:=(b.status_snapshot->>'sequence')::bigint;
 IF b.status_snapshot->>'boot_id' IS DISTINCT FROM p_boot_id
  OR snapshot_sequence IS DISTINCT FROM p_sequence-1
  OR (p_action='start' AND NOT (
    (state='none' AND session_id_text='') OR
    (state='ended' AND EXISTS(SELECT 1 FROM private.switch_sessions previous
      WHERE previous.id::text=session_id_text AND previous.family_id=p_family
       AND previous.device_id=b.device_id AND previous.binding_id=p_binding AND previous.state='ended'))
    OR (state IN ('ended','exhausted') AND EXISTS(
     SELECT 1 FROM private.switch_test_hold t
     WHERE t.request_id::text=session_id_text AND t.family_id=p_family
      AND t.device_id=b.device_id AND t.binding_id=p_binding AND t.console_id=p_console
      AND t.phase='resolved' AND t.terminal_wire IS NOT NULL
      AND t.sequence=snapshot_sequence
      AND t.terminal_state->>'session_state' IN ('ended','exhausted')
      AND t.terminal_state->>'session_id'=session_id_text
      AND t.terminal_state->>'boot_id'=p_boot_id
      AND (t.terminal_state->>'sample_sequence')::bigint <= (b.status_snapshot->>'sample_sequence')::bigint
    ))
  ))
  OR (p_action IN ('extend','stop') AND (
    state IS NULL OR state NOT IN ('playing','exhausted','ended')
    OR session_id_text IS DISTINCT FROM p_usage_id::text
  )) THEN
  RAISE EXCEPTION 'switch_not_ready';
 END IF;
END $function$
;

CREATE OR REPLACE FUNCTION private.switch_assert_send_ready(p_family uuid, p_binding uuid, p_console text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE b private.switch_binding%rowtype;
BEGIN
 -- This helper is also used by the parent-only test authorization path.  Only
 -- login roles explicitly present in the mapping table need the physical
 -- identity check here; public worker RPCs enforce it at their binding-bearing
 -- boundary, while parent/internal calls remain compatible.
 IF EXISTS(SELECT 1 FROM private.switch_worker_binding WHERE login_role=session_user::name) THEN
  PERFORM private.switch_assert_worker_binding(p_binding);
 END IF;
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=p_binding;
 IF NOT FOUND OR b.family_id IS DISTINCT FROM p_family OR NOT b.enabled
  OR b.binding_id IS DISTINCT FROM p_binding OR b.console_id IS DISTINCT FROM p_console
  OR NOT EXISTS(SELECT 1 FROM public.family_devices device WHERE device.id=b.device_id AND device.family_id=b.family_id AND device.active AND NOT device.schedule_enabled)
  OR b.status_checked_at IS NULL OR b.status_checked_at < clock_timestamp()-interval '15 seconds'
  OR jsonb_typeof(b.status_snapshot) IS DISTINCT FROM 'object'
  OR b.status_snapshot->>'v' IS DISTINCT FROM '1'
  OR b.status_snapshot->>'console_id' IS DISTINCT FROM b.console_id
  OR b.status_snapshot->>'binding_id' IS DISTINCT FROM b.binding_id::text
  OR b.status_snapshot->>'clock_trusted' IS DISTINCT FROM 'true'
  OR b.status_snapshot->>'native_verified' IS DISTINCT FROM 'true'
  OR coalesce(b.status_snapshot->>'session_state','unknown')='unknown'
  OR coalesce(b.status_snapshot->>'session_state','unknown')='sleeping'
  OR coalesce(b.status_snapshot->>'source_enabled','true') IS DISTINCT FROM 'true'
  OR coalesce(b.status_snapshot->>'read_only','false') IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'switch_not_ready';
 END IF;
END $function$
;

CREATE OR REPLACE FUNCTION private.switch_prepare_before_dispatch(p_request_id uuid, p_command jsonb, p_command_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o private.switch_operations%rowtype; b private.switch_binding%rowtype;
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR p_command_hash IS NULL OR p_command_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_switch_command'; END IF;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_switch_operation'; END IF;
 PERFORM private.switch_assert_worker_binding(o.binding_id);
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id FOR UPDATE;
 IF o.command IS NOT NULL THEN
  IF o.command IS DISTINCT FROM p_command OR o.command_hash IS DISTINCT FROM p_command_hash THEN RAISE EXCEPTION 'switch_command_conflict'; END IF;
  RETURN;
 END IF;
 IF p_command->>'v' IS DISTINCT FROM '1' OR p_command->>'action' IS DISTINCT FROM o.action
  OR p_command->>'console_id' IS DISTINCT FROM o.console_id OR p_command->>'binding_id' IS DISTINCT FROM o.binding_id::text
  OR p_command->>'request_id' IS DISTINCT FROM o.request_id::text OR p_command->>'session_id' IS DISTINCT FROM o.usage_id::text
  OR (p_command->>'sequence')::bigint IS DISTINCT FROM o.sequence OR (p_command->>'total_seconds')::integer IS DISTINCT FROM o.total_seconds
  OR p_command->>'boot_id' !~ '^[0-9a-fA-F-]{36}$' OR p_command->>'query_request_id' IS DISTINCT FROM ''
  OR p_command->>'issued_at' !~ '^[1-9][0-9]*$' OR p_command->>'accept_before' !~ '^[1-9][0-9]*$'
  OR (p_command->>'accept_before')::bigint <= (p_command->>'issued_at')::bigint
  OR (p_command->>'accept_before')::bigint > (p_command->>'issued_at')::bigint+120 THEN RAISE EXCEPTION 'invalid_switch_command'; END IF;
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=o.binding_id FOR UPDATE;
 IF NOT FOUND OR b.family_id IS DISTINCT FROM o.family_id OR b.console_id IS DISTINCT FROM o.console_id THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.switch_sessions s WHERE s.id=o.usage_id AND s.family_id=o.family_id AND s.binding_id=o.binding_id) THEN
  RAISE EXCEPTION 'switch_binding_required';
 END IF;
 -- This gate covers the new-command transaction only. A later device_save
 -- may still disable the device after commit; prepare is not delivery proof.
 PERFORM private.switch_assert_command_ready(
   o.family_id,o.binding_id,o.console_id,o.action,o.usage_id,o.sequence,p_command->>'boot_id'
 );
 PERFORM (p_command->>'boot_id')::uuid;
 UPDATE private.switch_operations SET command=p_command,command_hash=p_command_hash,phase='prepared'
  WHERE request_id=p_request_id AND binding_id=o.binding_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_claim_operation_for(p_binding_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o private.switch_operations%rowtype;
BEGIN
 IF p_binding_id IS NULL THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 PERFORM private.switch_assert_worker_binding(p_binding_id);
 SELECT * INTO o FROM private.switch_operations
  WHERE binding_id=p_binding_id AND NOT resolved AND next_attempt_at<=clock_timestamp()
  ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE private.switch_operations SET attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '15 seconds'
  WHERE request_id=o.request_id AND binding_id=p_binding_id;
 RETURN jsonb_build_object('request_id',o.request_id,'usage_id',o.usage_id,'action',o.action,'seconds',o.seconds_delta,'total_seconds',o.total_seconds,'sequence',o.sequence,'console_id',o.console_id,'binding_id',o.binding_id,'command',o.command,'command_hash',o.command_hash);
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_claim_operation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE enabled_count integer; bid uuid;
BEGIN
 SELECT count(*) INTO enabled_count FROM private.switch_binding WHERE enabled;
 -- The old unscoped worker has no physical identity. It is safe only while
 -- exactly one console is enabled; multiple enabled consoles fail closed.
 IF enabled_count>1 THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 IF enabled_count=0 THEN RETURN NULL; END IF;
 SELECT binding_id INTO bid FROM private.switch_binding WHERE enabled;
 IF bid IS NULL THEN RETURN NULL; END IF;
 RETURN public.switch_claim_operation_for(bid);
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_dispatch_once(p_request_id uuid, p_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o private.switch_operations%rowtype; j private.switch_dispatch_journal%rowtype;
BEGIN
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM private.switch_assert_worker_binding(o.binding_id);
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 PERFORM 1 FROM private.switch_binding WHERE binding_id=o.binding_id FOR UPDATE;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id FOR UPDATE;
 SELECT * INTO j FROM private.switch_dispatch_journal WHERE request_id=p_request_id FOR UPDATE;
 IF o.resolved OR j.state IS DISTINCT FROM 'unsent' OR p_hash IS NULL
  OR o.command_hash IS DISTINCT FROM p_hash OR j.command_hash IS DISTINCT FROM p_hash THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM private.switch_test_hold WHERE binding_id=o.binding_id AND phase<>'resolved') THEN RETURN false; END IF;
 IF (o.command->>'accept_before')::bigint<=extract(epoch from clock_timestamp()) THEN RETURN false; END IF;
 PERFORM private.switch_assert_command_ready(o.family_id,o.binding_id,o.console_id,o.action,o.usage_id,o.sequence,o.command->>'boot_id');
 UPDATE private.switch_dispatch_journal SET state='dispatching',dispatched_at=clock_timestamp() WHERE request_id=p_request_id;
 RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_dispatch_state(p_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE bid uuid; result text;
BEGIN
 SELECT binding_id INTO bid FROM private.switch_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM private.switch_assert_worker_binding(bid);
 SELECT state INTO result FROM private.switch_dispatch_journal WHERE request_id=p_request_id;
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_prepare_operation(p_request_id uuid, p_command jsonb, p_command_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE o private.switch_operations%rowtype; j private.switch_dispatch_journal%rowtype;
BEGIN
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_switch_operation'; END IF;
 PERFORM private.switch_assert_worker_binding(o.binding_id);
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 PERFORM 1 FROM private.switch_binding WHERE binding_id=o.binding_id FOR UPDATE;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id FOR UPDATE;
 SELECT * INTO j FROM private.switch_dispatch_journal WHERE request_id=p_request_id FOR UPDATE;
 IF o.resolved THEN RAISE EXCEPTION 'operation_resolved'; END IF;
 IF EXISTS(SELECT 1 FROM private.switch_test_hold WHERE binding_id=o.binding_id AND phase<>'resolved') THEN RAISE EXCEPTION 'test_hold_active'; END IF;
 IF o.command IS NOT NULL THEN
  IF j.state IS DISTINCT FROM 'unsent' THEN RAISE EXCEPTION 'dispatch_may_have_occurred'; END IF;
  -- The only refresh allowed is a command proven never dispatched by this protocol.
  UPDATE private.switch_operations SET command=NULL,command_hash=NULL,phase=NULL
   WHERE request_id=p_request_id AND binding_id=o.binding_id;
 END IF;
 PERFORM private.switch_prepare_before_dispatch(p_request_id,p_command,p_command_hash);
 INSERT INTO private.switch_dispatch_journal(request_id,state,command_hash)
 VALUES(p_request_id,'unsent',p_command_hash)
 ON CONFLICT(request_id) DO UPDATE SET command_hash=EXCLUDED.command_hash;
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_resolve_operation(p_request_id uuid, p_result jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 o private.switch_operations%rowtype; s private.switch_sessions%rowtype; b private.switch_binding%rowtype; stored jsonb;
 phase text; state text; g integer; consumed numeric; remaining numeric; previous numeric; refund integer; ns integer;
BEGIN
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_switch_operation'; END IF;
 PERFORM private.switch_assert_worker_binding(o.binding_id);
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 SELECT * INTO o FROM private.switch_operations WHERE request_id=p_request_id FOR UPDATE;
 IF o.resolved THEN RETURN; END IF;
 IF o.command_hash IS NULL THEN RAISE EXCEPTION 'switch_operation_unprepared'; END IF;
 SELECT * INTO s FROM private.switch_sessions WHERE id=o.usage_id AND family_id=o.family_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_switch_session'; END IF;
 IF s.binding_id IS DISTINCT FROM o.binding_id THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=o.binding_id;
 IF NOT FOUND OR b.family_id IS DISTINCT FROM o.family_id OR b.binding_id IS DISTINCT FROM o.binding_id OR b.console_id IS DISTINCT FROM o.console_id THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR p_result->>'v' IS DISTINCT FROM '1'
  OR p_result->>'action' IS DISTINCT FROM o.action OR p_result->>'console_id' IS DISTINCT FROM o.console_id
  OR p_result->>'binding_id' IS DISTINCT FROM o.binding_id::text OR p_result->>'request_id' IS DISTINCT FROM o.request_id::text
  OR p_result->>'session_id' IS DISTINCT FROM o.usage_id::text OR p_result->>'request_hash' IS DISTINCT FROM o.command_hash
  OR (p_result->>'sequence')::bigint IS DISTINCT FROM o.sequence THEN RAISE EXCEPTION 'invalid_switch_result'; END IF;
 phase:=p_result->>'phase'; state:=p_result->>'session_state';
 IF phase NOT IN ('prepared','applied','rejected','expired','unknown') OR state NOT IN ('none','playing','paused','exhausted','ended','unknown') THEN RAISE EXCEPTION 'invalid_switch_result'; END IF;
 IF (p_result->>'granted_seconds') !~ '^[0-9]+$' OR (p_result->>'consumed_ns') !~ '^[0-9]+$' OR (p_result->>'remaining_ns') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'invalid_switch_result'; END IF;
 g:=(p_result->>'granted_seconds')::integer; consumed:=(p_result->>'consumed_ns')::numeric; remaining:=(p_result->>'remaining_ns')::numeric;
 IF g<0 OR g>10800 OR consumed<0 OR remaining<0 OR consumed+remaining<>g::numeric*1000000000 THEN RAISE EXCEPTION 'invalid_switch_conservation'; END IF;
 previous:=s.consumed_ns;
 IF consumed<previous THEN RAISE EXCEPTION 'switch_consumption_regressed'; END IF;
 ns:=ceil(consumed/1000000000.0)::integer;
 stored:=p_result || jsonb_build_object('consumed_seconds',ns,'remaining_seconds',ceil(remaining/1000000000.0)::integer);
 IF phase IN ('prepared','unknown') THEN
  IF g<>s.granted_seconds AND g<>o.total_seconds THEN RAISE EXCEPTION 'invalid_switch_hold'; END IF;
  UPDATE private.switch_operations SET result=stored,phase=p_result->>'phase',next_attempt_at=clock_timestamp()+interval '15 seconds'
   WHERE request_id=p_request_id AND binding_id=o.binding_id;
  RETURN;
 END IF;
 IF phase IN ('rejected','expired') THEN
  IF g<>s.granted_seconds THEN RAISE EXCEPTION 'invalid_switch_rejection'; END IF;
  IF o.action IN ('start','extend') THEN
   INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(o.family_id,s.child_id,s.device_id,o.seconds_delta,'refund',o.request_id) ON CONFLICT(source_type,source_id) DO NOTHING;
   IF o.action='start' THEN UPDATE private.switch_sessions SET state='ended',consumed_ns=consumed,consumed_seconds=ns,ended_at=clock_timestamp(),remote=stored WHERE id=s.id AND binding_id=o.binding_id;
   ELSE UPDATE private.switch_sessions SET consumed_ns=consumed,consumed_seconds=ns,remote=stored WHERE id=s.id AND binding_id=o.binding_id; END IF;
  ELSE UPDATE private.switch_sessions SET consumed_ns=consumed,consumed_seconds=ns,remote=stored WHERE id=s.id AND binding_id=o.binding_id;
  END IF;
  UPDATE private.switch_operations SET resolved=true,phase=p_result->>'phase',result=stored WHERE request_id=p_request_id AND binding_id=o.binding_id;
  RETURN;
 END IF;
 IF phase='applied' THEN
  IF o.action IN ('start','extend') THEN
   IF g<>o.total_seconds OR g<s.granted_seconds OR state NOT IN ('playing','paused','ended','exhausted') THEN RAISE EXCEPTION 'invalid_switch_grant'; END IF;
  ELSE
   IF g<>s.granted_seconds OR state NOT IN ('ended','exhausted') THEN RAISE EXCEPTION 'invalid_switch_stop'; END IF;
  END IF;
 ELSE RAISE EXCEPTION 'invalid_switch_result'; END IF;
 ns:=ceil(consumed/1000000000.0)::integer;
 IF state='exhausted' AND o.action IN ('start','extend') THEN
  IF remaining<>0 THEN RAISE EXCEPTION 'invalid_switch_exhaustion'; END IF;
  UPDATE private.switch_sessions SET state='active',granted_seconds=g,consumed_ns=consumed,consumed_seconds=ns,remote=stored WHERE id=s.id AND binding_id=o.binding_id;
 ELSIF state='ended' OR (state='exhausted' AND o.action='stop') THEN
  refund:=g-ns;
  IF refund<0 THEN RAISE EXCEPTION 'invalid_switch_consumption'; END IF;
  IF refund>0 THEN INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(o.family_id,s.child_id,s.device_id,refund,'refund',CASE WHEN o.action='stop' THEN o.request_id ELSE s.id END) ON CONFLICT(source_type,source_id) DO NOTHING; END IF;
  UPDATE private.switch_sessions SET state='ended',granted_seconds=g,consumed_ns=consumed,consumed_seconds=ns,remote=stored,ended_at=coalesce(ended_at,clock_timestamp()) WHERE id=s.id AND binding_id=o.binding_id;
 ELSE
  UPDATE private.switch_sessions SET state='active',granted_seconds=g,consumed_ns=consumed,consumed_seconds=ns,remote=stored WHERE id=s.id AND binding_id=o.binding_id;
 END IF;
 UPDATE private.switch_operations SET resolved=true,phase='applied',result=stored WHERE request_id=p_request_id AND binding_id=o.binding_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_resolve_session(p_session_id uuid, p_session jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s private.switch_sessions%rowtype; b private.switch_binding%rowtype; stored jsonb; state text; g integer; consumed numeric; remaining numeric; ns integer; refund integer;
BEGIN
 SELECT * INTO s FROM private.switch_sessions WHERE id=p_session_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_switch_session'; END IF;
 PERFORM private.switch_assert_worker_binding(s.binding_id);
 PERFORM 1 FROM public.families WHERE id=s.family_id FOR UPDATE;
 SELECT * INTO s FROM private.switch_sessions WHERE id=p_session_id FOR UPDATE;
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=s.binding_id;
 IF NOT FOUND OR b.family_id IS DISTINCT FROM s.family_id OR b.device_id IS DISTINCT FROM s.device_id THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 -- Check the physical identity before the idempotent early returns below;
 -- otherwise a worker for the other console could silently submit state.
 IF jsonb_typeof(p_session) IS DISTINCT FROM 'object' OR p_session->>'v' IS DISTINCT FROM '1'
  OR p_session->>'console_id' IS DISTINCT FROM b.console_id OR p_session->>'binding_id' IS DISTINCT FROM s.binding_id::text
  OR p_session->>'session_id' IS DISTINCT FROM s.id::text THEN RAISE EXCEPTION 'invalid_switch_session'; END IF;
 IF s.state='ended' THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM private.switch_operations WHERE usage_id=p_session_id AND NOT resolved) THEN RETURN; END IF;
 IF (p_session->>'granted_seconds') !~ '^[0-9]+$'
  OR (p_session->>'consumed_ns') !~ '^[0-9]+$' OR (p_session->>'remaining_ns') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'invalid_switch_session'; END IF;
 state:=p_session->>'session_state';
 IF state NOT IN ('playing','paused','ended','exhausted','unknown') THEN RAISE EXCEPTION 'invalid_switch_session'; END IF;
 g:=(p_session->>'granted_seconds')::integer; consumed:=(p_session->>'consumed_ns')::numeric; remaining:=(p_session->>'remaining_ns')::numeric;
 IF g<>s.granted_seconds OR consumed<0 OR remaining<0 OR consumed+remaining<>g::numeric*1000000000 OR consumed<s.consumed_ns THEN RAISE EXCEPTION 'invalid_switch_conservation'; END IF;
 ns:=ceil(consumed/1000000000.0)::integer;
 stored:=p_session || jsonb_build_object('consumed_seconds',ns,'remaining_seconds',ceil(remaining/1000000000.0)::integer);
 IF state='ended' THEN
  refund:=g-ns;
  IF refund>0 THEN INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(s.family_id,s.child_id,s.device_id,refund,'refund',s.id) ON CONFLICT(source_type,source_id) DO NOTHING; END IF;
  UPDATE private.switch_sessions SET state='ended',consumed_ns=consumed,consumed_seconds=ns,remote=stored,ended_at=coalesce(ended_at,clock_timestamp()) WHERE id=s.id AND binding_id=s.binding_id;
 ELSIF state='exhausted' THEN
  IF remaining<>0 THEN RAISE EXCEPTION 'invalid_switch_exhaustion'; END IF;
  UPDATE private.switch_sessions SET state='active',consumed_ns=consumed,consumed_seconds=ns,remote=stored WHERE id=s.id AND binding_id=s.binding_id;
 ELSE
  UPDATE private.switch_sessions SET state='active',consumed_ns=consumed,consumed_seconds=ns,remote=stored WHERE id=s.id AND binding_id=s.binding_id;
 END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_sessions_to_poll_for(p_binding_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM private.switch_assert_worker_binding(p_binding_id);
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('usage_id',s.id,'child_id',s.child_id,'device_id',s.device_id,'binding_id',s.binding_id,'granted_seconds',s.granted_seconds,'consumed_ns',s.consumed_ns::text) ORDER BY s.created_at),'[]'::jsonb)
 FROM private.switch_sessions s
 WHERE s.binding_id=p_binding_id AND s.state='active'
   AND NOT EXISTS(SELECT 1 FROM private.switch_operations o WHERE o.usage_id=s.id AND NOT o.resolved));
END
$function$
;

CREATE OR REPLACE FUNCTION public.switch_sessions_to_poll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE enabled_count integer; bid uuid;
BEGIN
 SELECT count(*) INTO enabled_count FROM private.switch_binding WHERE enabled;
 IF enabled_count>1 THEN RAISE EXCEPTION 'switch_binding_required'; END IF;
 IF enabled_count=0 THEN RETURN '[]'::jsonb; END IF;
 SELECT binding_id INTO bid FROM private.switch_binding WHERE enabled;
 IF bid IS NULL THEN RETURN '[]'::jsonb; END IF;
 RETURN public.switch_sessions_to_poll_for(bid);
END $function$
;

CREATE OR REPLACE FUNCTION public.switch_update_status(p_status jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE b private.switch_binding%rowtype; bid uuid; sid uuid; g integer; seq bigint; sample bigint; consumed numeric; remaining numeric; observed numeric; state text; session_id_text text; source_enabled boolean; read_only boolean;
BEGIN
 IF jsonb_typeof(p_status) IS DISTINCT FROM 'object' OR octet_length(p_status::text)>65536 THEN RAISE EXCEPTION 'invalid_switch_status'; END IF;
 IF p_status->>'binding_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'invalid_switch_status'; END IF;
 bid:=(p_status->>'binding_id')::uuid;
 PERFORM private.switch_assert_worker_binding(bid);
 SELECT * INTO b FROM private.switch_binding WHERE binding_id=bid FOR UPDATE;
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
  IF NOT EXISTS(SELECT 1 FROM private.switch_sessions WHERE id=sid AND family_id=b.family_id AND device_id=b.device_id AND binding_id=b.binding_id)
   AND NOT EXISTS(SELECT 1 FROM private.switch_test_hold t
    WHERE t.request_id=sid AND t.family_id=b.family_id AND t.device_id=b.device_id
    AND t.binding_id=b.binding_id AND t.console_id=b.console_id
    AND t.phase IN ('active','resolved') AND t.terminal_wire IS NOT NULL
    AND t.terminal_state IS NOT NULL AND p_status @> t.terminal_state
    AND t.sequence=(p_status->>'sequence')::bigint)
   THEN RAISE EXCEPTION 'unknown_switch_session'; END IF;
 END IF;
 source_enabled:=coalesce((p_status->>'source_enabled')::boolean,true); read_only:=coalesce((p_status->>'read_only')::boolean,false);
 UPDATE private.switch_binding SET status_snapshot=jsonb_build_object('v',1,'console_id',b.console_id,'binding_id',b.binding_id,'boot_id',p_status->>'boot_id','sample_sequence',sample,'observed_at',observed,'session_id',session_id_text,'session_state',state,'granted_seconds',g,'consumed_ns',p_status->>'consumed_ns','remaining_ns',p_status->>'remaining_ns','consumed_seconds',ceil(consumed/1000000000.0)::integer,'remaining_seconds',ceil(remaining/1000000000.0)::integer,'clock_trusted',(p_status->>'clock_trusted')::boolean,'native_verified',(p_status->>'native_verified')::boolean,'sequence',coalesce((p_status->>'sequence')::bigint,0),'reason',coalesce(p_status->>'reason',''),'source_enabled',source_enabled,'read_only',read_only),status_checked_at=clock_timestamp() WHERE binding_id=b.binding_id;
END $function$
;

REVOKE ALL ON FUNCTION private.switch_assert_worker_binding(uuid) FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
REVOKE ALL ON FUNCTION public.switch_claim_operation(),public.switch_claim_operation_for(uuid),public.switch_dispatch_once(uuid,text),public.switch_dispatch_state(uuid),public.switch_prepare_operation(uuid,jsonb,text),public.switch_resolve_operation(uuid,jsonb),public.switch_resolve_session(uuid,jsonb),public.switch_sessions_to_poll(),public.switch_sessions_to_poll_for(uuid),public.switch_update_status(jsonb) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.switch_claim_operation(),public.switch_claim_operation_for(uuid),public.switch_dispatch_once(uuid,text),public.switch_dispatch_state(uuid),public.switch_prepare_operation(uuid,jsonb,text),public.switch_resolve_operation(uuid,jsonb),public.switch_resolve_session(uuid,jsonb),public.switch_sessions_to_poll(),public.switch_sessions_to_poll_for(uuid),public.switch_update_status(jsonb) TO growth_switch_worker;
-- One-shot test reconciliation stays with the original login only.  A
-- dedicated second login must be NOINHERIT and receive only the regular
-- worker RPC grant from the deployment owner.
REVOKE ALL ON FUNCTION public.switch_test_current(uuid),public.switch_test_dispatch_once(uuid,text),public.switch_test_evidence_context(uuid),public.switch_test_prepare(uuid,jsonb,text),public.switch_test_receipt(uuid,text,text),public.switch_test_record_verified(uuid,bigint,text,jsonb),public.switch_test_select_request(text),public.switch_test_unknown(uuid) FROM PUBLIC,anon,authenticated,growth_app,growth_switch_worker;
GRANT EXECUTE ON FUNCTION public.switch_test_current(uuid),public.switch_test_dispatch_once(uuid,text),public.switch_test_evidence_context(uuid),public.switch_test_prepare(uuid,jsonb,text),public.switch_test_receipt(uuid,text,text),public.switch_test_record_verified(uuid,bigint,text,jsonb),public.switch_test_select_request(text),public.switch_test_unknown(uuid) TO growth_switch_worker;
