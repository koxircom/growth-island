-- Forward-only category metadata. No existing classification, ledger or streak is rewritten.
ALTER TABLE public.habits ADD COLUMN category text NOT NULL DEFAULT 'routine' CHECK(category IN ('routine','occasional'));
ALTER TABLE public.habit_versions ADD COLUMN category text NOT NULL DEFAULT 'routine' CHECK(category IN ('routine','occasional'));

CREATE OR REPLACE FUNCTION private.record_habit_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d date;
BEGIN
 SELECT (now() AT TIME ZONE timezone)::date INTO d FROM public.families WHERE id=NEW.family_id;
 INSERT INTO public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived,category)
 VALUES(NEW.family_id,NEW.id,NEW.child_id,d,NEW.name,NEW.icon,NEW.color,NEW.weekdays,NEW.target_count,NEW.target_minutes,NEW.stars,NEW.requires_approval,NEW.active,NEW.archived_at IS NOT NULL,NEW.category)
 ON CONFLICT(habit_id,effective_day) DO UPDATE SET name=EXCLUDED.name,icon=EXCLUDED.icon,color=EXCLUDED.color,weekdays=EXCLUDED.weekdays,target_count=EXCLUDED.target_count,target_minutes=EXCLUDED.target_minutes,stars=EXCLUDED.stars,requires_approval=EXCLUDED.requires_approval,active=EXCLUDED.active,archived=EXCLUDED.archived,category=EXCLUDED.category;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.record_habit_version() FROM PUBLIC,anon,authenticated,growth_app;

-- Patch only the checked existing implementation, keeping original request hashing and wrapper chain.
DO $migration$
DECLARE body text; needle text; replacement text;
BEGIN
 body:=pg_get_functiondef('private.family_mutate_before_star_rules(text,jsonb,uuid,text)'::regprocedure);
 FOR needle,replacement IN SELECT * FROM (VALUES
($s$when 'habit_save' then
 cid:=$s$,$s$when 'habit_save' then
 if p_payload?'category' and (jsonb_typeof(p_payload->'category') is distinct from 'string' or p_payload->>'category' not in ('routine','occasional')) then raise exception 'invalid_request'; end if;
 cid:=$s$),
($s$insert into public.habits(family_id,child_id,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active)$s$,$s$insert into public.habits(family_id,child_id,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,category)$s$),
($s$coalesce((p_payload->>'requires_approval')::boolean,true),coalesce((p_payload->>'active')::boolean,true)) returning id into obj;$s$,$s$coalesce((p_payload->>'requires_approval')::boolean,true),coalesce((p_payload->>'active')::boolean,true),coalesce(p_payload->>'category','routine')) returning id into obj;$s$),
($s$active=coalesce((p_payload->>'active')::boolean,active),updated_at=now() where id=obj and child_id=cid$s$,$s$active=coalesce((p_payload->>'active')::boolean,active),category=case when p_payload?'category' then p_payload->>'category' else category end,updated_at=now() where id=obj and child_id=cid$s$),
($s$insert into public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived)$s$,$s$insert into public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived,category)$s$),
($s$h.stars,h.requires_approval,h.active,false);$s$,$s$h.stars,h.requires_approval,h.active,false,h.category);$s$),
($s$h.stars:=hv.stars; h.requires_approval:=hv.requires_approval;$s$,$s$h.stars:=hv.stars; h.requires_approval:=hv.requires_approval; h.category:=hv.category;$s$),
($s$select * into previous from private.mutation_requests where family_id=f and request_id=p_request_id;$s$,$s$if p_action in ('habit_save','habit_delete') and not is_parent then raise exception 'parent_required'; end if;
 select * into previous from private.mutation_requests where family_id=f and request_id=p_request_id;$s$)
 ) AS replacements(a,b) LOOP
  IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'habit_category_source_mismatch' USING DETAIL=needle; END IF;
  body:=replace(body,needle,replacement);
 END LOOP;
 EXECUTE body;
END $migration$;

