\set ON_ERROR_STOP on
INSERT INTO auth.users(id,email,password_hash) VALUES('00000000-0000-4000-8000-000000000001','fixture@example.invalid','fixture');
INSERT INTO public.families(id,owner_id,name,timezone) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','fixture','Asia/Shanghai');
INSERT INTO public.children(id,family_id,nickname) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','fixture');
INSERT INTO public.habits(id,family_id,child_id,name,stars,requires_approval) VALUES
('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','approved fixture',2,false),
('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','pending fixture',3,true);
INSERT INTO public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived,category)
SELECT family_id,id,child_id,(now() at time zone 'Asia/Shanghai')::date-1,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,false,category FROM public.habits;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$
DECLARE d date := (now() at time zone 'Asia/Shanghai')::date-1; p jsonb; c uuid; n integer;
BEGIN
 p:=jsonb_build_object('habit_id','00000000-0000-4000-8000-000000000004','day',d);
 PERFORM public.family_mutate('checkin',p,'10000000-0000-4000-8000-000000000001',NULL);
 PERFORM public.family_mutate('checkin',p,'10000000-0000-4000-8000-000000000001',NULL);
 SELECT count(*),min(id::text)::uuid INTO n,c FROM public.checkins WHERE habit_id=(p->>'habit_id')::uuid AND day=d AND status='approved';
 IF n<>1 OR (SELECT sum(amount) FROM public.star_ledger WHERE source_id=c)<>2 THEN RAISE EXCEPTION 'approved or idempotence failure'; END IF;
 BEGIN PERFORM public.family_mutate('checkin',p,'10000000-0000-4000-8000-000000000002',NULL); RAISE EXCEPTION 'limit missing'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'daily_goal_reached' THEN RAISE; END IF; END;
 PERFORM public.family_mutate('undo_checkin',jsonb_build_object('id',c),'10000000-0000-4000-8000-000000000003',NULL);
 IF (SELECT status FROM public.checkins WHERE id=c)<>'undone' OR (SELECT sum(amount) FROM public.star_ledger WHERE source_id=c)<>0 THEN RAISE EXCEPTION 'undo failure'; END IF;
 p:=jsonb_build_object('habit_id','00000000-0000-4000-8000-000000000005','day',d);
 PERFORM public.family_mutate('checkin',p,'10000000-0000-4000-8000-000000000004',NULL);
 IF (SELECT count(*) FROM public.checkins WHERE habit_id=(p->>'habit_id')::uuid AND day=d AND status='pending')<>1 THEN RAISE EXCEPTION 'pending failure'; END IF;
 IF EXISTS(SELECT 1 FROM public.star_ledger l JOIN public.checkins x ON x.id=l.source_id WHERE x.habit_id=(p->>'habit_id')::uuid) THEN RAISE EXCEPTION 'pending credited'; END IF;
 BEGIN PERFORM public.family_mutate('checkin',jsonb_set(p,'{day}',to_jsonb(d+2)),'10000000-0000-4000-8000-000000000005',NULL); RAISE EXCEPTION 'future accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'invalid_date' THEN RAISE; END IF; END;
 BEGIN PERFORM public.family_mutate('checkin',jsonb_set(p,'{day}',to_jsonb(d-1)),'10000000-0000-4000-8000-000000000006',NULL); RAISE EXCEPTION 'no version accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'habit_not_active_on_date' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS historical checkin, idempotence, limit, undo, pending, future, missing version';
END $$;
UPDATE public.habits SET active=false WHERE id='00000000-0000-4000-8000-000000000004';
DO $$
DECLARE d date := (now() at time zone 'Asia/Shanghai')::date-1;
BEGIN
 PERFORM public.family_mutate('checkin',jsonb_build_object('habit_id','00000000-0000-4000-8000-000000000004','day',d),'10000000-0000-4000-8000-000000000007',NULL);
 IF NOT EXISTS(SELECT 1 FROM public.checkins WHERE habit_id='00000000-0000-4000-8000-000000000004' AND day=d AND status='approved') THEN RAISE EXCEPTION 'historical paused habit failed'; END IF;
 BEGIN PERFORM public.family_mutate('checkin',jsonb_build_object('habit_id','00000000-0000-4000-8000-000000000004','day',d+1),'10000000-0000-4000-8000-000000000008',NULL); RAISE EXCEPTION 'paused today accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'habit_not_active' THEN RAISE; END IF; END;
END $$;
