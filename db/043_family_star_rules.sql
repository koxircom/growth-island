-- Add a parent-only atomic family configuration operation. No data backfill.
CREATE FUNCTION public.family_star_rules_save(p_payload jsonb,p_request_id uuid,p_parent_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; prior private.mutation_requests%rowtype; hash text; target jsonb; c uuid; latest uuid; seen uuid[]:='{}'; n integer;
BEGIN
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>16000 OR jsonb_typeof(p_payload->'targets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>'star_rules_family_save' OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 SELECT count(*) INTO n FROM public.children WHERE family_id=f;
 IF n<1 OR jsonb_array_length(p_payload->'targets')<>n THEN RAISE EXCEPTION 'star_rules_conflict'; END IF;
 FOR target IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
  c:=(target->>'child_id')::uuid;
  IF c IS NULL OR c=ANY(seen) OR NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
  seen:=array_append(seen,c);
  SELECT id INTO latest FROM public.star_rule_versions WHERE child_id=c AND family_id=f ORDER BY revision DESC LIMIT 1;
  IF NOT(target?'expected_rule_id') OR latest IS DISTINCT FROM nullif(target->>'expected_rule_id','')::uuid THEN RAISE EXCEPTION 'star_rules_conflict'; END IF;
 END LOOP;
 FOR target IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
  PERFORM public.family_mutate('star_rules_save',jsonb_build_object('child_id',target->'child_id','habit_ids',target->'habit_ids','deduction_limit',p_payload->'deduction_limit','streak_enabled',p_payload->'streak_enabled','savings_enabled',p_payload->'savings_enabled'),md5('family-star:'||p_request_id::text||':'||(target->>'child_id'))::uuid,p_parent_token);
 END LOOP;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,'star_rules_family_save',hash);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.family_star_rules_save(jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_star_rules_save(jsonb,uuid,text) TO authenticated;
