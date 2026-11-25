-- Additive star agreements. Existing balances, rewards and migration checksums are untouched.
CREATE TABLE public.star_rule_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE, child_id uuid NOT NULL,
 epoch_id uuid NOT NULL, timezone text NOT NULL, effective_day date NOT NULL, effective_week date NOT NULL,
 deduction_limit integer NOT NULL DEFAULT 3 CHECK(deduction_limit BETWEEN 1 AND 10),
 streak_enabled boolean NOT NULL DEFAULT false, savings_enabled boolean NOT NULL DEFAULT false,
 habit_ids uuid[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id), CHECK(cardinality(habit_ids)<=30)
);
CREATE TABLE public.star_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 child_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('deduction','streak','savings','reversal')),
 amount integer NOT NULL CHECK(amount<>0 AND abs(amount)<=10), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 300),
 rule_id uuid REFERENCES public.star_rule_versions, related_id uuid UNIQUE REFERENCES public.star_adjustments,
 period_day date NOT NULL, timezone text NOT NULL, habit_id uuid, detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id),
 CHECK((kind='deduction' AND amount<0) OR (kind IN ('streak','savings') AND amount>0) OR kind='reversal'),
 CHECK((kind='reversal')=(related_id IS NOT NULL))
);
CREATE UNIQUE INDEX star_streak_once ON public.star_adjustments(child_id,habit_id,period_day) WHERE kind='streak';
CREATE UNIQUE INDEX star_savings_once ON public.star_adjustments(child_id,period_day) WHERE kind='savings';
CREATE INDEX star_adjustments_family ON public.star_adjustments(family_id,created_at);
ALTER TABLE public.star_ledger DROP CONSTRAINT star_ledger_source_type_check;
ALTER TABLE public.star_ledger ADD CONSTRAINT star_ledger_source_type_check CHECK(source_type IN ('checkin','undo','redemption','refund','manual_bonus','star_adjustment'));
CREATE TABLE private.star_balance_samples (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 child_id uuid NOT NULL REFERENCES public.children ON DELETE CASCADE, balance bigint NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX star_balance_at ON private.star_balance_samples(child_id,observed_at,seq);
INSERT INTO private.star_balance_samples(family_id,child_id,balance)
 SELECT c.family_id,c.id,coalesce(sum(l.amount),0) FROM public.children c LEFT JOIN public.star_ledger l ON l.child_id=c.id GROUP BY c.id;
CREATE FUNCTION private.record_star_balance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Every supported writer already holds this lock; also serialize future ledger writers.
 PERFORM 1 FROM public.families WHERE id=new.family_id FOR UPDATE;
 INSERT INTO private.star_balance_samples(family_id,child_id,balance)
 SELECT new.family_id,new.child_id,coalesce(sum(amount),0) FROM public.star_ledger WHERE child_id=new.child_id;
 RETURN new;
END $$;
CREATE TRIGGER star_balance_sample AFTER INSERT ON public.star_ledger FOR EACH ROW EXECUTE FUNCTION private.record_star_balance();

-- Snapshot lifecycle changes at their real server time, not at user-supplied backfill dates.
-- This allows a restarted worker to reconstruct the prior midnight without late reviews,
-- late backfills, deleted rests, or later habit edits changing the outcome.
CREATE TABLE private.star_source_events (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE, entity text NOT NULL, object_id uuid NOT NULL,
 record jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false, observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX star_source_at ON private.star_source_events(family_id,entity,object_id,observed_at,seq);
CREATE INDEX star_source_day ON private.star_source_events(family_id,entity,((record->>'day')),observed_at);
INSERT INTO private.star_source_events(family_id,entity,object_id,record)
 SELECT family_id,'checkins',id,to_jsonb(c) FROM public.checkins c
 UNION ALL SELECT family_id,'rests',id,to_jsonb(r) FROM public.rests r
 UNION ALL SELECT family_id,'habit_versions',id,to_jsonb(h) FROM public.habit_versions h;
CREATE FUNCTION private.record_star_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(old) ELSE to_jsonb(new) END;
 INSERT INTO private.star_source_events(family_id,entity,object_id,record,deleted)
 VALUES((r->>'family_id')::uuid,TG_TABLE_NAME,(r->>'id')::uuid,r,TG_OP='DELETE');
 RETURN CASE WHEN TG_OP='DELETE' THEN old ELSE new END;
END $$;
CREATE TRIGGER star_checkin_event AFTER INSERT OR UPDATE OR DELETE ON public.checkins FOR EACH ROW EXECUTE FUNCTION private.record_star_source();
CREATE TRIGGER star_rest_event AFTER INSERT OR UPDATE OR DELETE ON public.rests FOR EACH ROW EXECUTE FUNCTION private.record_star_source();
CREATE TRIGGER star_habit_event AFTER INSERT OR UPDATE OR DELETE ON public.habit_versions FOR EACH ROW EXECUTE FUNCTION private.record_star_source();

CREATE TABLE private.star_settlement_cursor (
 id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES public.children ON DELETE CASCADE,
 family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 timezone text NOT NULL, last_day date NOT NULL,last_week date NOT NULL, end_day date,end_week date
);
CREATE UNIQUE INDEX star_one_active_epoch ON private.star_settlement_cursor(child_id) WHERE end_day IS NULL;
CREATE TABLE private.star_streak_state (
 epoch_id uuid NOT NULL REFERENCES private.star_settlement_cursor(id) ON DELETE CASCADE,
 child_id uuid NOT NULL REFERENCES public.children ON DELETE CASCADE,
 habit_id uuid NOT NULL REFERENCES public.habits ON DELETE CASCADE, consecutive integer NOT NULL DEFAULT 0,
 PRIMARY KEY(epoch_id,child_id,habit_id)
);
CREATE TABLE public.star_settlements (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,child_id uuid NOT NULL REFERENCES public.children ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('day','week')),period_day date NOT NULL,rule_id uuid REFERENCES public.star_rule_versions,
 detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(child_id,kind,period_day)
);
CREATE TABLE private.star_settler_health(singleton boolean PRIMARY KEY CHECK(singleton),last_success_at timestamptz);
INSERT INTO private.star_settler_health VALUES(true,NULL);

CREATE FUNCTION private.star_sources_at(f uuid,entity_name text,cutoff timestamptz,p_day date DEFAULT NULL) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT record FROM (SELECT DISTINCT ON(object_id) record,deleted FROM private.star_source_events
 WHERE family_id=f AND entity=entity_name AND observed_at<cutoff AND (p_day IS NULL OR record->>'day'=p_day::text) ORDER BY object_id,observed_at DESC,seq DESC) s WHERE NOT deleted
$$;
CREATE FUNCTION private.star_post(f uuid,c uuid,k text,a integer,why text,r uuid,d date,tz text,h uuid DEFAULT NULL,extra jsonb DEFAULT '{}') RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE obj uuid; actor uuid;
BEGIN
 INSERT INTO public.star_adjustments(family_id,child_id,kind,amount,reason,rule_id,period_day,timezone,habit_id,detail)
 VALUES(f,c,k,a,why,r,d,tz,h,extra) RETURNING id INTO obj;
 INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES(f,c,a,'star_adjustment',obj);
 SELECT owner_id INTO actor FROM public.families WHERE id=f;
 INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,actor,'star_'||k,obj);
 RETURN obj;
