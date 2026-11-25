-- Automatic private habit audio. Dedicated NOLOGIN role; audio stays in database backups.
CREATE ROLE growth_voice_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE TABLE private.habit_voice_worker_health(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),state text NOT NULL CHECK(state IN ('available','waiting_resources','error')),seen_at timestamptz NOT NULL);
REVOKE ALL ON private.habit_voice_worker_health FROM PUBLIC,anon,authenticated,growth_app,growth_voice_worker;
CREATE TABLE private.habit_voice_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),family_id uuid NOT NULL REFERENCES public.families(id),
 text_hash text NOT NULL, text_value text NOT NULL CHECK(char_length(text_value) BETWEEN 1 AND 160),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','ready','failed')),
 revision integer NOT NULL DEFAULT 0,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token uuid,lease_until timestamptz,audio bytea,audio_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(family_id,text_hash));
REVOKE ALL ON private.habit_voice_jobs FROM PUBLIC,anon,authenticated,growth_app,growth_voice_worker;
CREATE FUNCTION private.habit_voice_text(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT btrim(regexp_replace(translate(normalize(t,NFC),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF','                         '),' +',' ','g'))
$$;
CREATE FUNCTION private.habit_voice_hash(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(extensions.digest('["habit-voice-v1","qwen3-tts-base1.7b-cpu-v1","synthetic-d2799d22-v1",'||to_json(private.habit_voice_text(t))::text||']','sha256'),'hex')
$$;
CREATE FUNCTION private.habit_voice_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t text;
BEGIN
 IF NEW.archived_at IS NULL AND NEW.active THEN
 t:=private.habit_voice_text(NEW.name);
 IF char_length(t) BETWEEN 1 AND 160 THEN
 INSERT INTO private.habit_voice_jobs(family_id,text_hash,text_value) VALUES(NEW.family_id,private.habit_voice_hash(t),t) ON CONFLICT DO NOTHING;
 END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER habit_voice_enqueue AFTER INSERT OR UPDATE OF name,active ON public.habits FOR EACH ROW EXECUTE FUNCTION private.habit_voice_enqueue();
INSERT INTO private.habit_voice_jobs(family_id,text_hash,text_value)
 SELECT DISTINCT family_id,private.habit_voice_hash(name),private.habit_voice_text(name) FROM public.habits
 WHERE active AND archived_at IS NULL AND char_length(private.habit_voice_text(name)) BETWEEN 1 AND 160 ON CONFLICT DO NOTHING;
CREATE FUNCTION public.habit_voice_read(hid uuid,cid uuid,p_parent text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.habits%rowtype;j private.habit_voice_jobs%rowtype;f uuid;
BEGIN
 f:=private.owned_family();
 SELECT * INTO h FROM public.habits WHERE id=hid AND family_id=f AND child_id=cid AND archived_at IS NULL AND active;
 IF h.id IS NULL THEN RAISE EXCEPTION 'habit_not_found';END IF;
 PERFORM private.child_spending_guard(f,cid,p_parent);
 SELECT * INTO j FROM private.habit_voice_jobs WHERE family_id=f AND text_hash=private.habit_voice_hash(h.name);
 RETURN jsonb_build_object('worker_state',(SELECT CASE WHEN seen_at < clock_timestamp()-interval '5 minutes' THEN 'offline' ELSE state END FROM private.habit_voice_worker_health WHERE singleton),'text',j.text_value,'state',coalesce(j.state,'unavailable'),'text_hash',j.text_hash,'audio_base64',CASE WHEN j.state='ready' THEN encode(j.audio,'base64') ELSE NULL END);
END $$;

CREATE FUNCTION private.voice_u32(b bytea,p integer) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT get_byte(b,p)::bigint + get_byte(b,p+1)::bigint*256 + get_byte(b,p+2)::bigint*65536 + get_byte(b,p+3)::bigint*16777216
$$;
CREATE FUNCTION private.voice_wav_valid(b bytea) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE pos integer:=12;n bigint;tag bytea;fmt boolean:=false;dat boolean:=false;channels integer;rate bigint;align integer;data_size bigint;
BEGIN
 IF b IS NULL OR octet_length(b) NOT BETWEEN 44 AND 4194304 THEN RETURN false;END IF;
 IF substring(b FROM 1 FOR 4)<>decode('52494646','hex') OR substring(b FROM 9 FOR 4)<>decode('57415645','hex') OR private.voice_u32(b,4)+8<>octet_length(b) THEN RETURN false;END IF;
 WHILE pos+8<=octet_length(b) LOOP
 tag:=substring(b FROM pos+1 FOR 4);n:=private.voice_u32(b,pos+4);pos:=pos+8;
 IF pos+n>octet_length(b) THEN RETURN false;END IF;
 IF tag=decode('666d7420','hex') THEN
 IF fmt OR n<16 OR get_byte(b,pos)<>1 OR get_byte(b,pos+1)<>0 THEN RETURN false;END IF;
 channels:=get_byte(b,pos+2)+get_byte(b,pos+3)*256;rate:=private.voice_u32(b,pos+4);
 align:=get_byte(b,pos+12)+get_byte(b,pos+13)*256;
 IF channels NOT IN (1,2) OR rate NOT IN (16000,22050,24000,44100,48000) OR get_byte(b,pos+14)<>16 OR get_byte(b,pos+15)<>0 OR align<>channels*2 OR private.voice_u32(b,pos+8)<>rate*align THEN RETURN false;END IF;
 fmt:=true;
 ELSIF tag=decode('64617461','hex') THEN
 IF dat OR n=0 THEN RETURN false;END IF;dat:=true;data_size:=n;
 END IF;
 pos:=pos+n::integer+(n%2)::integer;
 END LOOP;
 RETURN pos=octet_length(b) AND fmt AND dat AND data_size%align=0 AND data_size<=rate*align*120;
END $$;
REVOKE ALL ON FUNCTION private.voice_u32(bytea,integer),private.voice_wav_valid(bytea) FROM PUBLIC,anon,authenticated,growth_app,growth_voice_worker;

CREATE FUNCTION public.habit_voice_work(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.habit_voice_jobs%rowtype; act text:=p->>'action'; b bytea;ah text;
BEGIN
 IF act='heartbeat' THEN
 IF p->>'state' NOT IN ('available','waiting_resources','error') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 INSERT INTO private.habit_voice_worker_health VALUES(true,p->>'state',clock_timestamp()) ON CONFLICT(singleton) DO UPDATE SET state=excluded.state,seen_at=excluded.seen_at;
 RETURN jsonb_build_object('state','ok');
 END IF;
 IF act='claim' THEN
 UPDATE private.habit_voice_jobs SET state='failed',lease_until=NULL WHERE state='leased' AND lease_until<=clock_timestamp() AND attempts>=3;
 SELECT * INTO j FROM private.habit_voice_jobs WHERE (state='pending' OR (state='leased' AND lease_until<=clock_timestamp())) AND attempts<3 AND EXISTS(SELECT 1 FROM public.habits h WHERE h.family_id=habit_voice_jobs.family_id AND h.active AND h.archived_at IS NULL AND private.habit_voice_hash(h.name)=habit_voice_jobs.text_hash) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF j.id IS NULL THEN RETURN jsonb_build_object('state','empty');END IF;
 UPDATE private.habit_voice_jobs SET state='leased',revision=revision+1,attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 minutes' WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object('job_id',j.id,'revision',j.revision,'lease_token',j.lease_token,'lease_until',j.lease_until,'text',j.text_value,'text_hash',j.text_hash,'model_version','qwen3-tts-base1.7b-cpu-v1','voice_version','synthetic-d2799d22-v1');
 END IF;
 SELECT * INTO j FROM private.habit_voice_jobs WHERE id=(p->>'job_id')::uuid FOR UPDATE;
 IF j.id IS NULL OR j.lease_token IS DISTINCT FROM (p->>'lease_token')::uuid OR j.revision IS DISTINCT FROM (p->>'revision')::integer THEN RAISE EXCEPTION 'lease_conflict';END IF;
 IF act='status' THEN RETURN jsonb_build_object('state',CASE WHEN j.state='leased' AND j.lease_until<=clock_timestamp() THEN 'expired' ELSE j.state END,'committed',j.state='ready');END IF;
 IF act='complete' AND j.state='ready' THEN
 IF encode(extensions.digest(decode(p->>'audio_base64','base64'),'sha256'),'hex') IS DISTINCT FROM j.audio_hash THEN RAISE EXCEPTION 'audio_conflict';END IF;
 RETURN jsonb_build_object('state','ready','committed',true);END IF;
 IF j.state<>'leased' OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_expired';END IF;
 IF act='complete' THEN
 b:=decode(p->>'audio_base64','base64');
 IF NOT private.voice_wav_valid(b) THEN RAISE EXCEPTION 'invalid_audio';END IF;
 ah:=encode(extensions.digest(b,'sha256'),'hex');
 UPDATE private.habit_voice_jobs SET audio=b,audio_hash=ah,state='ready',lease_until=NULL WHERE id=j.id;
 RETURN jsonb_build_object('state','ready','committed',true);
 ELSIF act='fail' THEN
 IF p->>'error_code' NOT IN ('generation_failed','invalid_audio') THEN RAISE EXCEPTION 'invalid_error';END IF;
 UPDATE private.habit_voice_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,lease_until=NULL WHERE id=j.id;
 RETURN jsonb_build_object('state',CASE WHEN j.attempts>=3 THEN 'failed' ELSE 'pending' END);
 ELSE RAISE EXCEPTION 'invalid_action';END IF;
END $$;
REVOKE ALL ON FUNCTION public.habit_voice_read(uuid,uuid,text),public.habit_voice_work(jsonb),private.habit_voice_enqueue(),private.habit_voice_text(text),private.habit_voice_hash(text) FROM PUBLIC,anon,authenticated,growth_app,growth_voice_worker;
GRANT EXECUTE ON FUNCTION public.habit_voice_read(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.habit_voice_work(jsonb) TO growth_voice_worker;
