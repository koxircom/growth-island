-- Time rewards are explicit metadata, never inferred from existing reward names.
CREATE TABLE public.family_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,family_id)
);
ALTER TABLE public.rewards ADD COLUMN kind text NOT NULL DEFAULT 'activity' CHECK(kind IN ('activity','device_time')),
 ADD COLUMN device_id uuid, ADD COLUMN duration_seconds integer,
 ADD FOREIGN KEY(device_id,family_id) REFERENCES public.family_devices(id,family_id),
 ADD CHECK((kind='activity' AND device_id IS NULL AND duration_seconds IS NULL) OR (kind='device_time' AND device_id IS NOT NULL AND duration_seconds BETWEEN 60 AND 10800));
ALTER TABLE public.redemptions ADD COLUMN kind text NOT NULL DEFAULT 'activity' CHECK(kind IN ('activity','device_time')),
 ADD COLUMN device_id uuid, ADD COLUMN device_name text, ADD COLUMN duration_seconds integer,
 ADD FOREIGN KEY(device_id,family_id) REFERENCES public.family_devices(id,family_id),
 ADD CHECK((kind='activity' AND device_id IS NULL AND duration_seconds IS NULL) OR (kind='device_time' AND device_id IS NOT NULL AND duration_seconds BETWEEN 60 AND 10800));
