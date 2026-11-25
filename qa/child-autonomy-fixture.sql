\set ON_ERROR_STOP on
INSERT INTO auth.household_login(singleton,user_id) VALUES(true,'00000000-0000-4000-8000-000000000001') ON CONFLICT(singleton) DO UPDATE SET user_id=excluded.user_id;
INSERT INTO public.children(id,family_id,nickname) VALUES('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','fixture child b');
INSERT INTO public.rewards(id,family_id,name,cost) VALUES('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000002','fixture reward',1);
INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',3,'checkin','00000000-0000-4000-8000-000000000008');
INSERT INTO public.star_ledger(family_id,child_id,amount,source_type,source_id) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000006',4,'checkin','00000000-0000-4000-8000-000000000009');
