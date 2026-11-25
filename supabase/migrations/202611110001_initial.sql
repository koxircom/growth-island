-- Growth Island: relational persistence, owner RLS and RPC-only transactional writes.
-- Run with Supabase migration role. Requires Supabase Auth's auth.users/auth.uid().
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.families (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 40), timezone text not null default 'Asia/Shanghai', created_at timestamptz not null default now()
);
create table private.parent_security (
 family_id uuid primary key references public.families on delete cascade, pin_hash text not null,
 failed_attempts integer not null default 0, locked_until timestamptz
);
create table private.parent_sessions (
 token_hash text primary key, family_id uuid not null references public.families on delete cascade,
 user_id uuid not null, expires_at timestamptz not null
);
create table public.children (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 nickname text not null check(length(nickname) between 1 and 20), avatar text not null default 'fox' check(length(avatar)<=30),
 color text not null default '#40A99A' check(color ~ '^#[0-9a-fA-F]{6}$'),
 weekday_minutes integer not null default 20 check(weekday_minutes between 0 and 180),
 weekend_minutes integer not null default 30 check(weekend_minutes between 0 and 180),
 created_at timestamptz not null default now(), unique(id,family_id)
);
create table public.habits (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 child_id uuid not null, name text not null check(length(name) between 1 and 60), icon text not null default 'star' check(length(icon)<=30),
 color text not null default '#40A99A' check(color ~ '^#[0-9a-fA-F]{6}$'), weekdays integer[] not null default array[1,2,3,4,5,6,7]
 check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]),
 target_count integer not null default 1 check(target_count between 1 and 20), target_minutes integer not null default 0 check(target_minutes between 0 and 120),
 stars integer not null default 1 check(stars between 0 and 20), requires_approval boolean not null default false, active boolean not null default true,
 archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(child_id,family_id) references public.children(id,family_id), unique(id,child_id,family_id)
);
-- Effective-day versions keep historic completion denominators stable after edits.
create table public.habit_versions (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 habit_id uuid not null, child_id uuid not null, effective_day date not null,
 name text not null, icon text not null, color text not null, weekdays integer[] not null,
 target_count integer not null, target_minutes integer not null, stars integer not null,
 requires_approval boolean not null, active boolean not null, archived boolean not null,
 foreign key(habit_id,child_id,family_id) references public.habits(id,child_id,family_id), unique(habit_id,effective_day)
);
create function private.record_habit_version() returns trigger language plpgsql security definer set search_path='' as $$
declare d date;
begin
 select (now() at time zone timezone)::date into d from public.families where id=new.family_id;
 insert into public.habit_versions(family_id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived)
 values(new.family_id,new.id,new.child_id,d,new.name,new.icon,new.color,new.weekdays,new.target_count,new.target_minutes,new.stars,new.requires_approval,new.active,new.archived_at is not null)
 on conflict(habit_id,effective_day) do update set name=excluded.name,icon=excluded.icon,color=excluded.color,weekdays=excluded.weekdays,target_count=excluded.target_count,target_minutes=excluded.target_minutes,stars=excluded.stars,requires_approval=excluded.requires_approval,active=excluded.active,archived=excluded.archived;
 return new;