CREATE TABLE public.device_usage_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 child_id uuid NOT NULL, device_id uuid NOT NULL, device_name text NOT NULL,
 reserved_seconds integer NOT NULL CHECK(reserved_seconds BETWEEN 1 AND 10800), started_at timestamptz NOT NULL,
 deadline_at timestamptz NOT NULL, ended_at timestamptz, actual_seconds integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','stopped')),
 request_id uuid NOT NULL, UNIQUE(family_id,request_id), UNIQUE(id,family_id),
 FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id), FOREIGN KEY(device_id,family_id) REFERENCES public.family_devices(id,family_id),
 CHECK(deadline_at=started_at+reserved_seconds*interval '1 second'), CHECK(actual_seconds BETWEEN 0 AND reserved_seconds),
 CHECK((status='running' AND ended_at IS NULL) OR (status<>'running' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_device_usage_per_child ON public.device_usage_sessions(child_id) WHERE status='running';
CREATE INDEX expired_device_usage ON public.device_usage_sessions(deadline_at) WHERE status='running';
CREATE TABLE public.device_time_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 child_id uuid NOT NULL, device_id uuid NOT NULL, seconds_delta integer NOT NULL CHECK(seconds_delta<>0),
 source_type text NOT NULL CHECK(source_type IN ('grant','reserve','refund')), source_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(source_type,source_id),
 FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id), FOREIGN KEY(device_id,family_id) REFERENCES public.family_devices(id,family_id),
 CHECK((source_type='reserve' AND seconds_delta<0) OR (source_type IN ('grant','refund') AND seconds_delta>0))
);
CREATE TABLE public.manual_star_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES public.families ON DELETE CASCADE,
 child_id uuid NOT NULL, amount integer NOT NULL CHECK(amount BETWEEN 1 AND 10000), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 300),
 actor_id uuid NOT NULL REFERENCES auth.users(id), request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(family_id,request_id), FOREIGN KEY(child_id,family_id) REFERENCES public.children(id,family_id)
);
ALTER TABLE public.star_ledger DROP CONSTRAINT star_ledger_source_type_check;
ALTER TABLE public.star_ledger ADD CONSTRAINT star_ledger_source_type_check CHECK(source_type IN ('checkin','undo','redemption','refund','manual_bonus'));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['family_devices','device_usage_sessions','device_time_ledger','manual_star_grants'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY family_read ON public.%I FOR SELECT TO authenticated USING(family_id=public.current_family_id())',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,growth_app',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
CREATE TABLE private.device_settler_health(singleton boolean PRIMARY KEY CHECK(singleton),last_success_at timestamptz);
INSERT INTO private.device_settler_health VALUES(true,NULL);
REVOKE ALL ON private.device_settler_health FROM PUBLIC,anon,authenticated,growth_app;
-- Caller must hold the family row lock. Never expose this arbitrary-family helper.
CREATE FUNCTION private.settle_device_family(p_family uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; cutoff timestamptz:=clock_timestamp();
BEGIN
 UPDATE public.device_usage_sessions SET ended_at=deadline_at,actual_seconds=reserved_seconds,status='completed'
 WHERE family_id=p_family AND status='running' AND deadline_at<=cutoff;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.settle_device_family(uuid) FROM PUBLIC,anon,authenticated,growth_app;
CREATE FUNCTION public.settle_owned_device_usage() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
 SELECT id INTO f FROM public.families WHERE owner_id=auth.uid() FOR UPDATE;
 IF f IS NULL THEN RETURN 0; END IF;
 RETURN private.settle_device_family(f);
END $$;
REVOKE ALL ON FUNCTION public.settle_owned_device_usage() FROM PUBLIC,anon,growth_app;
GRANT EXECUTE ON FUNCTION public.settle_owned_device_usage() TO authenticated;
-- No arguments: low-privilege worker may ONLY complete already-expired reservations.
CREATE FUNCTION public.settle_expired_device_usage() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; n integer:=0;
BEGIN
 FOR f IN SELECT x.id FROM public.families x WHERE EXISTS(SELECT 1 FROM public.device_usage_sessions u WHERE u.family_id=x.id AND u.status='running' AND u.deadline_at<=clock_timestamp()) ORDER BY x.id LIMIT 100 FOR UPDATE OF x SKIP LOCKED LOOP
  n:=n+private.settle_device_family(f);
 END LOOP;
 UPDATE private.device_settler_health SET last_success_at=clock_timestamp() WHERE singleton;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.settle_expired_device_usage() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_expired_device_usage() TO growth_app;

create or replace function public.get_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f uuid; result jsonb;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 f:=private.owned_family();
 select jsonb_build_object(
 'family',(select to_jsonb(x)-'owner_id' from public.families x where id=f),
 'children',coalesce((select jsonb_agg(to_jsonb(x) order by created_at,id) from public.children x where family_id=f),'[]'),
 'habits',coalesce((select jsonb_agg(to_jsonb(x) order by created_at,id) from public.habits x where family_id=f),'[]'),
 'habit_versions',coalesce((select jsonb_agg(to_jsonb(x) order by effective_day) from public.habit_versions x where family_id=f),'[]'),
 'checkins',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.checkins x where family_id=f),'[]'),
 'timers',coalesce((select jsonb_agg(to_jsonb(x) order by started_at desc) from public.timers x where family_id=f),'[]'),
 'rewards',coalesce((select jsonb_agg(to_jsonb(x) order by created_at) from public.rewards x where family_id=f),'[]'),
 'redemptions',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.redemptions x where family_id=f),'[]'),
 'rests',coalesce((select jsonb_agg(to_jsonb(x)) from public.rests x where family_id=f),'[]'),
 'devices',coalesce((select jsonb_agg(to_jsonb(x) order by created_at,id) from public.family_devices x where family_id=f),'[]'),
 'device_usage_sessions',coalesce((select jsonb_agg(to_jsonb(x) order by started_at desc,id) from public.device_usage_sessions x where family_id=f),'[]'),
 'device_time_balances',coalesce((select jsonb_agg(to_jsonb(x)) from(select child_id,device_id,sum(seconds_delta) balance_seconds from public.device_time_ledger where family_id=f group by child_id,device_id)x),'[]'),
 'manual_star_grants',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc,id) from public.manual_star_grants x where family_id=f),'[]'),
 'device_settler_last_success_at',(select last_success_at from private.device_settler_health where singleton),
 'star_balances',coalesce((select jsonb_agg(to_jsonb(b)) from(select c.id child_id,coalesce(sum(l.amount),0) balance,coalesce(sum(l.amount) filter(where l.source_type in ('checkin','undo')),0) earned from public.children c left join public.star_ledger l on l.child_id=c.id where c.family_id=f group by c.id)b),'[]')
 ) into result;
 return result;
end $$;

