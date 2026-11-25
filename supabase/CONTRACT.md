# Growth Island database RPC contract

The self-hosted build uses same-origin authenticated HTTP RPC with a server-managed HttpOnly cookie. The server validates the session and sets auth.uid() in a transaction using the non-superuser runtime role. The SQL contract below is unchanged; no Supabase service or browser database key is required.

- `create_family({p_name, p_pin, p_timezone:'Asia/Shanghai'}) -> uuid`: once per auth user; creates two neutral children 星星/狐狸 and 月亮/小熊, independent presets. PIN 6–12 numeric digits.
- `unlock_parent({p_pin}) -> string`: random 30-minute bearer token; keep in memory, not localStorage. Five failed attempts locks for 5 minutes; wrong PIN returns NULL (to retain failed-attempt count). UI must handle null. Auth session is still required.
- `get_dashboard() -> JSON`: `family,children,habits,checkins,timers,rewards,redemptions,rests,star_balances` arrays; star_balances rows `{child_id,balance,earned}`. Family absent returns `{family:null,...empty arrays}`. Timers `kind:'focus'|'game'`, status `running|paused|completed|stopped`; checkins status `pending|approved|rejected|undone`. Checkins include `created_at`, `stars`, reason and day. Rewards active. Rejected/undone items remain for audit.
- `family_mutate({p_action,p_payload,p_request_id:crypto.randomUUID(),p_parent_token:null}) -> dashboard`: retain SAME request UUID on retry. Every logical user action gets new UUID. Cross-household IDs rejected. Admin actions require valid token. RPC is one transaction; family-level lock serializes balances/day limits.

## Child actions
- `checkin`: `{habit_id,day?:'YYYY-MM-DD',reason?:string}`. Today default; children may check in on an eligible past date without a parent token or reason. Future dates and dates without an active habit version are disallowed. Respects weekdays, daily target, rest days. Returns existing same request on retry. Pending checkin consumes daily slot; approval grants stars.
- `undo_checkin`: `{id}`. Children may undo approved/pending records on eligible dates; stars are reversed; if already spent this requires a parent token and may result in negative balance (truthful correction, blocks new spending).
- `timer_start`: `{child_id,kind:'focus'|'game',target_seconds?:number}`. Focus 60–7200 seconds; game target ignored and calculated from remaining daily weekday/weekend allowance. One live timer per child.
- `timer_pause`, `timer_resume`: `{id}`; focus only. Game wall clock never paused.
- `timer_finish`: `{id,kept_agreement?:boolean}`. Server calculates elapsed from timestamps. Focus completed only if actual >= target; otherwise stopped. Game completed only if child confirms kept_agreement AND elapsed <= target+60 seconds; otherwise stopped. Returns status and `kept_agreement`. No extra timer stars (avoid duplicate earning with habit checkin).
- `redeem`: `{child_id,reward_id}` creates pending request; stars reserved/deducted transactionally. Reject refunds; confirm doesn't charge twice.

## Parent actions
- `child_save`: `{id?,nickname,avatar,color,weekday_minutes,weekend_minutes}`; max two children. Avatar key arbitrary short string (UI validate supported). Color hex. Minutes 0–180.
- `habit_save`: `{id?,child_id,name,icon,color,weekdays:[1,2,3,4,5,6,7],target_count,target_minutes,stars,requires_approval,active}`; ISO Mon=1 Sun=7. Existing habit child cannot change. Goal count1–20, min0–120, stars0–20. Missing optional fields on update preserve previous values.
- `habit_delete`: `{id}` soft archive, active=false, history remains.
- `reward_save`: `{id?,child_id?:uuid|null,name,cost,icon?}` cost1–10000.
- `reward_delete`: `{id}` archive.
- `family_save`: `{name?,timezone?,pin?}` valid IANA TZ. New PIN invalidates all tokens except caller's existing token; UI should re-unlock.
- `rest_save`: `{child_id,day,reason?,is_rest:true|false}`; no future beyond one year. History checkins are retained.
- `checkin_review`: `{id,approve:boolean}` pending only.
- `redemption_review`: `{id,approve:boolean}` pending only.
- `timer_review`: `{id,kept_agreement:boolean,reason}` for ended game; audit correction with parent token.

Runtime errors contain stable labels (e.g. `parent_required`, `daily_goal_reached`, `timer_already_running`, `insufficient_stars`). Display friendly Chinese in app. Unknown payload fields ignored, never SQL dynamic user data. Don't expose raw SQL errors to children.

## Historical denominators
`habit_versions` is also returned: `{id,habit_id,child_id,effective_day,name,icon,color,weekdays,target_count,target_minutes,stars,requires_approval,active,archived}`. For a date, pick each habit's latest version on/before that date. No version means habit did not exist yet. Same-local-day edits affect that day; earlier days remain unchanged. Parent backfill before the first version establishes that habit retroactively from the selected date. Rest dates exclude that child's scheduled goals. A retired habit's records remain in history.
