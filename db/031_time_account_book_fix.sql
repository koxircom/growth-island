-- Forward-only correction: seconds ledger has no posting snapshot columns. Do not invent historical balances.
CREATE OR REPLACE FUNCTION public.get_account_book(p_parent_token text,p_child uuid DEFAULT NULL,p_unit text DEFAULT 'stars',p_page integer DEFAULT 0)
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
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY posting_seq DESC NULLS LAST,created_at DESC,id DESC),'[]') INTO rows FROM (
   SELECT l.id,l.child_id,l.amount,l.source_type,l.source_id,l.created_at,l.posting_seq,l.balance_before,l.balance_after,
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
   ORDER BY l.posting_seq DESC NULLS LAST,l.created_at DESC,l.id DESC LIMIT 50 OFFSET p_page*50
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
