-- Ordinary device-wallet policy. Existing sessions retain their original behavior.
-- TV integration remains delegated unchanged to the prior wrapper.
ALTER TABLE public.family_devices
 ADD COLUMN cooldown_seconds integer NOT NULL DEFAULT 900 CHECK(cooldown_seconds BETWEEN 0 AND 86400),
 ADD COLUMN max_extensions integer NOT NULL DEFAULT 1 CHECK(max_extensions BETWEEN 0 AND 20);
ALTER TABLE public.device_usage_sessions
 ADD COLUMN cooldown_seconds integer NOT NULL DEFAULT 0 CHECK(cooldown_seconds BETWEEN 0 AND 86400),
 ADD COLUMN max_extensions integer NOT NULL DEFAULT 10800 CHECK(max_extensions BETWEEN 0 AND 10800),
 ADD COLUMN extension_count integer NOT NULL DEFAULT 0 CHECK(extension_count BETWEEN 0 AND max_extensions);

ALTER FUNCTION public.family_mutate(text,jsonb,uuid,text) RENAME TO family_mutate_before_wallet_policy;
ALTER FUNCTION public.family_mutate_before_wallet_policy(text,jsonb,uuid,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.family_mutate_before_wallet_policy(text,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,growth_app;

CREATE FUNCTION public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; obj uuid; c uuid; d uuid; b uuid; h text; prior private.mutation_requests%rowtype;
 device public.family_devices%rowtype; usage public.device_usage_sessions%rowtype;
 cooldown integer; max_ext integer; now_at timestamptz; wait_until timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF p_action NOT IN ('device_save','device_time_start','device_time_extend','device_time_stop') THEN
  RETURN private.family_mutate_before_wallet_policy(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF p_action='device_save' AND NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 h:=encode(extensions.digest(((p_payload-'pin') || CASE WHEN p_payload?'pin' THEN '{"pin_change":true}'::jsonb ELSE '{}'::jsonb END)::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>p_action OR prior.payload_hash<>h THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 SELECT device_id INTO b FROM private.tv_binding WHERE family_id=f;
 obj:=nullif(p_payload->>'id','')::uuid;
 IF p_action='device_save' THEN
  IF obj IS NOT NULL THEN
   SELECT * INTO device FROM public.family_devices WHERE id=obj AND family_id=f;
   IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found'; END IF;
  END IF;
  IF obj=b AND (p_payload?'cooldown_seconds' OR p_payload?'max_extensions') THEN
   RAISE EXCEPTION 'tv_policy_managed_elsewhere';
  END IF;
  IF (p_payload?'cooldown_seconds' AND (jsonb_typeof(p_payload->'cooldown_seconds') IS DISTINCT FROM 'number'
      OR (p_payload->>'cooldown_seconds')::numeric<>trunc((p_payload->>'cooldown_seconds')::numeric)
      OR (p_payload->>'cooldown_seconds')::numeric NOT BETWEEN 0 AND 86400))
   OR (p_payload?'max_extensions' AND (jsonb_typeof(p_payload->'max_extensions') IS DISTINCT FROM 'number'
      OR (p_payload->>'max_extensions')::numeric<>trunc((p_payload->>'max_extensions')::numeric)
      OR (p_payload->>'max_extensions')::numeric NOT BETWEEN 0 AND 20))
   THEN RAISE EXCEPTION 'invalid_device_policy'; END IF;
  cooldown:=coalesce((p_payload->>'cooldown_seconds')::integer,device.cooldown_seconds,900);
  max_ext:=coalesce((p_payload->>'max_extensions')::integer,device.max_extensions,1);
  IF obj IS NULL THEN
   INSERT INTO public.family_devices(family_id,name,active,cooldown_seconds,max_extensions)
   VALUES(f,trim(p_payload->>'name'),coalesce((p_payload->>'active')::boolean,true),cooldown,max_ext) RETURNING id INTO obj;
  ELSE
   UPDATE public.family_devices SET name=coalesce(trim(p_payload->>'name'),name),active=coalesce((p_payload->>'active')::boolean,active),
    cooldown_seconds=cooldown,max_extensions=max_ext WHERE id=obj AND family_id=f;
  END IF;
  INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,h);
  INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,obj);
  RETURN public.get_dashboard();
 END IF;
 IF p_action='device_time_start' THEN
  d:=(p_payload->>'device_id')::uuid; c:=(p_payload->>'child_id')::uuid;
 ELSE
  SELECT * INTO usage FROM public.device_usage_sessions WHERE id=obj AND family_id=f;
  d:=usage.device_id; c:=usage.child_id;
 END IF;
 -- TV sessions are private.tv_sessions, not public.device_usage_sessions.
 -- Unknown/nonordinary sessions and explicitly bound TV devices keep their old path.
 IF d IS NULL OR d=b THEN
  RETURN private.family_mutate_before_wallet_policy(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 IF p_action='device_time_start' THEN
  IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
  SELECT * INTO device FROM public.family_devices WHERE id=d AND family_id=f AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_inactive'; END IF;
  PERFORM private.settle_device_family(f);
  now_at:=clock_timestamp();
  SELECT max(ended_at+cooldown_seconds*interval '1 second') INTO wait_until
   FROM public.device_usage_sessions WHERE family_id=f AND child_id=c AND device_id=d AND status<>'running';
  IF wait_until>now_at THEN RAISE EXCEPTION 'device_time_cooldown'; END IF;
  PERFORM private.family_mutate_before_wallet_policy(p_action,p_payload,p_request_id,p_parent_token);
  UPDATE public.device_usage_sessions SET cooldown_seconds=device.cooldown_seconds,max_extensions=device.max_extensions,extension_count=0
   WHERE family_id=f AND request_id=p_request_id AND child_id=c AND device_id=d;
  RETURN public.get_dashboard();
 ELSIF p_action='device_time_extend' THEN
  -- The underlying operation still checks expiry, limits and available balance.
  IF usage.status='running' AND usage.deadline_at>clock_timestamp() AND usage.extension_count>=usage.max_extensions THEN
   RAISE EXCEPTION 'device_extension_limit';
  END IF;
  PERFORM private.family_mutate_before_wallet_policy(p_action,p_payload,p_request_id,p_parent_token);
  UPDATE public.device_usage_sessions SET extension_count=extension_count+1 WHERE id=usage.id AND family_id=f;
  RETURN public.get_dashboard();
 END IF;
 RETURN private.family_mutate_before_wallet_policy(p_action,p_payload,p_request_id,p_parent_token);
END $$;
REVOKE ALL ON FUNCTION public.family_mutate(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_mutate(text,jsonb,uuid,text) TO authenticated;
