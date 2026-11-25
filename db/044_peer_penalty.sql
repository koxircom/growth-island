-- Family-wide versioned configured penalties. Empty on migration; no historical inference.
CREATE TABLE public.penalty_rule_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families(id),
 rule_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>0), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=500), stars integer NOT NULL CHECK(stars BETWEEN 1 AND 10), enabled boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(rule_id,revision)
);
ALTER TABLE public.penalty_rule_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_read ON public.penalty_rule_versions FOR SELECT TO authenticated USING(family_id=public.current_family_id());
REVOKE ALL ON public.penalty_rule_versions FROM PUBLIC,anon,authenticated,growth_app;
GRANT SELECT ON public.penalty_rule_versions TO authenticated;
CREATE FUNCTION public.penalty_rules_read() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY created_at,rule_id),'[]') FROM (SELECT DISTINCT ON(rule_id) * FROM public.penalty_rule_versions WHERE family_id=private.owned_family() ORDER BY rule_id,revision DESC)x;
$$;
REVOKE ALL ON FUNCTION public.penalty_rules_read() FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.penalty_rules_read() TO authenticated;
CREATE FUNCTION public.penalty_rule_save(p_payload jsonb,p_request_id uuid,p_parent_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; prior private.mutation_requests%rowtype; hash text; old public.penalty_rule_versions%rowtype; rid uuid; expected bigint;
BEGIN
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>4000 OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string' OR length(p_payload->>'description')>500 OR jsonb_typeof(p_payload->'stars') IS DISTINCT FROM 'number' OR (p_payload->>'stars')::numeric<>trunc((p_payload->>'stars')::numeric) OR (p_payload->>'stars')::numeric NOT BETWEEN 1 AND 10 OR jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_payload->'expected_revision') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>'penalty_rule_save' OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.penalty_rules_read();
 END IF;
 IF (p_payload->>'expected_revision')::numeric<>trunc((p_payload->>'expected_revision')::numeric) THEN RAISE EXCEPTION 'invalid_request'; END IF;
 expected:=(p_payload->>'expected_revision')::bigint;rid:=nullif(p_payload->>'rule_id','')::uuid;
 IF rid IS NULL THEN
  IF expected<>0 THEN RAISE EXCEPTION 'penalty_rule_conflict'; END IF;
  IF (SELECT count(DISTINCT rule_id) FROM public.penalty_rule_versions WHERE family_id=f)>=100 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  rid:=gen_random_uuid();
 ELSE
  SELECT * INTO old FROM public.penalty_rule_versions WHERE family_id=f AND rule_id=rid ORDER BY revision DESC LIMIT 1;
  IF old.id IS NULL OR old.revision<>expected THEN RAISE EXCEPTION 'penalty_rule_conflict'; END IF;
 END IF;
 INSERT INTO public.penalty_rule_versions(family_id,rule_id,revision,name,description,stars,enabled) VALUES(f,rid,expected+1,trim(p_payload->>'name'),p_payload->>'description',(p_payload->>'stars')::integer,(p_payload->>'enabled')::boolean);
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,'penalty_rule_save',hash);
 RETURN public.penalty_rules_read();
END $$;
REVOKE ALL ON FUNCTION public.penalty_rule_save(jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.penalty_rule_save(jsonb,uuid,text) TO authenticated;
-- Narrow household child-facing fixed-rule deduction. No parent capabilities granted.
CREATE FUNCTION public.peer_penalty_save(p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; fam public.families%rowtype; prior private.mutation_requests%rowtype; hash text; c uuid; rule public.star_rule_versions%rowtype; tz text; today date; used integer; bal integer; cap integer; obj uuid; actor uuid; bh text; penalty public.penalty_rule_versions%rowtype; deduction_amount integer;
BEGIN
 SELECT * INTO fam FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 f:=fam.id;IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>1000 OR jsonb_typeof(p_payload->'rule_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expected_revision') IS DISTINCT FROM 'number' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('child_id','rule_id','expected_revision')) THEN RAISE EXCEPTION 'invalid_request'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>'peer_penalty' OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 c:=(p_payload->>'child_id')::uuid;
 IF c IS NULL OR NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
 SELECT * INTO penalty FROM public.penalty_rule_versions WHERE family_id=f AND rule_id=(p_payload->>'rule_id')::uuid ORDER BY revision DESC LIMIT 1;
 IF penalty.id IS NULL OR NOT penalty.enabled OR penalty.revision::numeric<>(p_payload->>'expected_revision')::numeric THEN RAISE EXCEPTION 'penalty_rule_conflict'; END IF;
 deduction_amount:=penalty.stars;
 -- Suppress separate-request double taps too, across devices, without consuming another star.
 IF EXISTS(SELECT 1 FROM public.star_adjustments WHERE child_id=c AND family_id=f AND kind='deduction' AND detail->>'peer_rule_id'=penalty.rule_id::text AND created_at>clock_timestamp()-interval '5 seconds') THEN RAISE EXCEPTION 'peer_penalty_recent'; END IF;
 SELECT * INTO rule FROM public.star_rule_versions WHERE child_id=c AND family_id=f ORDER BY revision DESC LIMIT 1;
 tz:=coalesce(rule.timezone,fam.timezone);today:=(clock_timestamp() AT TIME ZONE tz)::date;cap:=coalesce(rule.deduction_limit,3);
 SELECT coalesce(sum(-a.amount),0) INTO used FROM public.star_adjustments a WHERE a.child_id=c AND a.family_id=f AND a.kind='deduction' AND (a.created_at>=today::timestamp AT TIME ZONE tz OR a.created_at>clock_timestamp()-interval '24 hours');
 IF used+deduction_amount>cap THEN RAISE EXCEPTION 'star_daily_limit'; END IF;
 SELECT coalesce(sum(l.amount),0) INTO bal FROM public.star_ledger l WHERE l.family_id=f AND l.child_id=c;
 IF bal<deduction_amount THEN RAISE EXCEPTION 'insufficient_stars'; END IF;
 bh:=current_setting('request.child_browser_hash',true);
 SELECT s.child_id INTO actor FROM private.child_access_sessions s JOIN private.child_credentials cr ON cr.child_id=s.child_id AND cr.family_id=s.family_id AND cr.version=s.credential_version WHERE s.family_id=f AND s.browser_hash=bh AND s.expires_at>clock_timestamp();
 obj:=private.star_post(f,c,'deduction',-deduction_amount,'未遵守事先约定：'||penalty.name,rule.id,today,tz);
 UPDATE public.star_adjustments SET detail=coalesce(detail,'{}')||jsonb_build_object('peer_rule_id',penalty.rule_id,'peer_rule_revision',penalty.revision,'peer_rule_name',penalty.name,'configured_stars',deduction_amount,'actor_mode',CASE WHEN actor IS NULL THEN 'household_shared' ELSE 'authenticated_child' END,'authenticated_child_id',actor) WHERE id=obj AND family_id=f;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,'peer_penalty',hash);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.peer_penalty_save(jsonb,uuid) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.peer_penalty_save(jsonb,uuid) TO authenticated;