END $$;

CREATE FUNCTION private.settle_star_family(f uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cur private.star_settlement_cursor%rowtype; rule public.star_rule_versions%rowtype;
 d date; w date; today date; cutoff timestamptz; starts timestamptz; hid uuid; h jsonb; n integer; qualified integer; award integer; used integer;
 low bigint; opening bigint; count_days integer; count_weeks integer; processed integer:=0; details jsonb; state_details jsonb; habits_snapshot jsonb; rests_snapshot jsonb; checkins_snapshot jsonb;
BEGIN
 -- Caller holds the family lock. Bounded catch-up with durable cursors; never discard a day.
 FOR cur IN SELECT * FROM private.star_settlement_cursor c WHERE family_id=f AND
   (last_day<least((clock_timestamp() AT TIME ZONE timezone)::date,coalesce(end_day,'infinity'::date))-1
    OR last_week+14<=least((clock_timestamp() AT TIME ZONE timezone)::date,coalesce(end_week,'infinity'::date)))
   ORDER BY last_day,id LIMIT 1 LOOP
  today:=(clock_timestamp() AT TIME ZONE cur.timezone)::date;
  d:=cur.last_day+1; count_days:=0;
  WHILE d<least(today,coalesce(cur.end_day,today)) AND count_days<7 LOOP
   SELECT * INTO rule FROM public.star_rule_versions WHERE epoch_id=cur.id AND child_id=cur.child_id AND effective_day<=d ORDER BY revision DESC LIMIT 1;
   cutoff:=((d+1)::timestamp AT TIME ZONE cur.timezone); state_details:='[]';
   IF rule.id IS NOT NULL AND rule.streak_enabled THEN
    SELECT coalesce(jsonb_agg(x),'[]') INTO habits_snapshot FROM private.star_sources_at(f,'habit_versions',cutoff) x;
    SELECT coalesce(jsonb_agg(x),'[]') INTO rests_snapshot FROM private.star_sources_at(f,'rests',cutoff,d) x;
    SELECT coalesce(jsonb_agg(x),'[]') INTO checkins_snapshot FROM private.star_sources_at(f,'checkins',cutoff,d) x;
    UPDATE private.star_streak_state SET consecutive=0 WHERE epoch_id=cur.id AND child_id=cur.child_id AND NOT(habit_id=ANY(rule.habit_ids));
    FOREACH hid IN ARRAY rule.habit_ids LOOP
     SELECT x INTO h FROM jsonb_array_elements(habits_snapshot) x
      WHERE (x->>'habit_id')::uuid=hid AND (x->>'effective_day')::date<=d ORDER BY (x->>'effective_day')::date DESC LIMIT 1;
     INSERT INTO private.star_streak_state(epoch_id,child_id,habit_id) VALUES(cur.id,cur.child_id,hid) ON CONFLICT DO NOTHING;
     IF h IS NULL OR NOT (h->>'active')::boolean OR (h->>'archived')::boolean THEN
      UPDATE private.star_streak_state SET consecutive=0 WHERE epoch_id=cur.id AND child_id=cur.child_id AND habit_id=hid;
      CONTINUE;
     END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(rests_snapshot) x WHERE (x->>'child_id')::uuid=cur.child_id AND (x->>'day')::date=d)
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(h->'weekdays') wd WHERE wd::integer=extract(isodow FROM d)::integer) THEN CONTINUE; END IF;
     SELECT count(*) INTO qualified FROM jsonb_array_elements(checkins_snapshot) x
      WHERE (x->>'habit_id')::uuid=hid AND (x->>'day')::date=d AND x->>'status'='approved';
     UPDATE private.star_streak_state SET consecutive=CASE WHEN qualified>=(h->>'target_count')::integer THEN consecutive+1 ELSE 0 END
      WHERE epoch_id=cur.id AND child_id=cur.child_id AND habit_id=hid RETURNING consecutive INTO n;
     award:=CASE WHEN n=3 THEN 1 WHEN n>=7 AND n%7=0 THEN 2 ELSE 0 END;
     w:=d-(extract(isodow FROM d)::integer-1);
     SELECT coalesce(sum(amount),0) INTO used FROM public.star_adjustments WHERE child_id=cur.child_id AND kind='streak' AND period_day>=w AND period_day<w+7;
     award:=least(award,greatest(0,3-used));
     IF award>0 THEN PERFORM private.star_post(f,cur.child_id,'streak',award,'连续完成约定奖励',rule.id,d,cur.timezone,hid,jsonb_build_object('consecutive',n,'habit_name',h->>'name')); END IF;
     state_details:=state_details||jsonb_build_array(jsonb_build_object('habit_id',hid,'consecutive',n,'approved',qualified,'target_count',h->'target_count','award',award));
    END LOOP;
   ELSE
    UPDATE private.star_streak_state SET consecutive=0 WHERE epoch_id=cur.id AND child_id=cur.child_id;
   END IF;
   INSERT INTO public.star_settlements(family_id,child_id,kind,period_day,rule_id,detail)
    VALUES(f,cur.child_id,'day',d,rule.id,jsonb_build_object('habits',state_details,'enabled',coalesce(rule.streak_enabled,false)));
   UPDATE private.star_settlement_cursor SET last_day=d WHERE id=cur.id;
   d:=d+1;count_days:=count_days+1;processed:=processed+1;
  END LOOP;
  w:=cur.last_week+7; count_weeks:=0;
  WHILE w+7<=least(today,coalesce(cur.end_week,today)) AND count_weeks<1 LOOP
   SELECT * INTO rule FROM public.star_rule_versions WHERE epoch_id=cur.id AND child_id=cur.child_id AND effective_week<=w ORDER BY revision DESC LIMIT 1;
   starts:=(w::timestamp AT TIME ZONE cur.timezone);cutoff:=((w+7)::timestamp AT TIME ZONE cur.timezone);
   opening:=NULL;low:=NULL;award:=0;
   IF rule.id IS NOT NULL AND rule.savings_enabled THEN
    SELECT balance INTO opening FROM private.star_balance_samples WHERE child_id=cur.child_id AND observed_at<=starts ORDER BY observed_at DESC,seq DESC LIMIT 1;
    -- A missing baseline is ineligible, never inferred from the balance at settlement time.
    IF opening IS NOT NULL THEN
     SELECT least(opening,coalesce(min(balance),opening)) INTO low FROM private.star_balance_samples WHERE child_id=cur.child_id AND observed_at>starts AND observed_at<cutoff;
     award:=CASE WHEN low>=100 THEN 3 WHEN low>=50 THEN 2 WHEN low>=20 THEN 1 ELSE 0 END;
    END IF;
    IF award>0 THEN PERFORM private.star_post(f,cur.child_id,'savings',award,'整周存星奖励',rule.id,w,cur.timezone,NULL,jsonb_build_object('opening',opening,'minimum',low)); END IF;
   END IF;
   INSERT INTO public.star_settlements(family_id,child_id,kind,period_day,rule_id,detail)
    VALUES(f,cur.child_id,'week',w,rule.id,jsonb_build_object('enabled',coalesce(rule.savings_enabled,false),'opening',opening,'minimum',low,'award',award));
   UPDATE private.star_settlement_cursor SET last_week=w WHERE id=cur.id;
   w:=w+7;count_weeks:=count_weeks+1;processed:=processed+1;
  END LOOP;
 END LOOP;
 RETURN processed;
