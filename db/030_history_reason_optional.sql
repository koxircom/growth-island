-- Optional description; retains CAS, family/parent checks and atomic ledger behavior.
ALTER TABLE public.history_proposals DROP CONSTRAINT history_proposals_reason_check;
ALTER TABLE public.history_proposals ADD CONSTRAINT history_proposals_reason_check CHECK(length(reason)<=300);
ALTER TABLE public.history_proposals ALTER COLUMN reason SET DEFAULT '';
CREATE OR REPLACE FUNCTION public.history_proposal_mutate(a text,p jsonb,r uuid,parent_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;tz text;today date;d date;h public.habits%rowtype;v public.habit_versions%rowtype;q public.history_proposals%rowtype;
 prior private.mutation_requests%rowtype;hash text;desired integer;note text;t jsonb;ci public.checkins%rowtype;n integer;amount integer;cid uuid;seen uuid[]:='{}';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required';END IF;
 SELECT id,timezone INTO f,tz FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found';END IF;
 IF a NOT IN ('history_submit','history_withdraw','history_review') OR r IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_request';END IF;
 IF octet_length(p::text)>16000 THEN RAISE EXCEPTION 'payload_too_large';END IF;
 IF a='history_review' AND NOT private.parent_valid(f,parent_token) THEN RAISE EXCEPTION 'parent_required';END IF;
 hash:=encode(extensions.digest(p::text,'sha256'),'hex');SELECT * INTO prior FROM private.mutation_requests WHERE family_id=f AND request_id=r;
 IF FOUND THEN IF prior.action<>a OR prior.payload_hash<>hash THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN public.get_dashboard();END IF;
 today:=(clock_timestamp() AT TIME ZONE tz)::date;
 IF a='history_submit' THEN
  d:=(p->>'day')::date;desired:=(p->>'desired_count')::integer;note:=trim(coalesce(p->>'reason',''));
  IF d IS NULL OR d>=today OR d<today-366 OR desired IS NULL OR desired<0 OR desired>20 OR length(note)>300 THEN RAISE EXCEPTION 'invalid_request';END IF;
  SELECT * INTO h FROM public.habits WHERE id=(p->>'habit_id')::uuid AND family_id=f AND child_id=(p->>'child_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'habit_not_found';END IF;
  SELECT * INTO v FROM public.habit_versions WHERE habit_id=h.id AND effective_day<=d ORDER BY effective_day DESC LIMIT 1;
  IF NOT FOUND OR v.archived OR NOT v.active THEN RAISE EXCEPTION 'habit_not_active_on_date';END IF;
  IF desired>v.target_count OR NOT(extract(isodow from d)::integer=ANY(v.weekdays)) THEN RAISE EXCEPTION 'invalid_request';END IF;
  IF EXISTS(SELECT 1 FROM public.rests WHERE child_id=h.child_id AND day=d) THEN RAISE EXCEPTION 'rest_day';END IF;
  IF EXISTS(SELECT 1 FROM public.checkins WHERE habit_id=h.id AND day=d AND status='pending') THEN RAISE EXCEPTION 'history_pending_checkin';END IF;
  IF p?'id' THEN
   SELECT * INTO q FROM public.history_proposals WHERE id=(p->>'id')::uuid AND family_id=f FOR UPDATE;
   IF NOT FOUND OR q.status<>'pending' OR q.revision IS DISTINCT FROM (p->>'revision')::integer OR q.habit_id<>h.id OR q.day<>d THEN RAISE EXCEPTION 'history_conflict';END IF;
   IF q.base IS DISTINCT FROM private.history_slot(h.id,d) THEN RAISE EXCEPTION 'history_conflict';END IF;
   UPDATE public.history_proposals SET desired_count=desired,reason=note,revision=revision+1 WHERE id=q.id RETURNING * INTO q;
  ELSE
   IF EXISTS(SELECT 1 FROM public.history_proposals WHERE habit_id=h.id AND day=d AND status='pending') THEN RAISE EXCEPTION 'history_conflict';END IF;
   INSERT INTO public.history_proposals(family_id,child_id,habit_id,day,desired_count,reason,base,rule_snapshot) VALUES(f,h.child_id,h.id,d,desired,note,private.history_slot(h.id,d),to_jsonb(v)) RETURNING * INTO q;
  END IF;
  INSERT INTO private.history_proposal_events(proposal_id,snapshot) VALUES(q.id,to_jsonb(q));
 ELSIF a='history_withdraw' THEN
  SELECT * INTO q FROM public.history_proposals WHERE id=(p->>'id')::uuid AND family_id=f FOR UPDATE;
  IF NOT FOUND OR q.status<>'pending' OR q.revision IS DISTINCT FROM (p->>'revision')::integer THEN RAISE EXCEPTION 'history_conflict';END IF;
  UPDATE public.history_proposals SET status='withdrawn',revision=revision+1,reviewed_at=now() WHERE id=q.id RETURNING * INTO q;
  INSERT INTO private.history_proposal_events(proposal_id,snapshot) VALUES(q.id,to_jsonb(q));
 ELSE
  IF jsonb_typeof(p->'targets') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'approve') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_request';END IF;
  IF jsonb_array_length(p->'targets') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_request';END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(p->'targets') LOOP
   SELECT * INTO q FROM public.history_proposals WHERE id=(t->>'id')::uuid AND family_id=f FOR UPDATE;
   IF NOT FOUND OR q.id=ANY(seen) OR q.status<>'pending' OR q.revision IS DISTINCT FROM (t->>'revision')::integer THEN RAISE EXCEPTION 'history_conflict';END IF;seen:=array_append(seen,q.id);
   IF (p->>'approve')::boolean THEN
    IF q.base IS DISTINCT FROM private.history_slot(q.habit_id,q.day) THEN RAISE EXCEPTION 'history_conflict';END IF;
    SELECT * INTO v FROM public.habit_versions WHERE habit_id=q.habit_id AND effective_day<=q.day ORDER BY effective_day DESC LIMIT 1;
    IF to_jsonb(v) IS DISTINCT FROM q.rule_snapshot OR EXISTS(SELECT 1 FROM public.rests WHERE child_id=q.child_id AND day=q.day) THEN RAISE EXCEPTION 'history_conflict';END IF;
    SELECT count(*) INTO n FROM public.checkins WHERE habit_id=q.habit_id AND day=q.day AND status='approved';
    IF n>q.desired_count THEN
     FOR ci IN SELECT * FROM public.checkins WHERE habit_id=q.habit_id AND day=q.day AND status='approved' ORDER BY created_at DESC,id DESC LIMIT n-q.desired_count LOOP
      PERFORM public.family_mutate('undo_checkin',jsonb_build_object('id',ci.id),md5('history-undo:'||q.id::text||':'||ci.id::text)::uuid,parent_token);
     END LOOP;
    ELSIF n<q.desired_count THEN
     FOR amount IN 1..q.desired_count-n LOOP
      INSERT INTO public.checkins(family_id,child_id,habit_id,day,status,stars,reason,reviewed_at) VALUES(f,q.child_id,q.habit_id,q.day,'approved',v.stars,q.reason,now()) RETURNING id INTO cid;
      INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES(f,q.child_id,v.stars,'checkin',cid);
     END LOOP;
    END IF;
   END IF;
   UPDATE public.history_proposals SET status=CASE WHEN (p->>'approve')::boolean THEN 'approved' ELSE 'rejected' END,revision=revision+1,reviewed_at=now() WHERE id=q.id RETURNING * INTO q;
   INSERT INTO private.history_proposal_events(proposal_id,snapshot) VALUES(q.id,to_jsonb(q));
  END LOOP;
 END IF;
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,r,a,hash);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.history_proposal_mutate(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.history_proposal_mutate(text,jsonb,uuid,text) TO authenticated;
