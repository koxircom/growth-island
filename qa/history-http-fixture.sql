\set ON_ERROR_STOP on
INSERT INTO auth.users(id,email,password_hash) VALUES('00000000-0000-4000-8000-000000000001','fixture@example.invalid','fixture');
INSERT INTO public.families(id,owner_id,name,timezone) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','fixture','Asia/Shanghai');
INSERT INTO public.children(id,family_id,nickname) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','fixture');
INSERT INTO public.habits(id,family_id,child_id,name,stars,requires_approval) VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','fixture habit',2,false);
INSERT INTO public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived,category)
SELECT family_id,id,child_id,(now() at time zone 'Asia/Shanghai')::date-1,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,false,category FROM public.habits;
INSERT INTO auth.sessions(token_hash,user_id,expires_at) VALUES(encode(extensions.digest(repeat('f',64),'sha256'),'hex'),'00000000-0000-4000-8000-000000000001',now()+interval '1 hour');