END $$;
CREATE FUNCTION public.settle_due_star_rules() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;n integer:=0;
BEGIN
 FOR f IN SELECT x.id FROM public.families x WHERE EXISTS(SELECT 1 FROM private.star_settlement_cursor c WHERE c.family_id=x.id AND
 (c.last_day<least((clock_timestamp() AT TIME ZONE c.timezone)::date,coalesce(c.end_day,'infinity'::date))-1
 OR c.last_week+14<=least((clock_timestamp() AT TIME ZONE c.timezone)::date,coalesce(c.end_week,'infinity'::date))))
 ORDER BY (SELECT min(c.last_day) FROM private.star_settlement_cursor c WHERE c.family_id=x.id),x.id LIMIT 1 FOR UPDATE OF x SKIP LOCKED LOOP
  n:=n+private.settle_star_family(f);
 END LOOP;
 UPDATE private.star_settler_health SET last_success_at=clock_timestamp() WHERE singleton;
 RETURN n;
END $$;

CREATE TABLE public.star_rule_transitions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 child_id uuid NOT NULL REFERENCES public.children ON DELETE CASCADE,old_epoch uuid NOT NULL,new_epoch uuid NOT NULL,
 old_timezone text NOT NULL,new_timezone text NOT NULL,old_day_end date NOT NULL,old_week_end date NOT NULL,
 new_day_start date NOT NULL,new_week_start date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION private.move_star_timezone(f uuid,new_tz text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cur private.star_settlement_cursor%rowtype;r public.star_rule_versions%rowtype;
 old_today date;old_week date;new_today date;start_day date;start_week date;epoch uuid;obj uuid;actor uuid;
BEGIN
 SELECT owner_id INTO actor FROM public.families WHERE id=f;
 FOR cur IN SELECT * FROM private.star_settlement_cursor WHERE family_id=f AND end_day IS NULL ORDER BY child_id LOOP
  IF cur.timezone=new_tz THEN CONTINUE;END IF;
  SELECT * INTO r FROM public.star_rule_versions WHERE epoch_id=cur.id ORDER BY revision DESC LIMIT 1;
  old_today:=(clock_timestamp() AT TIME ZONE cur.timezone)::date;
  old_week:=old_today-(extract(isodow FROM old_today)::integer-1);
  new_today:=(clock_timestamp() AT TIME ZONE new_tz)::date;
  UPDATE private.star_settlement_cursor SET end_day=old_today,end_week=old_week WHERE id=cur.id;
  -- Old completed periods retain their epoch and are drained later. Never replay a
  -- calendar date/week already eligible in any old epoch when travelling west.
  SELECT greatest(new_today+1,coalesce(max(end_day)+1,new_today+1)) INTO start_day
   FROM private.star_settlement_cursor WHERE child_id=cur.child_id;
  SELECT greatest(new_today+(8-extract(isodow FROM new_today)::integer),coalesce(max(end_week)+7,new_today)) INTO start_week
   FROM private.star_settlement_cursor WHERE child_id=cur.child_id;
  epoch:=gen_random_uuid();
  INSERT INTO private.star_settlement_cursor(id,child_id,family_id,timezone,last_day,last_week)
   VALUES(epoch,cur.child_id,f,new_tz,start_day-1,start_week-7);
  INSERT INTO public.star_rule_versions(family_id,child_id,epoch_id,timezone,effective_day,effective_week,deduction_limit,streak_enabled,savings_enabled,habit_ids)
   VALUES(f,cur.child_id,epoch,new_tz,start_day,start_week,r.deduction_limit,r.streak_enabled,r.savings_enabled,r.habit_ids);
  INSERT INTO public.star_rule_transitions(family_id,child_id,old_epoch,new_epoch,old_timezone,new_timezone,old_day_end,old_week_end,new_day_start,new_week_start)
   VALUES(f,cur.child_id,cur.id,epoch,cur.timezone,new_tz,old_today,old_week,start_day,start_week) RETURNING id INTO obj;
  INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,actor,'star_timezone_transition',obj);
 END LOOP;
