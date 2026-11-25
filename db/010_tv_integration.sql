DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='growth_tv_worker') THEN CREATE ROLE growth_tv_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;
-- Explicit physical-device mapping; no automatic reward conversion.
CREATE TABLE private.tv_binding(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),family_id uuid NOT NULL REFERENCES public.families,device_id uuid NOT NULL UNIQUE,config jsonb,status_snapshot jsonb,status_checked_at timestamptz,revision bigint NOT NULL DEFAULT 1,FOREIGN KEY(device_id,family_id) REFERENCES public.family_devices(id,family_id));
CREATE TABLE private.tv_sessions(id uuid PRIMARY KEY,family_id uuid NOT NULL,child_id uuid NOT NULL,device_id uuid NOT NULL,state text NOT NULL CHECK(state IN ('pending','active','ended')),granted_seconds integer NOT NULL DEFAULT 0 CHECK(granted_seconds>=0),consumed_seconds integer NOT NULL DEFAULT 0,remote jsonb,FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id),FOREIGN KEY(device_id,family_id) REFERENCES public.family_devices(id,family_id));
CREATE UNIQUE INDEX tv_one_physical_session ON private.tv_sessions((true)) WHERE state<>'ended';
CREATE TABLE private.tv_operations(request_id uuid PRIMARY KEY,usage_id uuid REFERENCES private.tv_sessions,family_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('start','extend','stop','config')),payload jsonb NOT NULL,reserved_seconds integer NOT NULL DEFAULT 0 CHECK(reserved_seconds>=0),resolved boolean NOT NULL DEFAULT false,result jsonb,attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE UNIQUE INDEX tv_one_pending_operation ON private.tv_operations(usage_id) WHERE NOT resolved AND usage_id IS NOT NULL;
ALTER FUNCTION public.family_mutate(text,jsonb,uuid,text) RENAME TO family_mutate_before_tv;
ALTER FUNCTION public.family_mutate_before_tv(text,jsonb,uuid,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.family_mutate_before_tv(text,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,growth_app;
CREATE FUNCTION public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; b private.tv_binding%rowtype;s private.tv_sessions%rowtype;o private.tv_operations%rowtype;d uuid;c uuid;n integer;u uuid;bal bigint;hash text;prev private.mutation_requests%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 hash:=encode(extensions.digest(((p_payload-'pin') || CASE WHEN p_payload?'pin' THEN '{"pin_change":true}'::jsonb ELSE '{}'::jsonb END)::text,'sha256'),'hex');
 SELECT * INTO prev FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prev.action<>p_action OR prev.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 SELECT * INTO b FROM private.tv_binding WHERE singleton FOR UPDATE;
 IF p_action='tv_bind' THEN
  IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
  IF EXISTS(SELECT 1 FROM private.tv_sessions WHERE state<>'ended') THEN RAISE EXCEPTION 'tv_busy'; END IF;
  IF b.family_id IS NOT NULL AND b.family_id<>f THEN RAISE EXCEPTION 'tv_already_bound'; END IF;
  d:=(p_payload->>'device_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.family_devices WHERE id=d AND family_id=f AND active) THEN RAISE EXCEPTION 'device_not_found'; END IF;
  IF EXISTS(SELECT 1 FROM public.device_usage_sessions WHERE device_id=d AND status='running') THEN RAISE EXCEPTION 'device_time_already_running'; END IF;
  INSERT INTO private.tv_binding(singleton,family_id,device_id) VALUES(true,f,d) ON CONFLICT(singleton) DO UPDATE SET device_id=excluded.device_id;
  INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,hash);
  INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,d);
  RETURN public.get_dashboard();
 END IF;
 IF p_action='tv_config_save' THEN
  IF NOT private.parent_valid(f,p_parent_token) OR b.family_id IS DISTINCT FROM f THEN RAISE EXCEPTION 'parent_required'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload->'config') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF b.config IS NULL THEN RAISE EXCEPTION 'tv_config_not_loaded'; END IF;
  IF jsonb_typeof(p_payload#>'{config,manual_block}') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(p_payload#>'{config,schedules}') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_payload#>'{config,workday}') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_payload#>'{config,weekend}') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_tv_config'; END IF;
  SELECT * INTO o FROM private.tv_operations WHERE request_id=p_request_id;
  IF FOUND THEN
   IF o.family_id<>f OR o.action<>'config' OR o.payload->'config' IS DISTINCT FROM p_payload->'config' THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
   RETURN public.get_dashboard();
  END IF;
  IF EXISTS(SELECT 1 FROM private.tv_operations WHERE action='config' AND NOT resolved) THEN RAISE EXCEPTION 'tv_config_pending'; END IF;
  IF (p_payload->>'revision')::bigint IS DISTINCT FROM b.revision THEN RAISE EXCEPTION 'tv_revision_conflict'; END IF;
  n:=b.revision;
  INSERT INTO private.tv_operations(request_id,family_id,action,payload) VALUES(p_request_id,f,'config',jsonb_build_object('request_id',p_request_id,'revision',n,'config',p_payload->'config'));
  INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,hash);
  INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,b.device_id);
  RETURN public.get_dashboard();
 END IF;
 IF p_action='device_time_start' THEN d:=(p_payload->>'device_id')::uuid;
 ELSIF p_action IN ('device_time_extend','device_time_stop') THEN
  SELECT * INTO s FROM private.tv_sessions WHERE id=(p_payload->>'id')::uuid AND family_id=f FOR UPDATE; d:=s.device_id;
 END IF;
 IF d IS NULL OR d IS DISTINCT FROM b.device_id OR b.family_id<>f OR p_action NOT IN ('device_time_start','device_time_extend','device_time_stop') THEN
  RETURN private.family_mutate_before_tv(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
 SELECT * INTO o FROM private.tv_operations WHERE request_id=p_request_id;
 IF FOUND THEN
  IF o.family_id<>f OR o.payload IS DISTINCT FROM p_payload OR o.action<>replace(p_action,'device_time_','') THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 IF p_action<>'device_time_stop' THEN
  IF jsonb_typeof(p_payload->'seconds') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_device_duration'; END IF;
  IF (p_payload->>'seconds')::numeric<>trunc((p_payload->>'seconds')::numeric) OR (p_payload->>'seconds')::numeric NOT BETWEEN 1 AND 10800 THEN RAISE EXCEPTION 'invalid_device_duration'; END IF;
 END IF;
 n:=CASE WHEN p_action='device_time_stop' THEN 0 ELSE (p_payload->>'seconds')::numeric::integer END;
 IF n IS NULL OR (p_action<>'device_time_stop' AND n NOT BETWEEN 1 AND 10800) THEN RAISE EXCEPTION 'invalid_device_duration'; END IF;
 IF p_action='device_time_start' THEN
  c:=(p_payload->>'child_id')::uuid;u:=gen_random_uuid();
  IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.family_devices WHERE id=d AND family_id=f AND active) THEN RAISE EXCEPTION 'device_not_found'; END IF;
  INSERT INTO private.tv_sessions(id,family_id,child_id,device_id,state) VALUES(u,f,c,d,'pending');
 ELSE
  IF s.state<>'active' THEN RAISE EXCEPTION 'tv_not_active'; END IF;
  IF p_action='device_time_extend' AND NOT EXISTS(SELECT 1 FROM public.family_devices WHERE id=s.device_id AND family_id=f AND active) THEN RAISE EXCEPTION 'device_inactive'; END IF;
  c:=s.child_id;u:=s.id;
 END IF;
 SELECT coalesce(sum(seconds_delta),0) INTO bal FROM public.device_time_ledger WHERE family_id=f AND child_id=c AND device_id=d;
 IF bal<n THEN RAISE EXCEPTION 'insufficient_device_time'; END IF;
 INSERT INTO private.tv_operations(request_id,usage_id,family_id,action,payload,reserved_seconds) VALUES(p_request_id,u,f,replace(p_action,'device_time_',''),p_payload,n);
 IF n>0 THEN INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(f,c,d,-n,'reserve',p_request_id); END IF;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,hash);
 INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,u);
 RETURN public.get_dashboard();