end $$;
revoke all on function private.record_habit_version() from public;
create trigger habit_version_saved after insert or update on public.habits for each row execute function private.record_habit_version();
create table public.checkins (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 child_id uuid not null, habit_id uuid not null, day date not null,
 status text not null check(status in ('pending','approved','rejected','undone')),
 stars integer not null check(stars between 0 and 20), reason text not null default '' check(length(reason)<=500),
 created_at timestamptz not null default now(), reviewed_at timestamptz,
 foreign key(habit_id,child_id,family_id) references public.habits(id,child_id,family_id), unique(id,family_id)
);
create index checkins_day on public.checkins(child_id,day);
create table public.timers (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 child_id uuid not null, kind text not null check(kind in ('focus','game')), target_seconds integer not null check(target_seconds between 1 and 10800),
 day date not null, started_at timestamptz not null default now(), paused_at timestamptz, paused_seconds numeric not null default 0 check(paused_seconds>=0),
 ended_at timestamptz, actual_seconds integer not null default 0 check(actual_seconds>=0),
 status text not null default 'running' check(status in ('running','paused','completed','stopped')),
 kept_agreement boolean, reason text not null default '' check(length(reason)<=500),
 foreign key(child_id,family_id) references public.children(id,family_id), unique(id,family_id)
);
create unique index one_active_timer_per_child on public.timers(child_id) where status in ('running','paused');
create table public.rewards (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 child_id uuid, name text not null check(length(name) between 1 and 60), icon text not null default 'gift' check(length(icon)<=30),
 cost integer not null check(cost between 1 and 10000), active boolean not null default true, created_at timestamptz not null default now(),
 foreign key(child_id,family_id) references public.children(id,family_id), unique(id,family_id)
);
create table public.redemptions (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 child_id uuid not null, reward_id uuid not null, reward_name text not null, cost integer not null check(cost>0),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), reviewed_at timestamptz,
 foreign key(child_id,family_id) references public.children(id,family_id), foreign key(reward_id,family_id) references public.rewards(id,family_id), unique(id,family_id)
);
create table public.rests (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade,
 child_id uuid not null, day date not null, reason text not null default '' check(length(reason)<=500),
 foreign key(child_id,family_id) references public.children(id,family_id), unique(child_id,day)
);
create table public.star_ledger (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families on delete cascade, child_id uuid not null,
 amount integer not null, source_type text not null check(source_type in ('checkin','undo','redemption','refund')),
 source_id uuid not null, created_at timestamptz not null default now(),
 foreign key(child_id,family_id) references public.children(id,family_id), unique(source_type,source_id)
);
create table private.mutation_requests (
 family_id uuid not null references public.families on delete cascade, request_id uuid not null,
 action text not null, payload_hash text not null, created_at timestamptz not null default now(), primary key(family_id,request_id)
);
create table private.audit_log (
 id bigint generated always as identity primary key, family_id uuid not null references public.families on delete cascade,
 actor_id uuid not null, action text not null, object_id uuid, occurred_at timestamptz not null default now()
);