END $$;

-- Retain the previous functions verbatim, but remove direct access to bypass wrappers.
ALTER FUNCTION public.get_dashboard() RENAME TO get_dashboard_before_star_rules;
ALTER FUNCTION public.get_dashboard_before_star_rules() SET SCHEMA private;
CREATE FUNCTION public.get_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 f:=private.owned_family();result:=private.get_dashboard_before_star_rules();
 RETURN result||jsonb_build_object(
 'star_rule_transitions',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY created_at DESC,id) FROM public.star_rule_transitions t WHERE family_id=f),'[]'),
 'star_rule_versions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY revision DESC) FROM public.star_rule_versions r WHERE family_id=f),'[]'),
 'star_adjustments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at DESC,id) FROM public.star_adjustments a WHERE family_id=f),'[]'),
 'star_settlements',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY id DESC) FROM (SELECT * FROM public.star_settlements WHERE family_id=f ORDER BY id DESC LIMIT 120)s),'[]'),
 'star_settler_last_success_at',(SELECT last_success_at FROM private.star_settler_health WHERE singleton));
END $$;
ALTER FUNCTION public.family_mutate(text,jsonb,uuid,text) RENAME TO family_mutate_before_star_rules;
ALTER FUNCTION public.family_mutate_before_star_rules(text,jsonb,uuid,text) SET SCHEMA private;
CREATE FUNCTION public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fam public.families%rowtype; f uuid;c uuid;obj uuid;today date;tz text;day_start timestamptz;
 hash text; previous private.mutation_requests%rowtype; rule public.star_rule_versions%rowtype; original public.star_adjustments%rowtype;
 amount integer;used integer;cap integer;bal bigint;ids uuid[];why text;h uuid;epoch uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF octet_length(p_payload::text)>12000 THEN RAISE EXCEPTION 'payload_too_large'; END IF;
 SELECT * INTO fam FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 f:=fam.id;IF f IS NULL THEN RAISE EXCEPTION 'family_not_found';END IF;
 IF p_action='undo_checkin' THEN
  -- Existing parent-authorized undo must not overdraw a wallet after adjustments.
  IF EXISTS(SELECT 1 FROM public.checkins ci WHERE ci.id=nullif(p_payload->>'id','')::uuid AND ci.family_id=f AND ci.status='approved'
   AND ci.stars>(SELECT coalesce(sum(l.amount),0) FROM public.star_ledger l WHERE l.child_id=ci.child_id)
   AND NOT EXISTS(SELECT 1 FROM private.mutation_requests mr WHERE mr.family_id=f AND mr.request_id=p_request_id)) THEN
   RAISE EXCEPTION 'insufficient_stars';
  END IF;
 END IF;
 IF p_action='family_save' AND p_payload?'timezone' AND p_payload->>'timezone'<>fam.timezone
  AND NOT EXISTS(SELECT 1 FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id) THEN
  IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
  IF EXISTS(SELECT 1 FROM public.star_rule_versions WHERE family_id=f) AND p_payload->'confirm_star_timezone' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'star_timezone_confirmation_required';END IF;
  PERFORM private.family_mutate_before_star_rules(p_action,p_payload,p_request_id,p_parent_token);
  PERFORM private.move_star_timezone(f,p_payload->>'timezone');
  RETURN public.get_dashboard();
 END IF;
 IF p_action NOT IN ('star_rules_save','star_deduct','star_reverse') THEN
  RETURN private.family_mutate_before_star_rules(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 IF NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 hash:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO previous FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.action<>p_action OR previous.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
  RETURN public.get_dashboard();
 END IF;
 c:=nullif(p_payload->>'child_id','')::uuid;
 IF p_action='star_reverse' THEN
  SELECT * INTO original FROM public.star_adjustments WHERE id=(p_payload->>'id')::uuid AND family_id=f;
  IF original.id IS NULL OR original.kind='reversal' THEN RAISE EXCEPTION 'star_adjustment_not_found';END IF;
  c:=original.child_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found';END IF;
 SELECT * INTO rule FROM public.star_rule_versions WHERE child_id=c ORDER BY revision DESC LIMIT 1;
 tz:=coalesce(rule.timezone,fam.timezone);today:=(clock_timestamp() AT TIME ZONE tz)::date;
 CASE p_action
 WHEN 'star_rules_save' THEN
  IF jsonb_typeof(p_payload->'deduction_limit') IS DISTINCT FROM 'number' OR (p_payload->>'deduction_limit')::numeric<>trunc((p_payload->>'deduction_limit')::numeric)
   OR (p_payload->>'deduction_limit')::numeric NOT BETWEEN 1 AND 10
   OR jsonb_typeof(p_payload->'streak_enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_payload->'savings_enabled') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(p_payload->'habit_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_star_rules';END IF;
  SELECT coalesce(array_agg(DISTINCT value::uuid ORDER BY value::uuid),'{}') INTO ids FROM jsonb_array_elements_text(p_payload->'habit_ids');
  IF cardinality(ids)>30 OR ((p_payload->>'streak_enabled')::boolean AND cardinality(ids)=0) THEN RAISE EXCEPTION 'invalid_star_rules';END IF;
  FOREACH h IN ARRAY ids LOOP
   IF NOT EXISTS(SELECT 1 FROM public.habits WHERE id=h AND child_id=c AND family_id=f AND active AND archived_at IS NULL) THEN RAISE EXCEPTION 'habit_not_active';END IF;
  END LOOP;
  epoch:=coalesce(rule.epoch_id,gen_random_uuid());
  INSERT INTO public.star_rule_versions(family_id,child_id,epoch_id,timezone,effective_day,effective_week,deduction_limit,streak_enabled,savings_enabled,habit_ids)
   VALUES(f,c,epoch,tz,greatest(today+1,coalesce((SELECT last_day+1 FROM private.star_settlement_cursor WHERE id=epoch AND last_day>=today),today+1)),greatest(today+(8-extract(isodow FROM today)::integer),coalesce((SELECT last_week+7 FROM private.star_settlement_cursor WHERE id=epoch AND last_week>=today),today)),(p_payload->>'deduction_limit')::integer,
    (p_payload->>'streak_enabled')::boolean,(p_payload->>'savings_enabled')::boolean,ids) RETURNING id INTO obj;
  INSERT INTO private.star_settlement_cursor(id,child_id,family_id,timezone,last_day,last_week)
   VALUES(epoch,c,f,tz,today,today+(1-extract(isodow FROM today)::integer)) ON CONFLICT DO NOTHING;
  -- No record/balance is changed by enabling a rule. Baseline protects newly-created zero wallets.
  IF NOT EXISTS(SELECT 1 FROM private.star_balance_samples WHERE child_id=c) THEN
   INSERT INTO private.star_balance_samples(family_id,child_id,balance) SELECT f,c,coalesce(sum(l.amount),0) FROM public.star_ledger l WHERE child_id=c;
  END IF;
 WHEN 'star_deduct' THEN
  IF jsonb_typeof(p_payload->'amount') IS DISTINCT FROM 'number' OR (p_payload->>'amount')::numeric<>trunc((p_payload->>'amount')::numeric)
   OR (p_payload->>'amount')::numeric NOT BETWEEN 1 AND 10 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
   OR length(trim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 300 OR p_payload->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'invalid_star_adjustment';END IF;
  amount:=(p_payload->>'amount')::integer;why:=trim(p_payload->>'reason');cap:=coalesce(rule.deduction_limit,3);
  -- Count gross deductions, including reversed ones. A rolling 24h ceiling also prevents time-zone/day hopping.
  day_start:=today::timestamp AT TIME ZONE tz;
  SELECT coalesce(sum(-a.amount),0) INTO used FROM public.star_adjustments a WHERE child_id=c AND kind='deduction'
    AND (created_at>=day_start OR created_at>clock_timestamp()-interval '24 hours');
  IF used+amount>cap THEN RAISE EXCEPTION 'star_daily_limit';END IF;
  SELECT coalesce(sum(l.amount),0) INTO bal FROM public.star_ledger l WHERE child_id=c;
  IF bal<amount THEN RAISE EXCEPTION 'insufficient_stars';END IF;
  obj:=private.star_post(f,c,'deduction',-amount,why,rule.id,today,tz);
 WHEN 'star_reverse' THEN
  IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(trim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 300
   OR p_payload->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'invalid_star_adjustment';END IF;
  IF EXISTS(SELECT 1 FROM public.star_adjustments WHERE related_id=original.id) THEN RAISE EXCEPTION 'star_already_reversed';END IF;
  SELECT coalesce(sum(l.amount),0) INTO bal FROM public.star_ledger l WHERE child_id=c;
  IF bal-original.amount<0 THEN RAISE EXCEPTION 'insufficient_stars';END IF;
  INSERT INTO public.star_adjustments(family_id,child_id,kind,amount,reason,related_id,rule_id,period_day,timezone)
   VALUES(f,c,'reversal',-original.amount,trim(p_payload->>'reason'),original.id,original.rule_id,today,tz) RETURNING id INTO obj;
  INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES(f,c,-original.amount,'star_adjustment',obj);
 END CASE;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,hash);
 -- star_post already records deductions and automatic rewards. Other parent actions audit here.
 IF p_action<>'star_deduct' THEN INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,obj); END IF;
 RETURN public.get_dashboard();
END $$;

DO $$ DECLARE t text;fn record;BEGIN
 FOREACH t IN ARRAY ARRAY['star_rule_versions','star_adjustments','star_settlements','star_rule_transitions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY family_read ON public.%I FOR SELECT TO authenticated USING(family_id=public.current_family_id())',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,growth_app',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['star_balance_samples','star_source_events','star_settlement_cursor','star_streak_state','star_settler_health'] LOOP
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,growth_app',t);
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND (p.proname LIKE '%star%' OR p.proname='record_star_source') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,growth_app',fn.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_dashboard(),public.family_mutate(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.get_dashboard(),public.family_mutate(text,jsonb,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_due_star_rules() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_due_star_rules() TO growth_app;

