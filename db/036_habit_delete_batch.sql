-- Parent-authorized atomic soft deletion; historical rows and ledger are retained.
CREATE OR REPLACE FUNCTION public.family_habit_delete_batch(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; h public.habits%rowtype; t jsonb; rule jsonb; save_payload jsonb;
 hash text; prior private.mutation_requests%rowtype; seen text[]:=ARRAY[]::text[];
 target_key text; child uuid; hid uuid; sub_id uuid; fingerprint jsonb; expected jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 -- Check capability even on a replay of a previously committed request.
 IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 IF p_action <> 'habit_batch_delete' OR p_request_id IS NULL
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF octet_length(p_payload::text)>16000 THEN RAISE EXCEPTION 'payload_too_large'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>p_action OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;

 IF jsonb_typeof(p_payload->'targets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF jsonb_array_length(p_payload->'targets') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 -- Validate the complete selection first under the same family lock. No partial saves.
 FOR t IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
  IF jsonb_typeof(t) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  child:=(t->>'child_id')::uuid; hid:=nullif(t->>'id','')::uuid;
  IF child IS NULL OR NOT EXISTS(SELECT 1 FROM public.children WHERE id=child AND family_id=f)
   THEN RAISE EXCEPTION 'child_not_found'; END IF;
  target_key:=hid::text;
  IF target_key IS NULL OR target_key=ANY(seen) THEN RAISE EXCEPTION 'invalid_request'; END IF;
  seen:=array_append(seen,target_key);
  IF hid IS NOT NULL THEN
   SELECT * INTO h FROM public.habits WHERE id=hid AND family_id=f AND child_id=child AND archived_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'habit_not_found'; END IF;
   IF jsonb_typeof(t->'expected') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_request'; END IF;
   BEGIN expected:=(t->>'expected')::jsonb; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request'; END;
   fingerprint:=jsonb_build_array(h.name,h.icon,h.color,
    (SELECT jsonb_agg(v ORDER BY v) FROM unnest(h.weekdays) v),h.target_count,h.target_minutes,h.stars,h.requires_approval,h.active);
   IF expected IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'habit_changed_refresh'; END IF;
  ELSE RAISE EXCEPTION 'invalid_request';
  END IF;
 END LOOP;

 FOR t IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
  hid:=(t->>'id')::uuid;
  sub_id:=md5('habit-delete-batch:'||p_request_id::text||':'||hid::text)::uuid;
  PERFORM public.family_mutate('habit_delete',jsonb_build_object('id',hid),sub_id,p_parent_token);
 END LOOP;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,hash);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.family_habit_delete_batch(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_habit_delete_batch(text,jsonb,uuid,text) TO authenticated;