END $$;
CREATE FUNCTION public.tv_claim_operation() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.tv_operations%rowtype;
BEGIN
 SELECT * INTO o FROM private.tv_operations WHERE NOT resolved AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE private.tv_operations SET attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '15 seconds' WHERE request_id=o.request_id;
 RETURN jsonb_build_object('request_id',o.request_id,'usage_id',o.usage_id,'action',o.action,'seconds',o.reserved_seconds,'attempts',o.attempts+1,'payload',CASE WHEN o.action='config' THEN o.payload ELSE NULL END);
END $$;
CREATE FUNCTION public.tv_resolve_operation(p_request_id uuid,p_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.tv_operations%rowtype;s private.tv_sessions%rowtype;g integer;r integer;j jsonb;
BEGIN
 SELECT * INTO o FROM private.tv_operations WHERE request_id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_tv_operation'; END IF;
 PERFORM 1 FROM public.families WHERE id=o.family_id FOR UPDATE;
 SELECT * INTO o FROM private.tv_operations WHERE request_id=p_request_id FOR UPDATE;
 IF o.resolved THEN RETURN; END IF;
 IF p_result->>'operation_status' IS DISTINCT FROM (CASE WHEN (p_result->>'accepted')::boolean THEN 'applied' ELSE 'rejected' END) THEN RAISE EXCEPTION 'invalid_tv_operation_status'; END IF;
 IF o.action='config' THEN
  IF p_result->>'request_id' IS DISTINCT FROM p_request_id::text OR jsonb_typeof(p_result->'accepted') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_tv_result'; END IF;
  IF (p_result->>'accepted')::boolean THEN
   IF (p_result->>'revision')::bigint IS DISTINCT FROM (o.payload->>'revision')::bigint+1 THEN RAISE EXCEPTION 'invalid_tv_revision'; END IF;
   UPDATE private.tv_binding SET config=o.payload->'config',revision=(p_result->>'revision')::bigint WHERE family_id=o.family_id;
  END IF;
  UPDATE private.tv_operations SET resolved=true,result=p_result WHERE request_id=p_request_id; RETURN;
 END IF;
 SELECT * INTO s FROM private.tv_sessions WHERE id=o.usage_id FOR UPDATE;
 IF p_result->>'request_id' IS DISTINCT FROM p_request_id::text OR jsonb_typeof(p_result->'accepted') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_tv_result'; END IF;
 g:=(p_result->>'granted_seconds')::integer;
 IF g IS NULL OR g<0 OR g>o.reserved_seconds THEN RAISE EXCEPTION 'invalid_tv_grant'; END IF;
 IF NOT (p_result->>'accepted')::boolean THEN
  IF g<>0 THEN RAISE EXCEPTION 'invalid_tv_rejection'; END IF;
  IF o.action='start' THEN UPDATE private.tv_sessions SET state='ended' WHERE id=s.id; END IF;
 ELSE
  j:=p_result->'session';
  IF j->>'usage_id' IS DISTINCT FROM s.id::text OR coalesce(j->>'status','') NOT IN ('active','ended') THEN RAISE EXCEPTION 'invalid_tv_session'; END IF;
  IF (j->>'granted_seconds')::integer IS DISTINCT FROM s.granted_seconds+g THEN RAISE EXCEPTION 'invalid_tv_cumulative_grant'; END IF;
  IF o.action IN ('start','extend') AND g<=0 THEN RAISE EXCEPTION 'invalid_tv_grant'; END IF;
  UPDATE private.tv_sessions SET granted_seconds=granted_seconds+g,state='active',remote=j WHERE id=s.id;
 END IF;
 r:=o.reserved_seconds-g;
 IF r>0 THEN INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(s.family_id,s.child_id,s.device_id,r,'refund',o.request_id); END IF;
 UPDATE private.tv_operations SET resolved=true,result=p_result WHERE request_id=p_request_id;
END $$;
REVOKE ALL ON private.tv_binding,private.tv_sessions,private.tv_operations FROM PUBLIC,anon,authenticated,growth_app;
REVOKE ALL ON FUNCTION public.family_mutate(text,jsonb,uuid,text),public.tv_claim_operation(),public.tv_resolve_operation(uuid,jsonb) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.family_mutate(text,jsonb,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_claim_operation(),public.tv_resolve_operation(uuid,jsonb) TO growth_tv_worker;
CREATE FUNCTION public.tv_sessions_to_poll() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('usage_id',id)),'[]'::jsonb) FROM private.tv_sessions s WHERE state='active' AND NOT EXISTS(SELECT 1 FROM private.tv_operations o WHERE o.usage_id=s.id AND NOT o.resolved)
$$;
CREATE FUNCTION public.tv_resolve_session(p_usage_id uuid,p_session jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.tv_sessions%rowtype;n integer;r integer;
BEGIN
 SELECT * INTO s FROM private.tv_sessions WHERE id=p_usage_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_tv_session'; END IF;
 PERFORM 1 FROM public.families WHERE id=s.family_id FOR UPDATE;
 SELECT * INTO s FROM private.tv_sessions WHERE id=p_usage_id FOR UPDATE;
 IF s.state='ended' THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM private.tv_operations WHERE usage_id=p_usage_id AND NOT resolved) THEN RETURN; END IF;
 IF p_session->>'usage_id' IS DISTINCT FROM p_usage_id::text OR coalesce(p_session->>'status','') NOT IN ('active','ended') THEN RAISE EXCEPTION 'invalid_tv_session'; END IF;
 IF (p_session->>'granted_seconds')::integer IS DISTINCT FROM s.granted_seconds THEN RAISE EXCEPTION 'invalid_tv_cumulative_grant'; END IF;
 IF p_session->>'status'='active' THEN UPDATE private.tv_sessions SET remote=p_session WHERE id=p_usage_id;RETURN; END IF;
 n:=(p_session->>'consumed_seconds')::integer;
 IF n IS NULL OR n<0 OR n>s.granted_seconds OR p_session->>'ended_at' IS NULL THEN RAISE EXCEPTION 'invalid_tv_consumption'; END IF;
 r:=s.granted_seconds-n;
 IF r>0 THEN INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(s.family_id,s.child_id,s.device_id,r,'refund',s.id); END IF;
 UPDATE private.tv_sessions SET state='ended',consumed_seconds=n,remote=p_session WHERE id=p_usage_id;
