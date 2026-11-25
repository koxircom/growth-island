-- Read-only display metadata. No balance, grant or historical record is rewritten.
ALTER FUNCTION public.get_dashboard() RENAME TO get_dashboard_before_history_display;
ALTER FUNCTION public.get_dashboard_before_history_display() SET SCHEMA private;
REVOKE ALL ON FUNCTION private.get_dashboard_before_history_display() FROM PUBLIC,anon,authenticated,growth_app;
CREATE FUNCTION public.get_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; f uuid;
BEGIN
 result:=private.get_dashboard_before_history_display();
 f:=private.owned_family();
 IF f IS NULL OR result IS NULL THEN RETURN result; END IF;
 RETURN jsonb_set(result,'{manual_star_grants}',coalesce((
  SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object('reversed_at',r.created_at,'reversal_reason',r.reason) ORDER BY g.created_at DESC,g.id)
  FROM public.manual_star_grants g LEFT JOIN public.manual_star_reversals r ON r.grant_id=g.id AND r.family_id=f
  WHERE g.family_id=f
 ),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_dashboard() FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.get_dashboard() TO authenticated;