-- Atomic, parent-only multi-child habit editing. Original habits and history stay intact.
CREATE OR REPLACE FUNCTION public.family_habit_batch(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text)
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
 IF p_action NOT IN ('habit_batch_save','habit_batch_active','habit_batch_patch','habit_batch_apply') OR p_request_id IS NULL
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF octet_length(p_payload::text)>16000 THEN RAISE EXCEPTION 'payload_too_large'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.action<>p_action OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 IF p_action='habit_batch_apply' THEN
  IF jsonb_typeof(p_payload->'targets') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'additions') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'patch') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF jsonb_array_length(p_payload->'targets')+jsonb_array_length(p_payload->'additions') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF jsonb_array_length(p_payload->'targets')>0 AND p_payload->'patch'<>'{}'::jsonb THEN
   PERFORM public.family_habit_batch('habit_batch_patch',jsonb_build_object('targets',p_payload->'targets','patch',p_payload->'patch'),md5('apply-patch:'||p_request_id::text)::uuid,p_parent_token);
  END IF;
  IF jsonb_array_length(p_payload->'additions')>0 THEN
   PERFORM public.family_habit_batch('habit_batch_save',jsonb_build_object('targets',p_payload->'additions','rule',p_payload->'rule'),md5('apply-add:'||p_request_id::text)::uuid,p_parent_token);
  ELSIF p_payload->'patch'='{}'::jsonb THEN RAISE EXCEPTION 'invalid_request'; END IF;
  INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,hash);
  RETURN public.get_dashboard();
 END IF;
 IF jsonb_typeof(p_payload->'targets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF jsonb_array_length(p_payload->'targets') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 rule:=p_payload->'rule';
 IF p_action='habit_batch_save' AND rule?'category' AND (jsonb_typeof(rule->'category') IS DISTINCT FROM 'string' OR rule->>'category' NOT IN ('routine','occasional')) THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF p_action='habit_batch_patch' AND (p_payload->'patch')?'category' AND (p_payload->'patch'->>'category' IS NULL OR p_payload->'patch'->>'category' NOT IN ('routine','occasional')) THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF p_action='habit_batch_save' THEN
  IF jsonb_typeof(rule) IS DISTINCT FROM 'object'
   OR jsonb_typeof(rule->'name') IS DISTINCT FROM 'string'
   OR jsonb_typeof(rule->'icon') IS DISTINCT FROM 'string'
   OR jsonb_typeof(rule->'color') IS DISTINCT FROM 'string'
   OR jsonb_typeof(rule->'weekdays') IS DISTINCT FROM 'array'
   OR jsonb_typeof(rule->'target_count') IS DISTINCT FROM 'number'
   OR jsonb_typeof(rule->'target_minutes') IS DISTINCT FROM 'number'
   OR jsonb_typeof(rule->'stars') IS DISTINCT FROM 'number'
   OR jsonb_typeof(rule->'requires_approval') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(rule->'active') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'invalid_request'; END IF;
  -- Reject empty/duplicated weekdays rather than silently persisting a malformed rule.
  IF jsonb_array_length(rule->'weekdays') NOT BETWEEN 1 AND 7 OR
   (SELECT count(DISTINCT value) FROM jsonb_array_elements(rule->'weekdays'))<>jsonb_array_length(rule->'weekdays')
  THEN RAISE EXCEPTION 'invalid_request'; END IF;
 ELSIF p_action='habit_batch_patch' THEN
  IF jsonb_typeof(p_payload->'patch') IS DISTINCT FROM 'object' OR p_payload->'patch'='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'patch') k WHERE k NOT IN ('name','icon','color','weekdays','target_count','target_minutes','stars','requires_approval','active','category')) THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_payload->'patch') kv WHERE jsonb_typeof(kv.value) IS DISTINCT FROM CASE WHEN kv.key IN ('name','icon','color','category') THEN 'string' WHEN kv.key='weekdays' THEN 'array' WHEN kv.key IN ('active','requires_approval') THEN 'boolean' ELSE 'number' END) THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF (p_payload->'patch') ? 'weekdays' AND (jsonb_array_length(p_payload->'patch'->'weekdays') NOT BETWEEN 1 AND 7 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_payload->'patch'->'weekdays'))<>jsonb_array_length(p_payload->'patch'->'weekdays')) THEN RAISE EXCEPTION 'invalid_request'; END IF;
 ELSIF jsonb_typeof(p_payload->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_request';
 END IF;
 -- Validate the complete selection first under the same family lock. No partial saves.
 FOR t IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
  IF jsonb_typeof(t) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
  child:=(t->>'child_id')::uuid; hid:=nullif(t->>'id','')::uuid;
  IF child IS NULL OR NOT EXISTS(SELECT 1 FROM public.children WHERE id=child AND family_id=f)
   THEN RAISE EXCEPTION 'child_not_found'; END IF;
  target_key:=CASE WHEN p_action='habit_batch_save' THEN child::text ELSE hid::text END;
  IF target_key IS NULL OR target_key=ANY(seen) THEN RAISE EXCEPTION 'invalid_request'; END IF;
  seen:=array_append(seen,target_key);
  IF hid IS NOT NULL THEN
   SELECT * INTO h FROM public.habits WHERE id=hid AND family_id=f AND child_id=child AND archived_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'habit_not_found'; END IF;
   IF jsonb_typeof(t->'expected') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_request'; END IF;
   BEGIN expected:=(t->>'expected')::jsonb; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request'; END;
   fingerprint:=jsonb_build_array(h.name,h.icon,h.color,
    (SELECT jsonb_agg(v ORDER BY v) FROM unnest(h.weekdays) v),h.target_count,h.target_minutes,h.stars,h.requires_approval,h.active,h.category);
   IF expected IS DISTINCT FROM fingerprint AND NOT (h.category='routine' AND expected IS NOT DISTINCT FROM (fingerprint-9)) THEN RAISE EXCEPTION 'habit_changed_refresh'; END IF;
  ELSIF p_action IN ('habit_batch_active','habit_batch_patch') THEN RAISE EXCEPTION 'invalid_request';
  END IF;
 END LOOP;
 FOR t IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
  child:=(t->>'child_id')::uuid; hid:=nullif(t->>'id','')::uuid;
  IF p_action='habit_batch_save' THEN
   save_payload:=jsonb_build_object('child_id',child,'name',rule->'name','icon',rule->'icon','color',rule->'color',
    'weekdays',rule->'weekdays','target_count',rule->'target_count','target_minutes',rule->'target_minutes',
    'stars',rule->'stars','requires_approval',rule->'requires_approval','active',rule->'active');
   IF rule?'category' THEN save_payload:=save_payload||jsonb_build_object('category',rule->'category'); END IF;
  ELSIF p_action='habit_batch_patch' THEN save_payload:=jsonb_build_object('child_id',child)||(p_payload->'patch');
  ELSE save_payload:=jsonb_build_object('child_id',child,'active',p_payload->'active');
  END IF;
  IF hid IS NOT NULL THEN save_payload:=save_payload||jsonb_build_object('id',hid); END IF;
  sub_id:=md5('habit-batch:'||p_request_id::text||':'||child::text||':'||coalesce(hid::text,'new'))::uuid;
  PERFORM public.family_mutate('habit_save',save_payload,sub_id,p_parent_token);
 END LOOP;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,hash);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.family_habit_batch(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_habit_batch(text,jsonb,uuid,text) TO authenticated;

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
    (SELECT jsonb_agg(v ORDER BY v) FROM unnest(h.weekdays) v),h.target_count,h.target_minutes,h.stars,h.requires_approval,h.active,h.category);
   IF expected IS DISTINCT FROM fingerprint AND NOT (h.category='routine' AND expected IS NOT DISTINCT FROM (fingerprint-9)) THEN RAISE EXCEPTION 'habit_changed_refresh'; END IF;
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

-- Check parent on every direct habit call before any legacy wrapper replay.
DO $guard$
DECLARE body text; needle text := 'PERFORM 1 FROM public.families WHERE id=f FOR UPDATE;';
BEGIN
 body:=pg_get_functiondef('public.family_mutate(text,jsonb,uuid,text)'::regprocedure);
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'habit_category_wrapper_mismatch'; END IF;
 body:=replace(body,needle,needle || E'\n IF f IS NOT NULL AND p_action IN (''habit_save'',''habit_delete'') AND NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION ''parent_required''; END IF;');
 EXECUTE body;
END $guard$;
