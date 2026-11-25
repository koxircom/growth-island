-- Optional per-device windows. Existing devices retain unrestricted timing until configured.
ALTER TABLE public.family_devices ADD COLUMN schedule_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN schedules jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE FUNCTION private.device_window_end(p_schedules jsonb,p_zone text,p_now timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s jsonb; day date; offset_day integer; starts timestamptz; ends timestamptz; result timestamptz;
BEGIN
 FOR offset_day IN -1..0 LOOP
  day:=(p_now AT TIME ZONE p_zone)::date+offset_day;
  FOR s IN SELECT value FROM jsonb_array_elements(p_schedules) LOOP
   IF (s->>'enabled')::boolean AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(s->'days') x WHERE x::integer=extract(isodow FROM day)::integer) THEN
    starts:=(day+(s->>'start')::time) AT TIME ZONE p_zone;
    ends:=((day+CASE WHEN (s->>'end')::time<(s->>'start')::time THEN 1 ELSE 0 END)+(s->>'end')::time) AT TIME ZONE p_zone;
    IF p_now>=starts AND p_now<ends THEN result:=greatest(result,ends); END IF;
   END IF;
  END LOOP;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.device_window_end(jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated,growth_app;

ALTER FUNCTION public.family_mutate(text,jsonb,uuid,text) RENAME TO family_mutate_before_device_schedule;
ALTER FUNCTION public.family_mutate_before_device_schedule(text,jsonb,uuid,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.family_mutate_before_device_schedule(text,jsonb,uuid,text) FROM PUBLIC,anon,authenticated,growth_app;
CREATE FUNCTION public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; zone text; obj uuid; d public.family_devices%rowtype; usage public.device_usage_sessions%rowtype;
 previous private.mutation_requests%rowtype; h text; rules jsonb; s jsonb; day_item jsonb; enabled boolean; cutoff timestamptz; at_now timestamptz; seconds integer;
BEGIN
 IF p_action NOT IN ('device_save','device_time_start','device_time_extend') THEN
  RETURN private.family_mutate_before_device_schedule(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 SELECT id,timezone INTO f,zone FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 h:=encode(extensions.digest(((p_payload-'pin') || CASE WHEN p_payload?'pin' THEN '{"pin_change":true}'::jsonb ELSE '{}'::jsonb END)::text,'sha256'),'hex');
 SELECT * INTO previous FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.action<>p_action OR previous.payload_hash<>h THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 obj:=nullif(p_payload->>'id','')::uuid;
 IF p_action='device_save' THEN
  IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
  IF obj IS NOT NULL THEN
   SELECT * INTO d FROM public.family_devices WHERE id=obj AND family_id=f;
   IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM private.tv_binding WHERE family_id=f AND device_id=obj) AND (p_payload?'schedule_enabled' OR p_payload?'schedules') THEN RAISE EXCEPTION 'tv_policy_managed_elsewhere'; END IF;
  IF p_payload?'schedule_enabled' AND jsonb_typeof(p_payload->'schedule_enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_device_schedule'; END IF;
  enabled:=coalesce((p_payload->>'schedule_enabled')::boolean,d.schedule_enabled,false);
  rules:=coalesce(p_payload->'schedules',d.schedules,'[]'::jsonb);
  IF jsonb_typeof(rules) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_device_schedule'; END IF;
  IF jsonb_array_length(rules)>20 THEN RAISE EXCEPTION 'invalid_device_schedule'; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(rules) LOOP
   IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR jsonb_typeof(s->'enabled') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(s->'days') IS DISTINCT FROM 'array' OR coalesce(s->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR coalesce(s->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR s->>'start'=s->>'end' THEN RAISE EXCEPTION 'invalid_device_schedule'; END IF;
   IF jsonb_array_length(s->'days') NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'invalid_device_schedule'; END IF;
   FOR day_item IN SELECT value FROM jsonb_array_elements(s->'days') LOOP
    IF jsonb_typeof(day_item) IS DISTINCT FROM 'number' OR day_item::text !~ '^[1-7]$' THEN RAISE EXCEPTION 'invalid_device_schedule'; END IF;
   END LOOP;
  END LOOP;
  PERFORM private.family_mutate_before_device_schedule(p_action,p_payload,p_request_id,p_parent_token);
  IF obj IS NULL THEN SELECT object_id INTO obj FROM private.audit_log WHERE family_id=f AND actor_id=auth.uid() AND action='device_save' ORDER BY id DESC LIMIT 1; END IF;
  UPDATE public.family_devices SET schedule_enabled=enabled,schedules=rules WHERE id=obj AND family_id=f;
  RETURN public.get_dashboard();
 END IF;
 IF p_action='device_time_start' THEN
  SELECT * INTO d FROM public.family_devices WHERE id=(p_payload->>'device_id')::uuid AND family_id=f;
 ELSE
  SELECT * INTO usage FROM public.device_usage_sessions WHERE id=obj AND family_id=f;
  SELECT * INTO d FROM public.family_devices WHERE id=usage.device_id AND family_id=f;
 END IF;
 IF d.id IS NULL OR NOT d.schedule_enabled OR EXISTS(SELECT 1 FROM private.tv_binding WHERE family_id=f AND device_id=d.id) THEN
  RETURN private.family_mutate_before_device_schedule(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 at_now:=clock_timestamp(); cutoff:=private.device_window_end(d.schedules,zone,at_now);
 IF cutoff IS NULL THEN RAISE EXCEPTION 'device_outside_allowed_time'; END IF;
 IF jsonb_typeof(p_payload->'seconds') IS DISTINCT FROM 'number' OR (p_payload->>'seconds')::numeric<>trunc((p_payload->>'seconds')::numeric) OR (p_payload->>'seconds')::numeric NOT BETWEEN 1 AND 10800 THEN RAISE EXCEPTION 'invalid_device_duration'; END IF;
 seconds:=(p_payload->>'seconds')::integer;
 IF (CASE WHEN p_action='device_time_extend' THEN usage.deadline_at ELSE at_now END)+seconds*interval '1 second'>cutoff THEN RAISE EXCEPTION 'device_time_exceeds_window'; END IF;
 PERFORM private.family_mutate_before_device_schedule(p_action,p_payload,p_request_id,p_parent_token);
 -- Recheck the actual stored deadline so processing near the boundary never overshoots.
 IF EXISTS(SELECT 1 FROM public.device_usage_sessions WHERE family_id=f AND id=CASE WHEN p_action='device_time_extend' THEN obj ELSE (SELECT id FROM public.device_usage_sessions WHERE family_id=f AND request_id=p_request_id) END AND deadline_at>cutoff) THEN RAISE EXCEPTION 'device_time_exceeds_window'; END IF;
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.family_mutate(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_mutate(text,jsonb,uuid,text) TO authenticated;