END $$;
REVOKE ALL ON FUNCTION public.tv_sessions_to_poll(),public.tv_resolve_session(uuid,jsonb) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.tv_sessions_to_poll(),public.tv_resolve_session(uuid,jsonb) TO growth_tv_worker;
ALTER FUNCTION public.get_dashboard() RENAME TO get_dashboard_before_tv;
ALTER FUNCTION public.get_dashboard_before_tv() SET SCHEMA private;
REVOKE ALL ON FUNCTION private.get_dashboard_before_tv() FROM PUBLIC,anon,authenticated,growth_app;
CREATE FUNCTION public.get_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;result jsonb;
BEGIN
 result:=private.get_dashboard_before_tv();f:=private.owned_family();
 RETURN result || jsonb_build_object('tv_settings',(SELECT jsonb_build_object('device_id',device_id,'config',config,'revision',revision,'last_result',(SELECT op.result FROM private.tv_operations op WHERE family_id=f AND action='config' ORDER BY next_attempt_at DESC LIMIT 1),'pending',EXISTS(SELECT 1 FROM private.tv_operations WHERE action='config' AND NOT resolved AND family_id=f)) FROM private.tv_binding WHERE family_id=f),'tv_status',(SELECT jsonb_build_object('snapshot',status_snapshot,'checked_at',status_checked_at) FROM private.tv_binding WHERE family_id=f),'tv_sessions',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM private.tv_sessions s WHERE family_id=f),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_dashboard() FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.get_dashboard() TO authenticated;



