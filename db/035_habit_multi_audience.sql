-- Parent-only atomic composition of existing CAS-checked habit operations.
CREATE OR REPLACE FUNCTION public.family_habit_multi(p_payload jsonb,p_request_id uuid,p_parent_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; prior private.mutation_requests%rowtype; hash text; op jsonb; t jsonb; k text; seen text[]:=ARRAY[]::text[]; i integer:=0;
BEGIN
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload->'operations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'operations') NOT BETWEEN 1 AND 100 OR octet_length(p_payload::text)>64000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>'habit_batch_multi' OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(p_payload->'operations') LOOP
  IF op->>'action' NOT IN ('habit_batch_patch','habit_batch_save') OR op->>'action' IS NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF jsonb_typeof(op->'payload'->'targets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(op->'payload'->'targets') LOOP
   IF nullif(t->>'id','') IS NOT NULL THEN k:='id:'||(t->>'id');
   ELSE
    k:='new:'||(t->>'child_id')||':'||trim(op->'payload'->'rule'->>'name');
    IF EXISTS(SELECT 1 FROM public.habits WHERE family_id=f AND child_id=(t->>'child_id')::uuid AND archived_at IS NULL AND trim(name)=trim(op->'payload'->'rule'->>'name')) THEN RAISE EXCEPTION 'habit_changed_refresh'; END IF;
   END IF;
   IF k IS NULL OR k=ANY(seen) THEN RAISE EXCEPTION 'invalid_request'; END IF;
   seen:=array_append(seen,k);
  END LOOP;
 END LOOP;
 FOR op IN SELECT value FROM jsonb_array_elements(p_payload->'operations') LOOP
  i:=i+1;
  PERFORM public.family_habit_batch(op->>'action',op->'payload',md5('multi:'||p_request_id::text||':'||i)::uuid,p_parent_token);
 END LOOP;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,'habit_batch_multi',hash);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.family_habit_multi(jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_habit_multi(jsonb,uuid,text) TO authenticated;