create or replace function public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f uuid; fam public.families%rowtype; child public.children%rowtype; h public.habits%rowtype; ci public.checkins%rowtype;
 tm public.timers%rowtype; rw public.rewards%rowtype; rd public.redemptions%rowtype; hv public.habit_versions%rowtype;
 device public.family_devices%rowtype; usage public.device_usage_sessions%rowtype; grant_row public.manual_star_grants%rowtype; secs integer; reward_kind text; device_uuid uuid;
 action_now timestamptz; obj uuid; cid uuid; d date; today date; is_parent boolean; elapsed integer; total integer; budget integer; bal bigint; hash text; previous private.mutation_requests%rowtype;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'invalid_request'; end if;
 if octet_length(p_payload::text)>12000 then raise exception 'payload_too_large'; end if;
 select * into fam from public.families where owner_id=auth.uid() for update;
 f:=fam.id; if f is null then raise exception 'family_not_found'; end if;
 perform private.settle_device_family(f);
 action_now:=clock_timestamp();
 today:=(action_now at time zone fam.timezone)::date;
 is_parent:=private.parent_valid(f,p_parent_token);
 -- Never put a fast unsalted hash of the low-entropy PIN into request logs.
 hash:=encode(extensions.digest(((p_payload-'pin') || case when p_payload?'pin' then '{"pin_change":true}'::jsonb else '{}'::jsonb end)::text,'sha256'),'hex');
 select * into previous from private.mutation_requests where family_id=f and request_id=p_request_id;
 if found then
 if previous.action<>p_action or previous.payload_hash<>hash then raise exception 'idempotency_conflict'; end if;
 return public.get_dashboard();
 end if;
 if p_action in ('child_save','habit_save','habit_delete','reward_save','reward_delete','family_save','rest_save','checkin_review','redemption_review','timer_review','device_save','manual_star_grant') and not is_parent then raise exception 'parent_required'; end if;
 obj:=nullif(p_payload->>'id','')::uuid;
 case p_action
 when 'child_save' then
 if obj is null then
 if (select count(*) from public.children where family_id=f)>=2 then raise exception 'two_children_maximum'; end if;
 insert into public.children(family_id,nickname,avatar,color,weekday_minutes,weekend_minutes) values(f,trim(p_payload->>'nickname'),coalesce(p_payload->>'avatar','fox'),coalesce(p_payload->>'color','#40A99A'),coalesce((p_payload->>'weekday_minutes')::integer,20),coalesce((p_payload->>'weekend_minutes')::integer,30)) returning id into obj;
 else
 update public.children set nickname=coalesce(trim(p_payload->>'nickname'),nickname),avatar=coalesce(p_payload->>'avatar',avatar),color=coalesce(p_payload->>'color',color),weekday_minutes=coalesce((p_payload->>'weekday_minutes')::integer,weekday_minutes),weekend_minutes=coalesce((p_payload->>'weekend_minutes')::integer,weekend_minutes) where id=obj and family_id=f;
 if not found then raise exception 'child_not_found'; end if;
 end if;
 when 'habit_save' then
 cid:=(p_payload->>'child_id')::uuid;
 if not exists(select 1 from public.children where id=cid and family_id=f) then raise exception 'child_not_found'; end if;
 if obj is null then
 insert into public.habits(family_id,child_id,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active)
 values(f,cid,trim(p_payload->>'name'),coalesce(p_payload->>'icon','star'),coalesce(p_payload->>'color','#40A99A'),case when p_payload?'weekdays' then array(select jsonb_array_elements_text(p_payload->'weekdays')::integer) else array[1,2,3,4,5,6,7] end,coalesce((p_payload->>'target_count')::integer,1),coalesce((p_payload->>'target_minutes')::integer,0),coalesce((p_payload->>'stars')::integer,1),coalesce((p_payload->>'requires_approval')::boolean,false),coalesce((p_payload->>'active')::boolean,true)) returning id into obj;
 else
 update public.habits set name=coalesce(trim(p_payload->>'name'),name),icon=coalesce(p_payload->>'icon',icon),color=coalesce(p_payload->>'color',color),weekdays=case when p_payload?'weekdays' then array(select jsonb_array_elements_text(p_payload->'weekdays')::integer) else weekdays end,target_count=coalesce((p_payload->>'target_count')::integer,target_count),target_minutes=coalesce((p_payload->>'target_minutes')::integer,target_minutes),stars=coalesce((p_payload->>'stars')::integer,stars),requires_approval=coalesce((p_payload->>'requires_approval')::boolean,requires_approval),active=coalesce((p_payload->>'active')::boolean,active),updated_at=now() where id=obj and child_id=cid and family_id=f and archived_at is null;
 if not found then raise exception 'habit_not_found'; end if;
 end if;
 when 'habit_delete' then
 update public.habits set active=false,archived_at=now(),updated_at=now() where id=obj and family_id=f;
 if not found then raise exception 'habit_not_found'; end if;
 when 'reward_save' then
 reward_kind:=coalesce(p_payload->>'kind',(select kind from public.rewards where id=obj and family_id=f),'activity');
 if reward_kind not in ('activity','device_time') then raise exception 'invalid_reward_kind'; end if;
 device_uuid:=null; secs:=null;
 if reward_kind='device_time' then
 device_uuid:=coalesce(nullif(p_payload->>'device_id','')::uuid,(select device_id from public.rewards where id=obj and family_id=f));
 secs:=coalesce((p_payload->>'duration_seconds')::integer,(select duration_seconds from public.rewards where id=obj and family_id=f));
 if device_uuid is null or not exists(select 1 from public.family_devices where id=device_uuid and family_id=f) then raise exception 'device_not_found'; end if;
 if secs is null or secs<60 or secs>10800 then raise exception 'invalid_device_duration'; end if;
 end if;
 cid:=nullif(p_payload->>'child_id','')::uuid;
 if cid is not null and not exists(select 1 from public.children where id=cid and family_id=f) then raise exception 'child_not_found'; end if;
 if obj is null then
 insert into public.rewards(family_id,child_id,name,cost,icon,active,kind,device_id,duration_seconds) values(f,cid,trim(p_payload->>'name'),(p_payload->>'cost')::integer,coalesce(p_payload->>'icon','gift'),coalesce((p_payload->>'active')::boolean,true),reward_kind,device_uuid,secs) returning id into obj;
 else
 update public.rewards set kind=reward_kind,device_id=device_uuid,duration_seconds=secs,child_id=cid,name=coalesce(trim(p_payload->>'name'),name),cost=coalesce((p_payload->>'cost')::integer,cost),icon=coalesce(p_payload->>'icon',icon),active=coalesce((p_payload->>'active')::boolean,active) where id=obj and family_id=f and archived_at is null;
 if not found then raise exception 'reward_not_found'; end if;
 end if;
 when 'reward_delete' then
 update public.rewards set active=false,archived_at=coalesce(archived_at,now()) where id=obj and family_id=f;
 if not found then raise exception 'reward_not_found'; end if;
 when 'family_save' then
 if p_payload?'timezone' and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'timezone') then raise exception 'invalid_timezone'; end if;
 update public.families set name=coalesce(trim(p_payload->>'name'),name),timezone=coalesce(p_payload->>'timezone',timezone) where id=f;
 if p_payload?'pin' then
 if p_payload->>'pin' !~ '^[0-9]{6,12}$' then raise exception 'pin_must_be_6_to_12_digits'; end if;
 update private.parent_security set pin_hash=extensions.crypt(p_payload->>'pin',extensions.gen_salt('bf',10)),failed_attempts=0,locked_until=null where family_id=f;
 delete from private.parent_sessions where family_id=f;
 end if;
 when 'rest_save' then
 cid:=(p_payload->>'child_id')::uuid; d:=(p_payload->>'day')::date;
 if d is null or d>today+366 then raise exception 'invalid_date'; end if;
 if not exists(select 1 from public.children where id=cid and family_id=f) then raise exception 'child_not_found'; end if;
 if coalesce((p_payload->>'is_rest')::boolean,true) then
 insert into public.rests(family_id,child_id,day,reason) values(f,cid,d,coalesce(p_payload->>'reason','')) on conflict(child_id,day) do update set reason=excluded.reason;
 else delete from public.rests where child_id=cid and day=d and family_id=f; end if;
 when 'checkin' then
 select * into h from public.habits where id=(p_payload->>'habit_id')::uuid and family_id=f;
 if h.id is null or h.archived_at is not null or not h.active then raise exception 'habit_not_active'; end if;
 d:=coalesce((p_payload->>'day')::date,today);
 if d>today or d<today-366 then raise exception 'invalid_date'; end if;
 if d<>today and (not is_parent or length(trim(coalesce(p_payload->>'reason','')))=0) then raise exception 'backfill_requires_parent_and_reason'; end if;
 if d<>today then
 select * into hv from public.habit_versions where habit_id=h.id and effective_day<=d order by effective_day desc limit 1;
 if hv.id is null then
 -- Explicit parent backfill also defines this habit from that day onward.
 insert into public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived)
 values(f,h.id,h.child_id,d,h.name,h.icon,h.color,h.weekdays,h.target_count,h.target_minutes,h.stars,h.requires_approval,h.active,false);
 else
 if not hv.active or hv.archived then raise exception 'habit_not_active_on_date'; end if;
 h.weekdays:=hv.weekdays; h.target_count:=hv.target_count; h.target_minutes:=hv.target_minutes; h.stars:=hv.stars; h.requires_approval:=hv.requires_approval;
 end if;
 end if;
 if not (extract(isodow from d)::integer=any(h.weekdays)) then raise exception 'not_scheduled_today'; end if;
 if exists(select 1 from public.rests where child_id=h.child_id and day=d) then raise exception 'rest_day'; end if;
 if (select count(*) from public.checkins where habit_id=h.id and day=d and status in ('pending','approved'))>=h.target_count then raise exception 'daily_goal_reached'; end if;
 insert into public.checkins(family_id,child_id,habit_id,day,status,stars,reason) values(f,h.child_id,h.id,d,case when h.requires_approval then 'pending' else 'approved' end,h.stars,coalesce(p_payload->>'reason','')) returning * into ci;
 obj:=ci.id;
 if ci.status='approved' then insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,ci.child_id,ci.stars,'checkin',ci.id); end if;
 when 'undo_checkin' then
 select * into ci from public.checkins where id=obj and family_id=f for update;
 if ci.id is null then raise exception 'checkin_not_found'; end if;
 if ci.day<>today and not is_parent then raise exception 'parent_required'; end if;
 if ci.status='approved' then
 select coalesce(sum(amount),0) into bal from public.star_ledger where child_id=ci.child_id;
 if bal<ci.stars and not is_parent then raise exception 'spent_stars_requires_parent'; end if;
 insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,ci.child_id,-ci.stars,'undo',ci.id) on conflict do nothing;
 end if;
 if ci.status in ('approved','pending') then update public.checkins set status='undone',reviewed_at=now() where id=ci.id; end if;
 when 'checkin_review' then
 select * into ci from public.checkins where id=obj and family_id=f for update;
 if ci.id is null then raise exception 'checkin_not_found'; end if;
 if ci.status<>'pending' then raise exception 'already_reviewed'; end if;
 update public.checkins set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end,reviewed_at=now() where id=ci.id;
 if (p_payload->>'approve')::boolean then insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,ci.child_id,ci.stars,'checkin',ci.id) on conflict do nothing; end if;
 when 'timer_start' then
 cid:=(p_payload->>'child_id')::uuid;
 select * into child from public.children where id=cid and family_id=f;
 if child.id is null then raise exception 'child_not_found'; end if;
 if exists(select 1 from public.timers where child_id=cid and status in ('running','paused')) then raise exception 'timer_already_running'; end if;
 if p_payload->>'kind'='game' then
 budget:=case when extract(isodow from today)>=6 then child.weekend_minutes else child.weekday_minutes end*60;
 select coalesce(sum(greatest(0,extract(epoch from least(ended_at,((today+1)::timestamp at time zone fam.timezone))-greatest(started_at,(today::timestamp at time zone fam.timezone))))),0)::integer into total from public.timers where child_id=cid and kind='game' and ended_at is not null and ended_at>(today::timestamp at time zone fam.timezone) and started_at<((today+1)::timestamp at time zone fam.timezone);
 budget:=budget-total; if budget<=0 then raise exception 'daily_game_time_used'; end if;
 elsif p_payload->>'kind'='focus' then
 budget:=coalesce((p_payload->>'target_seconds')::integer,300);
 if budget<60 or budget>7200 then raise exception 'invalid_focus_duration'; end if;
 else raise exception 'invalid_timer_kind'; end if;
 insert into public.timers(family_id,child_id,kind,target_seconds,day,started_at) values(f,cid,p_payload->>'kind',budget,today,action_now) returning id into obj;
 when 'timer_pause','timer_resume','timer_finish' then
 select * into tm from public.timers where id=obj and family_id=f for update;
 if tm.id is null then raise exception 'timer_not_found'; end if;
 if p_action='timer_pause' then
 if tm.kind='game' then raise exception 'game_timer_cannot_pause'; end if;
 if tm.status='running' then update public.timers set status='paused',paused_at=action_now where id=tm.id; end if;
 elsif p_action='timer_resume' then
 if tm.status='paused' then update public.timers set status='running',paused_seconds=paused_seconds+greatest(0,extract(epoch from action_now-paused_at)),paused_at=null where id=tm.id; end if;
 else
 if tm.status in ('running','paused') then
 elapsed:=greatest(0,floor(extract(epoch from coalesce(tm.paused_at,action_now)-tm.started_at)-tm.paused_seconds))::integer;
 update public.timers set ended_at=action_now,actual_seconds=elapsed,status=case when tm.kind='focus' and elapsed>=tm.target_seconds then 'completed' when tm.kind='game' and coalesce((p_payload->>'kept_agreement')::boolean,false) and elapsed<=tm.target_seconds+60 then 'completed' else 'stopped' end,
 kept_agreement=case when tm.kind='game' then coalesce((p_payload->>'kept_agreement')::boolean,false) and elapsed<=tm.target_seconds+60 else null end where id=tm.id;
 end if;
 end if;
 when 'timer_review' then
 update public.timers set kept_agreement=(p_payload->>'kept_agreement')::boolean,status=case when (p_payload->>'kept_agreement')::boolean then 'completed' else 'stopped' end,reason=coalesce(p_payload->>'reason','') where id=obj and family_id=f and kind='game' and ended_at is not null;
 if not found then raise exception 'timer_not_found'; end if;
 when 'redeem' then
 cid:=(p_payload->>'child_id')::uuid;
 if not exists(select 1 from public.children where id=cid and family_id=f) then raise exception 'child_not_found'; end if;
 select * into rw from public.rewards where id=(p_payload->>'reward_id')::uuid and family_id=f and active and (child_id is null or child_id=cid);
 if rw.id is null then raise exception 'reward_not_found'; end if;
 select coalesce(sum(amount),0) into bal from public.star_ledger where child_id=cid;
 if bal<rw.cost then raise exception 'insufficient_stars'; end if;
 if rw.kind='device_time' then
 select * into device from public.family_devices where id=rw.device_id and family_id=f and active;
 if device.id is null then raise exception 'device_inactive'; end if;
 end if;
 insert into public.redemptions(family_id,child_id,reward_id,reward_name,cost,kind,device_id,device_name,duration_seconds) values(f,cid,rw.id,rw.name,rw.cost,rw.kind,rw.device_id,case when rw.kind='device_time' then device.name else null end,rw.duration_seconds) returning * into rd;
 obj:=rd.id;
 insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,cid,-rw.cost,'redemption',rd.id);
 when 'redemption_review' then
 select * into rd from public.redemptions where id=obj and family_id=f for update;
 if rd.id is null then raise exception 'redemption_not_found'; end if;
 if rd.status<>'pending' then raise exception 'already_reviewed'; end if;
 update public.redemptions set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end,reviewed_at=now() where id=rd.id;
 if coalesce((p_payload->>'approve')::boolean,false) and rd.kind='device_time' then
 insert into public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) values(f,rd.child_id,rd.device_id,rd.duration_seconds,'grant',rd.id);
 end if;
 if not coalesce((p_payload->>'approve')::boolean,false) then insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,rd.child_id,rd.cost,'refund',rd.id) on conflict do nothing; end if;
 when 'device_save' then
 if obj is null then
 insert into public.family_devices(family_id,name,active) values(f,trim(p_payload->>'name'),coalesce((p_payload->>'active')::boolean,true)) returning id into obj;
 else
 update public.family_devices set name=coalesce(trim(p_payload->>'name'),name),active=coalesce((p_payload->>'active')::boolean,active) where id=obj and family_id=f;
 if not found then raise exception 'device_not_found'; end if;
 end if;
 when 'manual_star_grant' then
 cid:=(p_payload->>'child_id')::uuid;
 if not exists(select 1 from public.children where id=cid and family_id=f) then raise exception 'child_not_found'; end if;
 -- Integer casts reject fractional strings; explicit JSON validation also rejects numeric 1.5.
 if coalesce(jsonb_typeof(p_payload->'amount'),'')<>'number' or (p_payload->>'amount')::numeric<>trunc((p_payload->>'amount')::numeric) or (p_payload->>'amount')::numeric not between 1 and 10000 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(trim(coalesce(p_payload->>'reason',''))) not between 1 and 300 then raise exception 'invalid_star_grant'; end if;
 insert into public.manual_star_grants(family_id,child_id,amount,reason,actor_id,request_id,created_at) values(f,cid,(p_payload->>'amount')::integer,trim(p_payload->>'reason'),auth.uid(),p_request_id,action_now) returning * into grant_row;
 obj:=grant_row.id;
 insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,cid,grant_row.amount,'manual_bonus',obj);
 when 'device_time_start' then
 cid:=(p_payload->>'child_id')::uuid; device_uuid:=(p_payload->>'device_id')::uuid;
 if not exists(select 1 from public.children where id=cid and family_id=f) then raise exception 'child_not_found'; end if;
 select * into device from public.family_devices where id=device_uuid and family_id=f and active;
 if device.id is null then raise exception 'device_inactive'; end if;
 if coalesce(jsonb_typeof(p_payload->'seconds'),'')<>'number' or (p_payload->>'seconds')::numeric<>trunc((p_payload->>'seconds')::numeric) or (p_payload->>'seconds')::numeric not between 1 and 10800 then raise exception 'invalid_device_duration'; end if;
 secs:=(p_payload->>'seconds')::integer;
 if exists(select 1 from public.device_usage_sessions where child_id=cid and status='running') then raise exception 'device_time_already_running'; end if;
 select coalesce(sum(seconds_delta),0) into bal from public.device_time_ledger where child_id=cid and device_id=device_uuid;
 if bal<secs then raise exception 'insufficient_device_time'; end if;
 insert into public.device_usage_sessions(family_id,child_id,device_id,device_name,reserved_seconds,started_at,deadline_at,request_id) values(f,cid,device_uuid,device.name,secs,action_now,action_now+secs*interval '1 second',p_request_id) returning id into obj;
 insert into public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) values(f,cid,device_uuid,-secs,'reserve',obj);
 when 'device_time_stop' then
 select * into usage from public.device_usage_sessions where id=obj and family_id=f for update;
 if usage.id is null then raise exception 'device_usage_not_found'; end if;
 if usage.status='running' then
 elapsed:=least(usage.reserved_seconds,greatest(0,floor(extract(epoch from action_now-usage.started_at))::integer));
 if usage.reserved_seconds>elapsed then
 insert into public.device_time_ledger(family_id,child_id,device_id,seconds_delta,source_type,source_id) values(f,usage.child_id,usage.device_id,usage.reserved_seconds-elapsed,'refund',usage.id);
 end if;
 update public.device_usage_sessions set status='stopped',ended_at=action_now,actual_seconds=elapsed where id=usage.id;
 end if;
 else raise exception 'unknown_action';
 end case;
 insert into private.mutation_requests(family_id,request_id,action,payload_hash) values(f,p_request_id,p_action,hash);
 insert into private.audit_log(family_id,actor_id,action,object_id) values(f,auth.uid(),p_action,obj);
 return public.get_dashboard();
end $$;