-- Safe helper: all tables including private tables are protected from browser writes.
create function private.owned_family() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.families where owner_id=auth.uid()
$$;
revoke all on function private.owned_family() from public;
create function public.current_family_id() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.families where owner_id=auth.uid()
$$;
revoke all on function public.current_family_id() from public;
grant execute on function public.current_family_id() to authenticated;
alter table public.families enable row level security;
create policy own_family_read on public.families for select to authenticated using(owner_id=auth.uid());
do $$ declare t text; begin
 foreach t in array array['children','habits','habit_versions','checkins','timers','rewards','redemptions','rests','star_ledger'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy family_read on public.%I for select to authenticated using (family_id=public.current_family_id())',t);
 end loop;
end $$;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on public.families,public.children,public.habits,public.habit_versions,public.checkins,public.timers,public.rewards,public.redemptions,public.rests,public.star_ledger from anon,authenticated;
grant select on public.families,public.children,public.habits,public.habit_versions,public.checkins,public.timers,public.rewards,public.redemptions,public.rests,public.star_ledger to authenticated;

create function public.create_family(p_name text,p_pin text,p_timezone text default 'Asia/Shanghai') returns uuid
language plpgsql security definer set search_path='' as $$
declare f uuid; c uuid; i integer; j integer; names text[]:=array['主动开始写作业','完成一段专注学习','到时间主动结束游戏','整理书包','整理玩具或书桌','自主阅读','按时睡觉','运动或户外活动']; icons text[]:=array['pencil','timer','gamepad','backpack','sparkles','book','moon','sun'];
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if p_pin !~ '^[0-9]{6,12}$' or p_pin is null then raise exception 'pin_must_be_6_to_12_digits'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_timezone'; end if;
 insert into public.families(owner_id,name,timezone) values(auth.uid(),trim(p_name),p_timezone) returning id into f;
 insert into private.parent_security(family_id,pin_hash) values(f,extensions.crypt(p_pin,extensions.gen_salt('bf',10)));
 for i in 1..2 loop
 insert into public.children(family_id,nickname,avatar,color) values(f,case i when 1 then '星星' else '月亮' end,case i when 1 then 'fox' else 'bear' end,case i when 1 then '#40A99A' else '#F28B73' end) returning id into c;
 for j in 1..8 loop
 insert into public.habits(family_id,child_id,name,icon,stars,target_minutes,requires_approval)
 values(f,c,names[j],icons[j],case when j in (1,2,3) then 2 else 1 end,case when j=2 then 5 when j=6 then 10 else 0 end,j in (3,7));
 end loop;
 end loop;
 insert into public.rewards(family_id,name,cost,icon) values(f,'一起搭积木',12,'blocks'),(f,'选择周末亲子活动',25,'sun'),(f,'一起读一本新故事',8,'book');
 return f;
end $$;

create function public.unlock_parent(p_pin text) returns text language plpgsql security definer set search_path='' as $$
declare f uuid; s private.parent_security%rowtype; token text;
begin
 f:=private.owned_family(); if f is null then raise exception 'family_not_found'; end if;
 select * into s from private.parent_security where family_id=f for update;
 if s.locked_until>now() then return null; end if;
 if p_pin is null or length(p_pin)>12 or s.pin_hash<>extensions.crypt(p_pin,s.pin_hash) then
 update private.parent_security set failed_attempts=case when failed_attempts>=4 then 0 else failed_attempts+1 end,
 locked_until=case when failed_attempts>=4 then now()+interval '5 minutes' else null end where family_id=f;
 return null;
 end if;
 update private.parent_security set failed_attempts=0,locked_until=null where family_id=f;
 delete from private.parent_sessions where expires_at<now();
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.parent_sessions(token_hash,family_id,user_id,expires_at) values(encode(extensions.digest(token,'sha256'),'hex'),f,auth.uid(),now()+interval '30 minutes');
 return token;
end $$;
create function private.parent_valid(f uuid,t text) returns boolean language sql stable security definer set search_path='' as $$
 select t is not null and exists(select 1 from private.parent_sessions where token_hash=encode(extensions.digest(t,'sha256'),'hex') and family_id=f and user_id=auth.uid() and expires_at>now())
$$;
revoke all on function private.parent_valid(uuid,text) from public;

create function public.get_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 'star_balances',coalesce((select jsonb_agg(to_jsonb(b)) from(select c.id child_id,coalesce(sum(l.amount),0) balance,coalesce(sum(l.amount) filter(where l.source_type in ('checkin','undo')),0) earned from public.children c left join public.star_ledger l on l.child_id=c.id where c.family_id=f group by c.id)b),'[]')
 ) into result;
 return result;
end $$;

create function public.family_mutate(p_action text,p_payload jsonb,p_request_id uuid,p_parent_token text default null) returns jsonb
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
 insert into public.rewards(family_id,child_id,name,cost,icon) values(f,cid,trim(p_payload->>'name'),(p_payload->>'cost')::integer,coalesce(p_payload->>'icon','gift')) returning id into obj;
 else
 update public.rewards set child_id=cid,name=coalesce(trim(p_payload->>'name'),name),cost=coalesce((p_payload->>'cost')::integer,cost),icon=coalesce(p_payload->>'icon',icon) where id=obj and family_id=f;
 if not found then raise exception 'reward_not_found'; end if;
 end if;
 when 'reward_delete' then
 update public.rewards set active=false where id=obj and family_id=f;
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

revoke all on function public.create_family(text,text,text),public.unlock_parent(text),public.get_dashboard(),public.family_mutate(text,jsonb,uuid,text) from public,anon;
grant execute on function public.create_family(text,text,text),public.unlock_parent(text),public.get_dashboard(),public.family_mutate(text,jsonb,uuid,text) to authenticated;
-- No browser can manipulate the ledger, elevate parent mode or bypass family scoping with direct table writes.