CREATE FUNCTION public.tv_update_status(p_status jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p_status) IS DISTINCT FROM 'object' OR octet_length(p_status::text)>65536 THEN RAISE EXCEPTION 'invalid_tv_status'; END IF;
 UPDATE private.tv_binding SET status_snapshot=p_status,status_checked_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.tv_update_status(jsonb) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.tv_update_status(jsonb) TO growth_tv_worker;
CREATE FUNCTION public.tv_update_config(p_config jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p_config->'config') IS DISTINCT FROM 'object' OR jsonb_typeof(p_config->'revision') IS DISTINCT FROM 'number' OR (p_config->>'revision')::bigint<1 THEN RAISE EXCEPTION 'invalid_tv_config'; END IF;
 UPDATE private.tv_binding b SET config=p_config->'config',revision=(p_config->>'revision')::bigint WHERE NOT EXISTS(SELECT 1 FROM private.tv_operations WHERE action='config' AND NOT resolved AND family_id=b.family_id);
END $$;
REVOKE ALL ON FUNCTION public.tv_update_config(jsonb) FROM PUBLIC,anon,authenticated,growth_app;
GRANT EXECUTE ON FUNCTION public.tv_update_config(jsonb) TO growth_tv_worker;






GRANT USAGE ON SCHEMA public TO growth_tv_worker;


