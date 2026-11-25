-- Correcting a check-in is not spending. Preserve all ownership, parent,
-- spent-stars and later habit guards in the current wrapper.
DO $fix$
DECLARE body text;
 old_actions text := $needle$'redeem','device_time_start','undo_checkin','redeem_undo','device_time_extend','device_time_stop'$needle$;
 old_branch text := $needle$  ELSIF p_action='undo_checkin' THEN SELECT child_id INTO c FROM public.checkins WHERE id=(p_payload->>'id')::uuid AND family_id=f;$needle$;
BEGIN
 body := pg_get_functiondef('public.family_mutate(text,jsonb,uuid,text)'::regprocedure);
 IF (length(body)-length(replace(body,old_actions,'')))/length(old_actions) <> 1
 OR (length(body)-length(replace(body,old_branch,'')))/length(old_branch) <> 1
 THEN RAISE EXCEPTION 'checkin_undo_wrapper_mismatch'; END IF;
 body := replace(body,old_actions,$needle$'redeem','device_time_start','redeem_undo','device_time_extend','device_time_stop'$needle$);
 body := replace(body,old_branch,'');
 EXECUTE body;
END $fix$;
