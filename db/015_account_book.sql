-- Parent account book. Additive, leaves historical entries and balances untouched.
CREATE TABLE public.manual_star_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families,
 child_id uuid NOT NULL, grant_id uuid NOT NULL UNIQUE REFERENCES public.manual_star_grants,
 amount integer NOT NULL CHECK(amount<0), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 300),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id)
);
ALTER TABLE public.manual_star_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_star_reversals FROM PUBLIC,anon,authenticated,growth_app;
ALTER TABLE public.star_ledger DROP CONSTRAINT star_ledger_source_type_check;
ALTER TABLE public.star_ledger ADD CONSTRAINT star_ledger_source_type_check CHECK(source_type IN ('checkin','undo','redemption','refund','manual_bonus','star_adjustment','manual_reversal'));

CREATE FUNCTION public.reverse_manual_stars(p_payload jsonb,p_request_id uuid,p_parent_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; g public.manual_star_grants%rowtype; prev private.mutation_requests%rowtype; h text; obj uuid; bal bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL OR NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 h:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 SELECT * INTO prev FROM private.mutation_requests WHERE family_id=f AND request_id=p_request_id;
 IF FOUND THEN
  IF prev.action<>'manual_star_reverse' OR prev.payload_hash<>h THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN public.get_dashboard();
 END IF;
 IF p_payload->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
 OR length(trim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid_star_grant'; END IF;
 SELECT * INTO g FROM public.manual_star_grants WHERE id=(p_payload->>'id')::uuid AND family_id=f;
 IF g.id IS NULL THEN RAISE EXCEPTION 'star_adjustment_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM public.manual_star_reversals WHERE grant_id=g.id) THEN RAISE EXCEPTION 'star_already_reversed'; END IF;
 SELECT coalesce(sum(amount),0) INTO bal FROM public.star_ledger WHERE child_id=g.child_id AND family_id=f;
 IF bal<g.amount THEN RAISE EXCEPTION 'insufficient_stars'; END IF;
 INSERT INTO public.manual_star_reversals(family_id,child_id,grant_id,amount,reason)
 VALUES(f,g.child_id,g.id,-g.amount,trim(p_payload->>'reason')) RETURNING id INTO obj;
 INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES(f,g.child_id,-g.amount,'manual_reversal',obj);
 INSERT INTO private.mutation_requests(family_id,request_id,action,payload_hash) VALUES(f,p_request_id,'manual_star_reverse',h);
 INSERT INTO private.audit_log(family_id,actor_id,action,object_id) VALUES(f,auth.uid(),'manual_star_reverse',obj);
 RETURN public.get_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.reverse_manual_stars(jsonb,uuid,text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.reverse_manual_stars(jsonb,uuid,text) TO authenticated;

CREATE FUNCTION public.get_account_book(p_parent_token text,p_child uuid DEFAULT NULL,p_unit text DEFAULT 'stars',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; rows jsonb; summaries jsonb; total bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 f:=private.owned_family();
 IF f IS NULL OR NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 IF p_unit NOT IN ('stars','seconds') OR p_page IS NULL OR p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 IF p_child IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.children WHERE id=p_child AND family_id=f) THEN RAISE EXCEPTION 'child_not_found'; END IF;
 IF p_unit='stars' THEN
  SELECT count(*) INTO total FROM public.star_ledger WHERE family_id=f AND (p_child IS NULL OR child_id=p_child);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,id DESC),'[]') INTO rows FROM (
   SELECT l.id,l.child_id,l.amount,l.source_type,l.source_id,l.created_at,
    CASE WHEN l.source_type IN ('checkin','undo') THEN coalesce(hv.name,h.name,'习惯打卡')
     WHEN l.source_type IN ('redemption','refund') THEN coalesce(r.reward_name,'奖励兑换')
     WHEN l.source_type='manual_bonus' THEN g.reason WHEN l.source_type='manual_reversal' THEN rv.reason
     WHEN l.source_type='star_adjustment' THEN a.reason ELSE l.source_type END AS description,
    CASE WHEN l.source_type='manual_bonus' THEN CASE WHEN EXISTS(SELECT 1 FROM public.manual_star_reversals z WHERE z.grant_id=g.id) THEN 'reversed' ELSE 'posted' END
     WHEN l.source_type IN ('redemption','refund') THEN r.status
     WHEN l.source_type IN ('checkin','undo') THEN ci.status ELSE 'posted' END AS status,
    rv.grant_id AS related_id,
    (l.source_type='manual_bonus' AND NOT EXISTS(SELECT 1 FROM public.manual_star_reversals z WHERE z.grant_id=g.id)) AS can_reverse
   FROM public.star_ledger l
   LEFT JOIN public.checkins ci ON l.source_type IN ('checkin','undo') AND ci.id=l.source_id AND ci.family_id=f
   LEFT JOIN public.habits h ON h.id=ci.habit_id
   LEFT JOIN LATERAL (SELECT name FROM public.habit_versions WHERE habit_id=ci.habit_id AND effective_day<=ci.day ORDER BY effective_day DESC LIMIT 1) hv ON true
   LEFT JOIN public.redemptions r ON l.source_type IN ('redemption','refund') AND r.id=l.source_id AND r.family_id=f
   LEFT JOIN public.manual_star_grants g ON l.source_type='manual_bonus' AND g.id=l.source_id AND g.family_id=f
   LEFT JOIN public.manual_star_reversals rv ON l.source_type='manual_reversal' AND rv.id=l.source_id AND rv.family_id=f
   LEFT JOIN public.star_adjustments a ON l.source_type='star_adjustment' AND a.id=l.source_id AND a.family_id=f
   WHERE l.family_id=f AND (p_child IS NULL OR l.child_id=p_child)
   ORDER BY l.created_at DESC,l.id DESC LIMIT 50 OFFSET p_page*50
  )x;
 ELSE
  SELECT count(*) INTO total FROM public.device_time_ledger WHERE family_id=f AND (p_child IS NULL OR child_id=p_child);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,id DESC),'[]') INTO rows FROM (
   SELECT l.id,l.child_id,l.seconds_delta AS amount,l.source_type,l.source_id,l.created_at,l.device_id,d.name AS description,
    CASE WHEN l.source_type='grant' THEN 'wallet_credited' ELSE 'ledger_only' END AS status,false AS can_reverse
   FROM public.device_time_ledger l JOIN public.family_devices d ON d.id=l.device_id
   WHERE l.family_id=f AND (p_child IS NULL OR l.child_id=p_child)
   ORDER BY l.created_at DESC,l.id DESC LIMIT 50 OFFSET p_page*50
  )x;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO summaries FROM (
  SELECT c.id AS child_id,coalesce(s.balance,0) AS balance,coalesce(s.income,0) AS income,coalesce(s.expense,0) AS expense,
   coalesce((SELECT sum(cost) FROM public.redemptions WHERE child_id=c.id AND family_id=f AND status='pending'),0) AS pending_stars,
   coalesce((SELECT sum(stars) FROM public.checkins WHERE child_id=c.id AND family_id=f AND status='pending'),0) AS pending_earnings,
   coalesce((SELECT sum(stars) FROM public.checkins WHERE child_id=c.id AND family_id=f AND status='approved'),0)
    -coalesce((SELECT sum(cost) FROM public.redemptions WHERE child_id=c.id AND family_id=f AND status IN ('pending','approved')),0)
    +coalesce((SELECT sum(amount) FROM public.manual_star_grants WHERE child_id=c.id AND family_id=f),0)
    +coalesce((SELECT sum(amount) FROM public.manual_star_reversals WHERE child_id=c.id AND family_id=f),0)
    +coalesce((SELECT sum(amount) FROM public.star_adjustments WHERE child_id=c.id AND family_id=f),0) AS expected_balance
  FROM public.children c LEFT JOIN LATERAL (
   SELECT sum(amount) AS balance,sum(amount) FILTER(WHERE amount>0) AS income,-sum(amount) FILTER(WHERE amount<0) AS expense
   FROM public.star_ledger WHERE child_id=c.id AND family_id=f
  )s ON true WHERE c.family_id=f AND (p_child IS NULL OR c.id=p_child)
 )x;
 RETURN jsonb_build_object('read_at',statement_timestamp(),'unit',p_unit,'page',p_page,'total',total,'entries',rows,'summaries',summaries,
 'time_accounts',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT c.id AS child_id,d.id AS device_id,d.name,
   coalesce((SELECT sum(seconds_delta) FROM public.device_time_ledger WHERE child_id=c.id AND device_id=d.id AND family_id=f),0) AS available,
   coalesce((SELECT sum(greatest(0,extract(epoch FROM deadline_at-statement_timestamp()))) FROM public.device_usage_sessions WHERE child_id=c.id AND device_id=d.id AND family_id=f AND status='running'),0)::bigint AS running_seconds,
   EXISTS(SELECT 1 FROM private.tv_operations o JOIN private.tv_sessions s ON s.id=o.usage_id WHERE o.family_id=f AND s.child_id=c.id AND s.device_id=d.id AND NOT o.resolved) AS device_pending
  FROM public.children c CROSS JOIN public.family_devices d WHERE c.family_id=f AND d.family_id=f AND (p_child IS NULL OR c.id=p_child)
 )x),'[]'));
END $$;
REVOKE ALL ON FUNCTION public.get_account_book(text,uuid,text,integer) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.get_account_book(text,uuid,text,integer) TO authenticated;
