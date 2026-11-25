CREATE FUNCTION public.get_statistics(p_period text,p_anchor date,p_child uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;tz text;a date;z date;r jsonb;
BEGIN
f:=private.owned_family();IF f IS NULL THEN RAISE EXCEPTION 'authentication_required';END IF;
IF p_period NOT IN ('week','month','year') OR p_anchor IS NULL OR p_anchor NOT BETWEEN date '2000-01-01' AND date '2100-12-31' THEN RAISE EXCEPTION 'invalid_request';END IF;
IF p_child IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.children WHERE family_id=f AND id=p_child) THEN RAISE EXCEPTION 'child_not_found';END IF;
SELECT timezone INTO tz FROM public.families WHERE id=f;
a:=date_trunc(p_period,p_anchor::timestamp)::date;z:=(a+CASE p_period WHEN 'week' THEN interval '7 days' WHEN 'month' THEN interval '1 month' ELSE interval '1 year' END)::date;
WITH days AS (SELECT d::date AS day,d::timestamp AT TIME ZONE tz lo,(d::date+1)::timestamp AT TIME ZONE tz hi FROM generate_series(a::timestamp,(z-1)::timestamp,interval '1 day') d),
sessions AS (
SELECT id,child_id,kind category,started_at lo,ended_at hi,actual_seconds::numeric seconds,status IN ('running','paused') pending FROM public.timers WHERE family_id=f
UNION ALL SELECT id,child_id,'device:'||device_name,started_at,ended_at,actual_seconds,status='running' FROM public.device_usage_sessions WHERE family_id=f
UNION ALL SELECT id,child_id,'tv_confirmed',CASE WHEN remote->>'started_at' ~ '^[0-9]+([.][0-9]+)?$' THEN to_timestamp((remote->>'started_at')::numeric) END,CASE WHEN remote->>'started_at' ~ '^[0-9]+([.][0-9]+)?$' THEN to_timestamp((remote->>'started_at')::numeric)+consumed_seconds*interval '1 second' END,consumed_seconds,state<>'ended' FROM private.tv_sessions WHERE family_id=f),
portions AS (
SELECT s.id,d.day,s.child_id,s.category||CASE WHEN s.pending THEN ':pending' ELSE '' END category,
CASE WHEN s.pending THEN 0 ELSE greatest(0,s.seconds)*greatest(0,extract(epoch FROM least(s.hi,d.hi)-greatest(s.lo,d.lo)))/greatest(1,extract(epoch FROM s.hi-s.lo)) END seconds,1 count
FROM sessions s JOIN days d ON (NOT s.pending AND s.hi>d.lo AND s.lo<d.hi) OR (NOT s.pending AND s.hi=s.lo AND s.lo>=d.lo AND s.lo<d.hi) OR (s.pending AND s.lo>=d.lo AND s.lo<d.hi) WHERE p_child IS NULL OR s.child_id=p_child),
buckets AS (SELECT CASE WHEN p_period='year' THEN to_char(day,'YYYY-MM-01') ELSE day::text END date,child_id,category,round(sum(seconds),2) seconds,count(DISTINCT id) count FROM portions GROUP BY 1,2,3),
stars AS (SELECT to_char(l.created_at AT TIME ZONE tz,CASE WHEN p_period='year' THEN 'YYYY-MM-01' ELSE 'YYYY-MM-DD' END) date,l.child_id,CASE WHEN l.source_type='star_adjustment' THEN 'star_'||coalesce(sa.kind,'adjustment') ELSE l.source_type END source_type,sum(l.amount) amount,count(*) count FROM public.star_ledger l LEFT JOIN public.star_adjustments sa ON l.source_type='star_adjustment' AND sa.id=l.source_id AND sa.family_id=f WHERE l.family_id=f AND (p_child IS NULL OR l.child_id=p_child) AND l.created_at>=a::timestamp AT TIME ZONE tz AND l.created_at<z::timestamp AT TIME ZONE tz GROUP BY 1,2,3),
rewards AS (SELECT to_char(created_at AT TIME ZONE tz,CASE WHEN p_period='year' THEN 'YYYY-MM-01' ELSE 'YYYY-MM-DD' END) date,child_id,status,kind,count(*) count,sum(cost) cost,sum(coalesce(duration_seconds,0)) seconds FROM public.redemptions WHERE family_id=f AND (p_child IS NULL OR child_id=p_child) AND created_at>=a::timestamp AT TIME ZONE tz AND created_at<z::timestamp AT TIME ZONE tz GROUP BY 1,2,3,4),
balances AS (SELECT c.id child_id,coalesce(sum(l.amount),0) balance FROM public.children c LEFT JOIN public.star_ledger l ON l.child_id=c.id AND l.family_id=f WHERE c.family_id=f AND (p_child IS NULL OR c.id=p_child) GROUP BY c.id)
SELECT jsonb_build_object('timezone',tz,'period',p_period,'start',a,'end',z,'as_of',now(),'buckets',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY date,child_id,category) FROM buckets b),'[]'),'stars',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY date,child_id,source_type) FROM stars s),'[]'),'redemptions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY date,child_id,status) FROM rewards x),'[]'),'balances',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM balances b),'[]'),'unallocated_tv_count',(SELECT count(*) FROM private.tv_sessions WHERE family_id=f AND (p_child IS NULL OR child_id=p_child) AND NOT coalesce(remote->>'started_at' ~ '^[0-9]+([.][0-9]+)?$',false)),'notes',jsonb_build_array('记录时长不等于实际观看时长；兑换单独列示。','跨日按记录秒数在起止区间比例分摊；暂停发生时间不可还原。','进行中记录仅计次数，不计已完成时长。','电视仅含已确认消耗，不推算观看时长。')) INTO r;
RETURN r;END $$;
REVOKE ALL ON FUNCTION public.get_statistics(text,date,uuid) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.get_statistics(text,date,uuid) TO authenticated;