-- Distinguish reversible pause from prior remove operations without rewriting reward snapshots.
ALTER TABLE public.rewards ADD COLUMN archived_at timestamptz;
-- Before this migration active=false could only be produced by reward_delete.
-- This is a migration marker, not a reconstructed historical deletion timestamp.
UPDATE public.rewards SET archived_at=now() WHERE active=false;
-- Preserve all existing actions and permissions; allow parent reward_save to persist active.
create or replace function public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f uuid; fam public.families%rowtype; child public.children%rowtype; h public.habits%rowtype; ci public.checkins%rowtype;
 tm public.timers%rowtype; rw public.rewards%rowtype; rd public.redemptions%rowtype; hv public.habit_versions%rowtype;
 obj uuid; cid uuid; d date; today date; is_parent boolean; elapsed integer; total integer; budget integer; bal bigint; hash text; previous private.mutation_requests%rowtype;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'invalid_request'; end if;
 if octet_length(p_payload::text)>12000 then raise exception 'payload_too_large'; end if;
 select * into fam from public.families where owner_id=auth.uid() for update;
 f:=fam.id; if f is null then raise exception 'family_not_found'; end if;
 today:=(now() at time zone fam.timezone)::date;
 is_parent:=private.parent_valid(f,p_parent_token);
 -- Never put a fast unsalted hash of the low-entropy PIN into request logs.
 hash:=encode(extensions.digest(((p_payload-'pin') || case when p_payload?'pin' then '{"pin_change":true}'::jsonb else '{}'::jsonb end)::text,'sha256'),'hex');
 select * into previous from private.mutation_requests where family_id=f and request_id=p_request_id;
 if found then
 if previous.action<>p_action or previous.payload_hash<>hash then raise exception 'idempotency_conflict'; end if;
 return public.get_dashboard();
 end if;
 if p_action in ('child_save','habit_save','habit_delete','reward_save','reward_delete','family_save','rest_save','checkin_review','redemption_review','timer_review') and not is_parent then raise exception 'parent_required'; end if;
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
 cid:=nullif(p_payload->>'child_id','')::uuid;
 if cid is not null and not exists(select 1 from public.children where id=cid and family_id=f) then raise exception 'child_not_found'; end if;
 if obj is null then
 insert into public.rewards(family_id,child_id,name,cost,icon,active) values(f,cid,trim(p_payload->>'name'),(p_payload->>'cost')::integer,coalesce(p_payload->>'icon','gift'),coalesce((p_payload->>'active')::boolean,true)) returning id into obj;
 else
 update public.rewards set child_id=cid,name=coalesce(trim(p_payload->>'name'),name),cost=coalesce((p_payload->>'cost')::integer,cost),icon=coalesce(p_payload->>'icon',icon),active=coalesce((p_payload->>'active')::boolean,active) where id=obj and family_id=f and archived_at is null;
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
 insert into public.timers(family_id,child_id,kind,target_seconds,day) values(f,cid,p_payload->>'kind',budget,today) returning id into obj;
 when 'timer_pause','timer_resume','timer_finish' then
 select * into tm from public.timers where id=obj and family_id=f for update;
 if tm.id is null then raise exception 'timer_not_found'; end if;
 if p_action='timer_pause' then
 if tm.kind='game' then raise exception 'game_timer_cannot_pause'; end if;
 if tm.status='running' then update public.timers set status='paused',paused_at=now() where id=tm.id; end if;
 elsif p_action='timer_resume' then
 if tm.status='paused' then update public.timers set status='running',paused_seconds=paused_seconds+greatest(0,extract(epoch from now()-paused_at)),paused_at=null where id=tm.id; end if;
 else
 if tm.status in ('running','paused') then
 elapsed:=greatest(0,floor(extract(epoch from coalesce(tm.paused_at,now())-tm.started_at)-tm.paused_seconds))::integer;
 update public.timers set ended_at=now(),actual_seconds=elapsed,status=case when tm.kind='focus' and elapsed>=tm.target_seconds then 'completed' when tm.kind='game' and coalesce((p_payload->>'kept_agreement')::boolean,false) and elapsed<=tm.target_seconds+60 then 'completed' else 'stopped' end,
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
 insert into public.redemptions(family_id,child_id,reward_id,reward_name,cost) values(f,cid,rw.id,rw.name,rw.cost) returning * into rd;
 obj:=rd.id;
 insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,cid,-rw.cost,'redemption',rd.id);
 when 'redemption_review' then
 select * into rd from public.redemptions where id=obj and family_id=f for update;
 if rd.id is null then raise exception 'redemption_not_found'; end if;
 if rd.status<>'pending' then raise exception 'already_reviewed'; end if;
 update public.redemptions set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end,reviewed_at=now() where id=rd.id;
 if not coalesce((p_payload->>'approve')::boolean,false) then insert into public.star_ledger(family_id,child_id,amount,source_type,source_id) values(f,rd.child_id,rd.cost,'refund',rd.id) on conflict do nothing; end if;
 else raise exception 'unknown_action';
 end case;
 insert into private.mutation_requests(family_id,request_id,action,payload_hash) values(f,p_request_id,p_action,hash);
 insert into private.audit_log(family_id,actor_id,action,object_id) values(f,auth.uid(),p_action,obj);
 return public.get_dashboard();
end $$;
