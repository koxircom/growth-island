-- Parent-only, read-only diagnostics. No device commands, credentials or inferred bindings.
CREATE FUNCTION public.get_switch_operations(p_parent_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 f:=private.owned_family();
 IF f IS NULL OR NOT private.parent_valid(f,p_parent_token) THEN RAISE EXCEPTION 'parent_required'; END IF;
 RETURN jsonb_build_object(
 'read_at',statement_timestamp(),
 'devices',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'active',d.active) ORDER BY d.created_at,d.id) FROM public.family_devices d WHERE d.family_id=f),'[]'::jsonb),
 'children',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'nickname',c.nickname)) FROM public.children c WHERE c.family_id=f),'[]'::jsonb),
 'balances',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT child_id,device_id,sum(seconds_delta) AS seconds FROM public.device_time_ledger WHERE family_id=f GROUP BY child_id,device_id)x),'[]'::jsonb),
 'redemptions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id) FROM (
 SELECT r.id,r.child_id,r.device_id,r.device_name,r.reward_name,r.cost,r.duration_seconds,r.status,r.created_at,r.reviewed_at,
 (SELECT sum(l.seconds_delta) FROM public.device_time_ledger l WHERE l.family_id=f AND l.child_id=r.child_id AND l.device_id=r.device_id AND l.source_type='grant' AND l.source_id=r.id) AS credited_seconds
 FROM public.redemptions r WHERE r.family_id=f AND r.kind='device_time' ORDER BY r.created_at DESC,r.id LIMIT 200)x),'[]'::jsonb),
 'usage',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC,x.id) FROM (
 SELECT id,child_id,device_id,device_name,started_at,deadline_at,ended_at,reserved_seconds,actual_seconds,status
 FROM public.device_usage_sessions WHERE family_id=f ORDER BY started_at DESC,id LIMIT 200)x),'[]'::jsonb)
 );
END $$;
REVOKE ALL ON FUNCTION public.get_switch_operations(text) FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.get_switch_operations(text) TO authenticated;
