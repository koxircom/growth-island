-- Historical check-ins use the same child flow and accounting as today.
-- Preserve all existing ownership, schedule, limit and spent-star checks.
DO $migration$
DECLARE
 body text;
 checkin_guard text := $old$ if d<>today and (not is_parent or length(trim(coalesce(p_payload->>'reason','')))=0) then raise exception 'backfill_requires_parent_and_reason'; end if;
$old$;
 undo_guard text := $old$ if ci.day<>today and not is_parent then raise exception 'parent_required'; end if;
$old$;
 missing_version text := $old$ -- Explicit parent backfill also defines this habit from that day onward.
 insert into public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived,category)
 values(f,h.id,h.child_id,d,h.name,h.icon,h.color,h.weekdays,h.target_count,h.target_minutes,h.stars,h.requires_approval,h.active,false,h.category);$old$;
 active_guard text := $old$ if h.id is null or h.archived_at is not null or not h.active then raise exception 'habit_not_active'; end if;
 d:=coalesce((p_payload->>'day')::date,today);$old$;
BEGIN
 body := pg_get_functiondef('private.family_mutate_before_star_rules(text,jsonb,uuid,text)'::regprocedure);
 IF (length(body)-length(replace(body,checkin_guard,'')))/length(checkin_guard) <> 1
 OR (length(body)-length(replace(body,undo_guard,'')))/length(undo_guard) <> 1
 OR (length(body)-length(replace(body,missing_version,'')))/length(missing_version) <> 1
 OR (length(body)-length(replace(body,active_guard,'')))/length(active_guard) <> 1
 THEN RAISE EXCEPTION 'child_history_checkin_function_mismatch'; END IF;
 body := replace(body,checkin_guard,'');
 body := replace(body,undo_guard,'');
 body := replace(body,missing_version,$new$ raise exception 'habit_not_active_on_date';$new$);
 body := replace(body,active_guard,$new$ if h.id is null then raise exception 'habit_not_active'; end if;
 d:=coalesce((p_payload->>'day')::date,today);
 if d=today and (h.archived_at is not null or not h.active) then raise exception 'habit_not_active'; end if;$new$);
 EXECUTE body;
END $migration$;
