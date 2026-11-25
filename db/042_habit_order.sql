-- Display order only. Never update habit rules, history, check-ins or stars.
CREATE TABLE private.habit_orders (
 family_id uuid NOT NULL REFERENCES public.families(id),
 child_id uuid NOT NULL REFERENCES public.children(id),
 category text NOT NULL CHECK(category IN ('routine','occasional')),
 ids uuid[] NOT NULL DEFAULT '{}', revision bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(family_id,child_id,category)
);
REVOKE ALL ON private.habit_orders FROM PUBLIC,anon,authenticated,growth_app;

CREATE FUNCTION private.habit_order_state(f uuid,c uuid,k text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH ordered AS (
 SELECT h.id FROM public.habits h
 LEFT JOIN private.habit_orders o ON o.family_id=f AND o.child_id=c AND o.category=k
 WHERE h.family_id=f AND h.child_id=c AND h.archived_at IS NULL AND h.category=k
 ORDER BY array_position(o.ids,h.id) NULLS LAST,h.created_at,h.id
 ), ids AS (SELECT coalesce(jsonb_agg(id),'[]'::jsonb) value FROM ordered)
 SELECT jsonb_build_object('ids',ids.value,'token',md5(ids.value::text||':'||
 coalesce((SELECT revision FROM private.habit_orders WHERE family_id=f AND child_id=c AND category=k),0)::text)) FROM ids
$$;
REVOKE ALL ON FUNCTION private.habit_order_state(uuid,uuid,text) FROM PUBLIC,anon,authenticated,growth_app;

CREATE FUNCTION public.habit_order_read(p_child uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid();
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=p_child AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
 RETURN jsonb_build_object('routine',private.habit_order_state(f,p_child,'routine'),
 'occasional',private.habit_order_state(f,p_child,'occasional'));
END $$;

CREATE FUNCTION public.habit_order_save(p_payload jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;c uuid;k text;state jsonb;hash text;prior private.mutation_requests%rowtype;
 proposed uuid[];full_ids uuid[];result_ids uuid[]:='{}';hid uuid;pos integer:=1;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 c:=(p_payload->>'child_id')::uuid;k:=p_payload->>'category';
 IF c IS NULL OR NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
 IF k IS NULL OR k NOT IN ('routine','occasional') OR jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'token') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF jsonb_array_length(p_payload->'ids') NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>'habit_reorder' OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.habit_order_read(c);
 END IF;
 SELECT array_agg(value::uuid) INTO proposed FROM jsonb_array_elements_text(p_payload->'ids');
 IF cardinality(proposed)<>(SELECT count(DISTINCT v) FROM unnest(proposed) v) OR array_position(proposed,NULL) IS NOT NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
 state:=private.habit_order_state(f,c,k);
 IF state->>'token' IS DISTINCT FROM p_payload->>'token' THEN RAISE EXCEPTION 'habit_order_conflict'; END IF;
 SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO full_ids FROM jsonb_array_elements_text(state->'ids');
 IF NOT proposed <@ full_ids THEN RAISE EXCEPTION 'invalid_request'; END IF;
 -- Reorder visible items in their existing slots; hidden weekdays/inactive habits retain theirs.
 FOREACH hid IN ARRAY full_ids LOOP
  IF hid=ANY(proposed) THEN result_ids:=array_append(result_ids,proposed[pos]);pos:=pos+1;
  ELSE result_ids:=array_append(result_ids,hid); END IF;
 END LOOP;
 INSERT INTO private.habit_orders(family_id,child_id,category,ids,revision) VALUES(f,c,k,result_ids,1)
 ON CONFLICT(family_id,child_id,category) DO UPDATE SET ids=excluded.ids,revision=private.habit_orders.revision+1;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,'habit_reorder',hash);
 RETURN public.habit_order_read(c);
END $$;
REVOKE ALL ON FUNCTION public.habit_order_read(uuid),public.habit_order_save(jsonb,uuid) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.habit_order_read(uuid),public.habit_order_save(jsonb,uuid) TO authenticated;
