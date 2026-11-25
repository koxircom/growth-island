export type Child = {
  id: string;
  nickname: string;
  avatar: string;
  photo_id?: string | null;
  color: string;
  weekday_minutes: number;
  weekend_minutes: number;
};
export type HabitCategory = "routine" | "occasional";
export type Habit = {
  category?: HabitCategory;
  id: string;
  child_id: string;
  name: string;
  icon: string;
  color: string;
  weekdays: number[];
  target_count: number;
  target_minutes: number;
  stars: number;
  requires_approval: boolean;
  active: boolean;
  archived_at?: string | null;
};
export type HabitVersion = Habit & {
  habit_id: string;
  effective_day: string;
  archived: boolean;
};
export type Checkin = {
  created_at?: string;
  id: string;
  child_id: string;
  habit_id: string;
  day: string;
  status: string;
  stars: number;
  reason?: string;
};
export type Timer = {
  id: string;
  child_id: string;
  kind: "focus" | "game";
  target_seconds: number;
  started_at: string;
  paused_at: string | null;
  paused_seconds: number;
  ended_at: string | null;
  actual_seconds: number | null;
  status: string;
  completed?: boolean;
  on_time?: boolean;
};
export type Reward = {
  kind?: "activity" | "device_time";
  device_id?: string | null;
  duration_seconds?: number | null;
  archived_at?: string | null;
  id: string;
  name: string;
  cost: number;
  child_id: string | null;
  active?: boolean;
};
export type Redemption = {
  request_id?: string | null;
  cancelled_at?: string | null;
  kind?: "activity" | "device_time";
  device_id?: string | null;
  device_name?: string | null;
  duration_seconds?: number | null;
  reward_name?: string;
  id: string;
  child_id: string;
  reward_id: string;
  status: string;
  cost: number;
  created_at: string;
};
export type Rest = {
  id: string;
  child_id: string;
  day: string;
  reason?: string;
};
export type DeviceSchedule = {days:number[];start:string;end:string;enabled:boolean};
export type FamilyDevice = { schedule_enabled?: boolean; schedules?: DeviceSchedule[]; id: string; name: string; active: boolean; cooldown_seconds?: number; max_extensions?: number };
export type TimeBalance = {child_id: string; device_id: string; balance_seconds: number};
export type DeviceUsage = {cooldown_seconds?: number; max_extensions?: number; extension_count?: number; id: string; child_id: string; device_id: string; device_name: string; reserved_seconds: number; started_at: string; deadline_at: string; ended_at: string | null; actual_seconds: number | null; status: "running" | "completed" | "stopped"};
export type SwitchSessionState = "none" | "sleeping" | "playing" | "paused" | "exhausted" | "ended" | "unknown";
export type SwitchSnapshot = {
  boot_id?: string | null;
  session_id?: string | null;
  session_state?: SwitchSessionState;
  granted_seconds?: number | string | null;
  consumed_seconds?: number | string | null;
  remaining_seconds?: number | string | null;
  sample_sequence?: number | string | null;
  clock_trusted?: boolean;
  native_verified?: boolean;
  sequence?: number | string | null;
  reason?: string | null;
};
export type SwitchSettings = {
  device_id: string;
  console_id: string;
  binding_id: string;
  enabled: boolean;
};
export type SwitchStatus = {
  checked_at: string | null;
  snapshot: SwitchSnapshot | null;
};
export type SwitchSession = {
  id: string;
  child_id: string;
  device_id: string;
  state: "pending" | "active" | "ended";
  granted_seconds: number | string;
  consumed_seconds: number | string;
  remote?: SwitchSnapshot | null;
  pending: boolean;
  last_result?: {phase?: string | null; reason?: string | null};
};
export type ManualStarGrant = {id: string; child_id: string; amount: number; reason: string; created_at: string; reversed_at?: string | null; reversal_reason?: string | null};
export type StarLedgerEntry = {id:string;child_id:string;amount:number;source_type:string;source_id:string;created_at:string;posting_seq:number|null;balance_before:number|null;balance_after:number|null};
export type HistoryProposal={id:string;child_id:string;habit_id:string;day:string;desired_count:number;reason:string;revision:number;status:string;base:[string,string,number,string][]};
export type Dashboard = {
  ledger_read_scope?: {kind:"parent"|"family"|"child"|"locked";child_id:string|null;channel_id:string};
 history_proposals?:HistoryProposal[];
  star_ledger?: StarLedgerEntry[];
 tv_sessions?: import('../app/tv-wallet').TvSession[];
 tv_status?: {checked_at:string|null;snapshot:{allowed_window_ends_at:number|null;cooldown_until:number}|null};
  tv_settings?: import('../app/parent-tv-settings').TvSettings;
  switch_settings?: SwitchSettings;
  switch_status?: SwitchStatus;
  switch_sessions?: SwitchSession[];
  star_rule_transitions?: import("./star-rules").StarTransition[];
  star_rule_versions?: import("./star-rules").StarRule[];
  star_adjustments?: import("./star-rules").StarAdjustment[];
  star_settlements?: import("./star-rules").StarSettlement[];
  star_settler_last_success_at?: string | null;
  devices?: FamilyDevice[];
  device_time_balances?: TimeBalance[];
  device_usage_sessions?: DeviceUsage[];
  manual_star_grants?: ManualStarGrant[];
  family: { id: string; name: string; timezone: string; login_lockout_enabled?: boolean };
  children: Child[];
  habits: Habit[];
  habit_versions?: HabitVersion[];
  checkins: Checkin[];
  timers: Timer[];
  rewards: Reward[];
  redemptions: Redemption[];
  rests: Rest[];
  star_balances:
    Record<string, number> | { child_id: string; balance: number }[];
};
/** Stable newest-first order even when a fixture or cached response is unsorted. */
export function newestFirst<T>(items: T[], timestamp: (item: T) => string | undefined): T[] {
  return items.slice().sort((a,b) => (Date.parse(timestamp(b) || "") || 0) - (Date.parse(timestamp(a) || "") || 0));
}
export function latestCheckin(items: Checkin[]) { return newestFirst(items, c => c.created_at)[0]; }
export function habitIcon(icon: string) {
  return ({pencil:"book",timer:"focus",gamepad:"game",backpack:"bag",sparkles:"tidy",sun:"sport"} as Record<string,string>)[icon] || icon;
}
export function visibleHabits(items: Habit[]) { return items.filter(h => !h.archived_at); }
/** Resolve the name effective on a record's day, including archived versions. */
export function checkinHabitName(d: Dashboard, c: Pick<Checkin, "habit_id" | "day">) {
  const version = (d.habit_versions || [])
    .filter(h => h.habit_id === c.habit_id && h.effective_day <= c.day)
    .sort((a, b) => b.effective_day.localeCompare(a.effective_day))[0];
  return version?.name || d.habits.find(h => h.id === c.habit_id)?.name || "习惯打卡";
}
export function redemptionName(r: Redemption, rewards: Reward[]) {
  return r.reward_name || rewards.find(x => x.id === r.reward_id)?.name || "家庭奖励";
}
export function localDay(tz = "Asia/Shanghai", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function offsetDay(day: string, offset: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function weekday(day: string) {
  return new Date(day + "T12:00:00Z").getUTCDay();
}
export function balance(d: Dashboard, id: string) {
  return Array.isArray(d.star_balances)
    ? Number(d.star_balances.find((x) => x.child_id === id)?.balance || 0)
    : Number(d.star_balances?.[id] || 0);
}
export function habitCategory(h: Pick<Habit,"category">): HabitCategory { return h.category === "occasional" ? "occasional" : "routine"; }
export function countsForDailyGoal(h: Habit, day: string) { return habitCategory(h)==="routine" && scheduled(h,day); }
export function scheduled(h: Habit, day: string) {
  return h.active && h.weekdays.includes(weekday(day) || 7);
}
export function approvedActivityCount(d: Dashboard,id: string,day: string) { return d.checkins.filter(c=>c.child_id===id&&c.day===day&&c.status==="approved").length; }
export function countFor(d: Dashboard, hid: string, day: string) {
  return d.checkins.filter(
    (c) => c.habit_id === hid && c.day === day && c.status === "approved",
  ).length;
}
export function habitsAt(d: Dashboard, day: string) {
  if (!d.habit_versions) return d.habits;
  const selected = new Map<string, HabitVersion>();
  for (const h of d.habit_versions) {
    if (
      h.effective_day <= day &&
      (!selected.has(h.habit_id) ||
        selected.get(h.habit_id)!.effective_day < h.effective_day)
    )
      selected.set(h.habit_id, h);
  }
  return [...selected.values()]
    .filter((h) => !h.archived)
    .map((h) => ({ ...h, id: h.habit_id }));
}
export function progress(d: Dashboard, id: string, day: string) {
  if (d.rests.some((r) => r.child_id === id && r.day === day))
    return { done: 0, total: 0, rate: 0, rest: true };
  const hs = habitsAt(d, day).filter(
    (h) => h.child_id === id && countsForDailyGoal(h, day),
  );
  const total = hs.reduce((n, h) => n + h.target_count, 0);
  const done = hs.reduce(
    (n, h) => n + Math.min(h.target_count, countFor(d, h.id, day)),
    0,
  );
  return {
    done,
    total,
    rate: total ? Math.round((done / total) * 100) : 0,
    rest: false,
  };
}
export function elapsed(t: Timer, now = Date.now()) {
  const end = t.ended_at
    ? Date.parse(t.ended_at)
    : t.paused_at
      ? Date.parse(t.paused_at)
      : now;
  return Math.max(
    0,
    Math.floor((end - Date.parse(t.started_at)) / 1000 -
      Number(t.paused_seconds || 0)),
  );
}
const dayBoundaries = new Map<string, number>();
/** Find the real midnight boundary, including 23/25-hour daylight-saving days. */
export function startOfLocalDay(day: string, timezone: string): number {
  const key = `${timezone}:${day}`;
  const cached = dayBoundaries.get(key); if (cached !== undefined) return cached;
  const center = Date.parse(day + "T00:00:00Z");
  let low = center - 48 * 3600000, high = center + 48 * 3600000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDay(timezone, new Date(middle)) < day) low = middle; else high = middle;
  }
  if (dayBoundaries.size > 64) dayBoundaries.clear();
  dayBoundaries.set(key, high); return high;
}
export function gameSecondsRemaining(data: Dashboard, child: Child, day: string): number {
  const start = startOfLocalDay(day, data.family.timezone);
  const end = startOfLocalDay(offsetDay(day, 1), data.family.timezone);
  const budget = (weekday(day) === 0 || weekday(day) === 6 ? child.weekend_minutes : child.weekday_minutes) * 60;
  const used = data.timers.filter(t => t.child_id === child.id && t.kind === "game" && t.ended_at)
    .reduce((sum,t) => sum + Math.max(0, Math.min(Date.parse(t.ended_at!), end) - Math.max(Date.parse(t.started_at), start)) / 1000, 0);
  return Math.max(0, budget - Math.round(used));
}
export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
export function safeError(e: unknown) {
  const m = e instanceof Error ? e.message : "操作没有完成，请稍后再试";
  const messages: Record<string, string> = {
    pending_mutation_storage_unavailable: "浏览器暂时无法保存防重复标识。请先检查账本，不要反复新建同一笔操作。",
    pending_mutation_corrupt: "防重复记录异常，请先核查账本再处理，不要清空浏览器数据后反复提交。",
    pending_mutation_limit: "待核实的操作过多，请先检查账本并处理原来的操作。",
    pending_mutation_hash_unavailable: "当前浏览器无法安全保存防重复标识，请使用可信 HTTPS 地址。",
    pending_mutation_family_required: "家庭信息还未加载，请稍后再试。",

    habit_changed_refresh: "习惯已在其他页面修改，请刷新查看后重试。本次操作没有部分保存。",
    star_timezone_confirmation_required: "改时区会重置连续奖励并跳过未完整奖励周期，请在家庭设置中确认迁移说明。",
    invalid_star_rules: "请检查规则：每日上限1–10颗，启用连续奖励时至少选择一个启用中的习惯。",
    invalid_star_adjustment: "请填写1–10的整数星星、具体原因，并再次确认。",
    star_daily_limit: "已达到这个孩子的扣星上限（当天和最近24小时）。撤销不会恢复额度。",
    star_already_reversed: "这条调整已经撤销，不会重复返还或扣除。",
    star_adjustment_not_found: "没有找到可撤销的调整，请刷新后查看。",
    invalid_device_duration: "请填写有效的时间长度。奖励为1–180分钟，使用时间不能超过可用余额。",
    device_time_already_running: "这个孩子已有正在使用的奖励时间，请先结束它。",
    switch_not_active: "这次主机使用已结束，请刷新后重新发送时间。",
    switch_already_bound: "这台主机已绑定其他家庭，请由家长核对。",
    invalid_switch_binding: "主机绑定信息不正确，请由家长核对。",
    invalid_console_id: "主机编号不正确，请由家长核对。",
    switch_not_ready: "Switch 主机还没有准备好，请等状态更新后再试。",
    switch_schedule_unsupported: "Switch 启用允许时段后暂不支持安全下发，请由家长调整设备设置。",
    switch_busy: "Switch 正在被另一位孩子使用，请先等当前会话结束。",
    switch_operation_pending: "Switch 操作正在等待主机确认，请不要重复提交。",
    invalid_switch_result: "Switch 主机回执无法核对，请先等待状态更新，不要重复提交。",
    switch_pending: "Switch 操作正在等待主机确认，请不要重复提交。",
    redemption_external_unknown: "这个奖励已获批准，可能已经安排或领取，不能自动退款。请和家长核对履行情况后再处理。",
    redemption_undo_unavailable: "这笔兑换不能快捷撤销，请到家长空间查看原记录。",
    redemption_time_already_used: "这笔时间已开始使用或正在核对，不能自动退款。请先结束并结算，再由家长查看记录。",
    insufficient_device_time: "可用时间不足，请先查看奖励时间余额。",
    device_usage_not_found: "没有找到这次使用记录，请刷新后重试。",
    invalid_star_grant: "请填写1–10000的正整数星星和非空原因（最多300字）。",
    invalid_reward_kind: "请选择普通奖励或可计时的设备奖励。",
    device_not_found: "没有找到这个设备，请刷新后再试。",
    invalid_device_schedule: "请填写有效的设备允许时段（开始和结束不能相同）。",
    device_outside_allowed_time: "现在不在这个设备的允许使用时段内，时间余额会保留。",
    device_time_exceeds_window: "本次时间超过允许时段，请缩短使用时间。",
    device_time_cooldown: "休息时间还没结束，请稍后再开始。",
    device_extension_limit: "本次追加次数已用完，按约定结束后休息一下。",
    invalid_device_policy: "请填写有效的冷却分钟数和追加次数。",
    device_inactive: "这个设备暂时停用，请让家长查看设置。",
    insufficient_time: "可用奖励时间不足，可以先兑换并等待家长确认。",
    insufficient_time_balance: "可用奖励时间不足，可以先兑换并等待家长确认。",
    device_usage_running: "这个孩子已经有正在使用的奖励时间，请先结束它。",
    device_usage_already_running: "这个孩子已经有正在使用的奖励时间，请先结束它。",
    invalid_duration: "请检查约定时长。",
    invalid_manual_star_grant: "请填写正整数星星和具体原因。",
    secure_random_unavailable: "浏览器暂时无法创建记录编号，请刷新页面或更新浏览器后重试。",
    credentials_changed: "密码已在其他窗口修改，请重新登录。",
    password_nonempty: "请设置一个非空密码。",
    password_mismatch: "两次输入的密码不一致。",
    setup_closed: "首次设置入口已关闭，请联系管理员重新开启。",
    setup_required: "请先在首页设置家庭密码。",
    invalid_credentials: "密码不正确，请重新输入。",
    login_rate_limited: "尝试次数较多，请 10 分钟后再试。",
    service_unavailable: "家庭服务器暂时无法连接，请稍后重试。",
    origin_not_allowed: "请通过家庭小岛的正式地址访问。",
    invalid_request: "输入内容不正确，请检查后重试。",
    conflict_refresh: "记录已更新，请刷新后查看。",
    logout_not_confirmed: "退出尚未得到服务器确认。请恢复网络后再次退出；共用设备请关闭浏览器。",
    daily_game_time_used: "今天约定的游戏时间已经用完了，明天再继续吧。",
    backfill_requires_parent_and_reason: "补打卡需要家长解锁并填写原因。",
    not_scheduled_today: "这一天没有安排这个习惯。",
    invalid_timezone: "时区名称无效，请选择有效的 IANA 时区。",
    spent_stars_requires_parent: "这些星星已经用于奖励，请由家长确认撤销。",
    authentication_required: "登录已失效，请重新登录。",
    already_reviewed: "这条记录已经审核，请刷新查看。",
    invalid_date: "日期不正确，不能补录未来的记录。",
    pin_must_be_6_to_12_digits: "PIN 需要 6–12 位数字。",
    habit_not_active_on_date: "这一天尚未启用这个习惯。",
    habit_not_active: "这个习惯已暂停，请刷新查看。",
    "Invalid login credentials": "密码不正确，请重新输入。",
    "Email not confirmed": "请先在邮箱中确认注册邮件。",
    parent_required: "请先解锁家长模式。",
    daily_goal_reached: "今天的目标次数已经记录了。",
    timer_already_running: "这个孩子已有一个正在进行的计时。",
    insufficient_stars: "可用星星还不够，慢慢积累就好。",
    invalid_pin: "PIN 不正确，请重新输入。",
    pin_locked: "尝试次数较多，请 5 分钟后再试。",
    invalid_weekdays: "请至少选择一个执行星期。",
    habit_not_scheduled: "这一天没有安排这个习惯。",
    rest_day: "这一天是休息日。",
    past_checkin_requires_reason: "补打卡需要家长解锁并填写原因。",
  };
  for (const [code, text] of Object.entries(messages))
    if (m.includes(code)) return text;
  if (/fetch|network|Failed to fetch/i.test(m))
    return "网络暂时不稳定，记录尚未确认。请联网后重试。";
  return m;
}



