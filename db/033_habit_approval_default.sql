-- Forward-only: new habits default to approval, without rewriting request hashes or history.
DO $migration$
DECLARE old_def text; needle text := 'coalesce((p_payload->>''requires_approval'')::boolean,false)';
BEGIN
 old_def := pg_get_functiondef('private.family_mutate_before_star_rules(text,jsonb,uuid,text)'::regprocedure);
 IF (length(old_def)-length(replace(old_def,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'habit_approval_default_source_mismatch';
 END IF;
 EXECUTE replace(old_def,needle,'coalesce((p_payload->>''requires_approval'')::boolean,true)');
END $migration$;
