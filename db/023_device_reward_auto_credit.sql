-- All time rewards credit atomically without parent approval. Historical orders remain untouched.
-- All pending redemptions may be undone; issued time requires unused proof. Approved activities require manual verification.
CREATE OR REPLACE FUNCTION public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior_ids uuid[]; rd public.redemptions%rowtype; f uuid; c uuid; r public.rewards%rowtype; d public.family_devices%rowtype; previous private.mutation_requests%rowtype; h text; obj uuid; balance bigint;
BEGIN
 IF p_action NOT IN ('redeem','redeem_undo') THEN
  RETURN private.family_mutate_before_tv_auto_credit(p_action,p_payload,p_request_id,p_parent_token);
 END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RAISE EXCEPTION 'family_not_found'; END IF;
 h:=encode(extensions.digest(((p_payload-'pin') || CASE WHEN p_payload?'pin' THEN '{"pin_change":true}'::jsonb ELSE '{}'::jsonb END)::text,'sha256'),'hex');
 SELECT * INTO previous FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.action<>p_action OR previous.payload_hash<>h THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 c:=(p_payload->>'child_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=c AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;


 IF p_action='redeem_undo' THEN
  SELECT * INTO rd FROM public.redemptions WHERE id=(p_payload->>'id')::uuid AND family_id=f AND child_id=c FOR UPDATE;
  IF rd.id IS NULL THEN RAISE EXCEPTION 'redemption_not_found'; END IF;
  IF rd.cancelled_at IS NOT NULL THEN RETURN public.get_dashboard(); END IF;
  IF rd.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'redemption_undo_unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.star_ledger WHERE source_type='redemption' AND source_id=rd.id AND family_id=f AND child_id=c AND amount=-rd.cost)
   OR EXISTS(SELECT 1 FROM public.star_ledger WHERE source_type='refund' AND source_id=rd.id)
   THEN RAISE EXCEPTION 'redemption_undo_unavailable'; END IF;
  IF rd.status='pending' THEN
   -- Pending activities and ordinary device rewards have no issued time entitlement.
   IF EXISTS(SELECT 1 FROM public.device_time_ledger WHERE source_id=rd.id) THEN RAISE EXCEPTION 'redemption_undo_unavailable'; END IF;
  ELSE
   -- Approval of a physical/activity reward may already have external effects.
   IF rd.kind<>'device_time' THEN RAISE EXCEPTION 'redemption_external_unknown'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.device_time_ledger WHERE source_type='grant' AND source_id=rd.id AND family_id=f AND child_id=c AND device_id=rd.device_id AND seconds_delta=rd.duration_seconds)
    OR EXISTS(SELECT 1 FROM public.device_time_ledger WHERE family_id=f AND child_id=c AND device_id=rd.device_id AND source_type='reserve' AND created_at>=rd.created_at)
    OR EXISTS(SELECT 1 FROM private.tv_sessions WHERE family_id=f AND child_id=c AND device_id=rd.device_id AND state<>'ended')
    OR EXISTS(SELECT 1 FROM public.device_usage_sessions WHERE family_id=f AND child_id=c AND device_id=rd.device_id AND status='running')
    THEN RAISE EXCEPTION 'redemption_time_already_used'; END IF;
   SELECT coalesce(sum(seconds_delta),0) INTO balance FROM public.device_time_ledger WHERE family_id=f AND child_id=c AND device_id=rd.device_id;
   IF balance<rd.duration_seconds THEN RAISE EXCEPTION 'redemption_time_already_used'; END IF;
   INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(f,c,rd.device_id,-rd.duration_seconds,'reversal',rd.id);
  END IF;
  INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES(f,c,rd.cost,'refund',rd.id);
  UPDATE public.redemptions SET status='rejected',cancelled_at=clock_timestamp(),reviewed_at=clock_timestamp() WHERE id=rd.id;
  INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,h);
  INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),p_action,rd.id);
  RETURN public.get_dashboard();
 END IF;
 SELECT * INTO r FROM public.rewards WHERE id=(p_payload->>'reward_id')::uuid AND family_id=f AND active AND (child_id IS NULL OR child_id=c);
 IF r.id IS NULL THEN RAISE EXCEPTION 'reward_not_found'; END IF;
 IF r.kind<>'device_time' THEN
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO prior_ids FROM public.redemptions WHERE family_id=f AND child_id=c;
  PERFORM private.family_mutate_before_tv_auto_credit(p_action,p_payload,p_request_id,p_parent_token);
  UPDATE public.redemptions SET request_id=p_request_id WHERE family_id=f AND child_id=c AND reward_id=r.id AND NOT(id=ANY(prior_ids));
  RETURN public.get_dashboard();
 END IF;
 SELECT * INTO d FROM public.family_devices WHERE id=r.device_id AND family_id=f AND active;
 IF d.id IS NULL THEN RAISE EXCEPTION 'device_inactive'; END IF;
 SELECT coalesce(sum(amount),0) INTO balance FROM public.star_ledger WHERE family_id=f AND child_id=c;
 IF balance<r.cost THEN RAISE EXCEPTION 'insufficient_stars'; END IF;
 INSERT INTO public.redemptions(family_id,child_id,reward_id,reward_name,cost,kind,device_id,device_name,duration_seconds,status,reviewed_at,request_id)
 VALUES(f,c,r.id,r.name,r.cost,r.kind,r.device_id,d.name,r.duration_seconds,'approved',clock_timestamp(),p_request_id) RETURNING id INTO obj;
 INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES(f,c,-r.cost,'redemption',obj);
 INSERT INTO public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) VALUES(f,c,r.device_id,r.duration_seconds,'grant',obj);
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,p_action,h);
 INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),'device_redemption_auto_credit',obj);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.family_mutate(text,jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.family_mutate(text,jsonb,uuid,text) TO authenticated;
