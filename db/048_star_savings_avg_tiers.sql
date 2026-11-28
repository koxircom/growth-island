-- Upgrade weekly savings interest to 7-day average EOD balance and 5 tiers (20->1, 40->2, 60->3, 80->4, 100->6).
CREATE OR REPLACE FUNCTION private.savings_award_v2(avg_bal numeric) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT CASE
  WHEN avg_bal >= 100 THEN 6
  WHEN avg_bal >= 80 THEN 4
  WHEN avg_bal >= 60 THEN 3
  WHEN avg_bal >= 40 THEN 2
  WHEN avg_bal >= 20 THEN 1
  ELSE 0
 END
$$;
REVOKE ALL ON FUNCTION private.savings_award_v2(numeric) FROM PUBLIC,anon,authenticated,growth_app;

CREATE OR REPLACE FUNCTION private.weekly_average_eod_balance(p_child uuid, p_week_start date, p_tz text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH cutoff_check AS (
  SELECT EXISTS(
   SELECT 1 FROM private.star_balance_samples
   WHERE child_id = p_child AND observed_at <= ((p_week_start + 7)::timestamp AT TIME ZONE p_tz)
  ) AS has_sample
 ),
 days AS (
  SELECT (p_week_start + g)::date AS d FROM generate_series(0, 6) AS g
 ),
 daily AS (
  SELECT coalesce((
   SELECT b.balance FROM private.star_balance_samples b
   WHERE b.child_id = p_child AND b.observed_at <= ((days.d + 1)::timestamp AT TIME ZONE p_tz)
   ORDER BY b.observed_at DESC, b.seq DESC LIMIT 1
  ), 0)::numeric AS bal
  FROM days
 )
 SELECT CASE WHEN (SELECT has_sample FROM cutoff_check) THEN round(avg(bal), 1) ELSE NULL END FROM daily
$$;
REVOKE ALL ON FUNCTION private.weekly_average_eod_balance(uuid,date,text) FROM PUBLIC,anon,authenticated,growth_app;

CREATE OR REPLACE FUNCTION private.settle_star_family(f uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cur private.star_settlement_cursor%rowtype; rule public.star_rule_versions%rowtype;
 d date; w date; today date; cutoff timestamptz; starts timestamptz; hid uuid; h jsonb; n integer; qualified integer; award integer; used integer;
 low bigint; opening bigint; avg_bal numeric; count_days integer; count_weeks integer; processed integer:=0; details jsonb; state_details jsonb; habits_snapshot jsonb; rests_snapshot jsonb; checkins_snapshot jsonb;
BEGIN
 -- Caller holds the family lock. Bounded catch-up with durable cursors; never discard a day.
 FOR cur IN SELECT * FROM private.star_settlement_cursor c WHERE family_id=f AND
   (last_day<least((clock_timestamp() AT TIME ZONE timezone)::date,coalesce(end_day,'infinity'::date))-1
    OR last_week+14<=least((clock_timestamp() AT TIME ZONE timezone)::date,coalesce(end_week,'infinity'::date)))
   ORDER BY last_day,id LIMIT 1 LOOP
  today:=(clock_timestamp() AT TIME ZONE cur.timezone)::date;
  d:=cur.last_day+1; count_days:=0;
  WHILE d<least(today,coalesce(cur.end_day,today)) AND count_days<7 LOOP
   SELECT * INTO rule FROM public.star_rule_versions WHERE epoch_id=cur.id AND child_id=cur.child_id AND effective_day<=d ORDER BY revision DESC LIMIT 1;
   cutoff:=((d+1)::timestamp AT TIME ZONE cur.timezone); state_details:='[]';
   IF rule.id IS NOT NULL AND rule.streak_enabled THEN
    SELECT coalesce(jsonb_agg(x),'[]') INTO habits_snapshot FROM private.star_sources_at(f,'habit_versions',cutoff) x;
    SELECT coalesce(jsonb_agg(x),'[]') INTO rests_snapshot FROM private.star_sources_at(f,'rests',cutoff,d) x;
    SELECT coalesce(jsonb_agg(x),'[]') INTO checkins_snapshot FROM private.star_sources_at(f,'checkins',cutoff,d) x;
    UPDATE private.star_streak_state SET consecutive=0 WHERE epoch_id=cur.id AND child_id=cur.child_id AND NOT(habit_id=ANY(rule.habit_ids));
    FOREACH hid IN ARRAY rule.habit_ids LOOP
     SELECT x INTO h FROM jsonb_array_elements(habits_snapshot) x
      WHERE (x->>'habit_id')::uuid=hid AND (x->>'effective_day')::date<=d ORDER BY (x->>'effective_day')::date DESC LIMIT 1;
     INSERT INTO private.star_streak_state(epoch_id,child_id,habit_id) VALUES(cur.id,cur.child_id,hid) ON CONFLICT DO NOTHING;
     IF h IS NULL OR NOT (h->>'active')::boolean OR (h->>'archived')::boolean THEN
      UPDATE private.star_streak_state SET consecutive=0 WHERE epoch_id=cur.id AND child_id=cur.child_id AND habit_id=hid;
      CONTINUE;
     END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(rests_snapshot) x WHERE (x->>'child_id')::uuid=cur.child_id AND (x->>'day')::date=d)
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(h->'weekdays') wd WHERE wd::integer=extract(isodow FROM d)::integer) THEN CONTINUE; END IF;
     SELECT count(*) INTO qualified FROM jsonb_array_elements(checkins_snapshot) x
      WHERE (x->>'habit_id')::uuid=hid AND (x->>'day')::date=d AND x->>'status'='approved';
     UPDATE private.star_streak_state SET consecutive=CASE WHEN qualified>=(h->>'target_count')::integer THEN consecutive+1 ELSE 0 END
      WHERE epoch_id=cur.id AND child_id=cur.child_id AND habit_id=hid RETURNING consecutive INTO n;
     award:=CASE WHEN n=3 THEN 1 WHEN n>=7 AND n%7=0 THEN 2 ELSE 0 END;
     w:=d-(extract(isodow FROM d)::integer-1);
     SELECT coalesce(sum(amount),0) INTO used FROM public.star_adjustments WHERE child_id=cur.child_id AND kind='streak' AND period_day>=w AND period_day<w+7;
     award:=least(award,greatest(0,3-used));
     IF award>0 THEN PERFORM private.star_post(f,cur.child_id,'streak',award,'连续完成约定奖励',rule.id,d,cur.timezone,hid,jsonb_build_object('consecutive',n,'habit_name',h->>'name')); END IF;
     state_details:=state_details||jsonb_build_array(jsonb_build_object('habit_id',hid,'consecutive',n,'approved',qualified,'target_count',h->'target_count','award',award));
    END LOOP;
   ELSE
    UPDATE private.star_streak_state SET consecutive=0 WHERE epoch_id=cur.id AND child_id=cur.child_id;
   END IF;
   INSERT INTO public.star_settlements(family_id,child_id,kind,period_day,rule_id,detail)
    VALUES(f,cur.child_id,'day',d,rule.id,jsonb_build_object('habits',state_details,'enabled',coalesce(rule.streak_enabled,false)));
   UPDATE private.star_settlement_cursor SET last_day=d WHERE id=cur.id;
   d:=d+1;count_days:=count_days+1;processed:=processed+1;
  END LOOP;
  w:=cur.last_week+7; count_weeks:=0;
  WHILE w+7<=least(today,coalesce(cur.end_week,today)) AND count_weeks<1 LOOP
   SELECT * INTO rule FROM public.star_rule_versions WHERE epoch_id=cur.id AND child_id=cur.child_id AND effective_week<=w ORDER BY revision DESC LIMIT 1;
   starts:=(w::timestamp AT TIME ZONE cur.timezone);cutoff:=((w+7)::timestamp AT TIME ZONE cur.timezone);
   opening:=NULL;low:=NULL;avg_bal:=NULL;award:=0;
   IF rule.id IS NOT NULL AND rule.savings_enabled THEN
    SELECT balance INTO opening FROM private.star_balance_samples WHERE child_id=cur.child_id AND observed_at<=starts ORDER BY observed_at DESC,seq DESC LIMIT 1;
    IF opening IS NOT NULL THEN
     SELECT least(opening,coalesce(min(balance),opening)) INTO low FROM private.star_balance_samples WHERE child_id=cur.child_id AND observed_at>starts AND observed_at<cutoff;
    END IF;
    avg_bal:=private.weekly_average_eod_balance(cur.child_id,w,cur.timezone);
    IF avg_bal IS NOT NULL THEN
     award:=private.savings_award_v2(avg_bal);
    END IF;
    IF award>0 THEN
     PERFORM private.star_post(
      f,cur.child_id,'savings',award,
      '整周存星利息（日均余额 '||avg_bal||' 星）',
      rule.id,w,cur.timezone,NULL,
      jsonb_build_object('opening',opening,'minimum',low,'average',avg_bal,'policy','weekly_avg_v2')
     );
    END IF;
   END IF;
   INSERT INTO public.star_settlements(family_id,child_id,kind,period_day,rule_id,detail)
    VALUES(f,cur.child_id,'week',w,rule.id,jsonb_build_object('enabled',coalesce(rule.savings_enabled,false),'opening',opening,'minimum',low,'average',avg_bal,'award',award,'policy','weekly_avg_v2'));
   UPDATE private.star_settlement_cursor SET last_week=w WHERE id=cur.id;
   w:=w+7;count_weeks:=count_weeks+1;processed:=processed+1;
  END LOOP;
 END LOOP;
 RETURN processed;
END $$;
REVOKE ALL ON FUNCTION private.settle_star_family(uuid) FROM PUBLIC,anon,authenticated,growth_app;
