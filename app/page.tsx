"use client";
import {subscribeLedgerInvalidation} from "@/lib/ledger-invalidation";

import {CheckinReviewList} from "./checkin-review-list";
import {PendingBadge} from "./pending-badge";
import {pendingReviewCount,requestTime} from "@/lib/review-display";
import {SortableHabitList} from "./sortable-habit-list";
import { visibleChildHabits } from "@/lib/visible-child-habits";
import {HabitArt} from "./habit-art";
import {HabitSpeaker} from "./habit-speaker";
import {RewardArt} from "./reward-art";
import {RewardShelf,RewardStarProgress} from "./reward-shelf";
import {PenaltyRuleSettings} from "./penalty-rule-settings";
import {PeerPenalties} from "./peer-penalties";
import {effectiveEarnedStarDays,ledgerVisibleForChild} from "@/lib/earned-stars";
import {EarnedStarsTrend} from "./earned-stars-trend";
import {BalanceStarsTrend} from "./balance-stars-trend";
import {ChildQuickSwitch} from "./child-quick-switch";
import {RuleSpeaker} from "./rule-speaker";
import {rewardExplanation} from "@/lib/reward-explanation";
import {HistoryProposalReview} from "./history-proposals";
import {DeviceScheduleFields} from "./device-schedule-fields";
import {RedemptionUndoNotice} from "./redemption-undo-notice";
import {speakChildFeedback,primeChildVoice} from "@/lib/child-voice";
import {ChildVoiceSettings} from "./child-voice-settings";
import {csvCell} from "@/lib/csv";
import {PendingMutationJournal,isJournaledMutation} from "@/lib/pending-mutations";
import {ParentAccountBook} from "./parent-account-book";
import {GrowthStatistics} from "./growth-statistics";
import {ChildHistory} from "./child-history";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Session } from "@/lib/client";
import {
  Home,
  Star,
  Shirt, Utensils, Droplets, Users,
  Timer as TimerIcon,
  Leaf,
  Settings,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  Pause,
  Play,
  Square,
  LogOut,
  Lock,
  Gift,
  TrendingUp,
  CalendarDays,
  Undo2,
  X,
  Download,
  Menu,
  WifiOff,
  BookOpen,
  Gamepad2,
  Backpack,
  Moon,
  Sun,
  Heart,
  CheckCircle2,
  Circle,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { ChildStarBalance } from "./child-star-balance";
import { ParentSwitchStatus } from "./parent-switch-status";
import { ParentTvSettings } from "./parent-tv-settings";
import { serverClock } from "@/lib/server-clock";
import { focusDurationSeconds } from "@/lib/focus-duration";
import { validRecordDate } from "@/lib/record-date";
import { configured, auth, rpc, synchronizeServerClock } from "@/lib/client";
import { createRequestId, withMutationLock } from "@/lib/mutation";
import {
  balance, checkinHabitName,
  newestFirst, latestCheckin, visibleHabits, redemptionName, gameSecondsRemaining, habitIcon,
  Checkin,
  Child,
  countFor,
  Dashboard,
  elapsed,
  formatDuration,
  Habit,
  localDay,
  offsetDay,
  progress,
  Reward,
  safeError,
  scheduled,
  habitCategory,
  approvedActivityCount,
  Timer,
  weekday,
} from "@/lib/model";
import { ChildAvatar, PhotoUpload } from "./child-photo";
import { Animal, Island } from "./art";
import { GrowthGarden } from "./growth-garden";
import { checkinFeedback, type GrowthFeedback } from "@/lib/growth-feedback";
import {enableCountdownSound} from "@/lib/countdown-audio";

import {ParentStarRules,ChildStarRules,TimezoneStarNotice} from "./star-rules";
import {TimeWallet,WalletCountdownBridge,DevicesPanel,ManualStarsForm} from "./wallet";
import { ParentHabitRules } from "./parent-habit-rules";
import { habitTemplates } from "@/lib/habit-templates";
import { rewardTemplates, rewardTemplateName } from "@/lib/reward-templates";
const icons: Record<string, typeof Star> = {
  star: Star,
  shirt: Shirt, meal: Utensils, wash: Droplets, water: Droplets, family: Users,
  book: BookOpen,
  focus: TimerIcon,
  game: Gamepad2,
  bag: Backpack,
  tidy: Leaf,
  moon: Moon,
  sport: Sun,
  heart: Heart,
};
const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
const colors = ["#5b9c8c", "#de947c", "#85a7c5", "#ad9bc3"];
type Page = "penalties" | "home" | "child" | "timer" | "growth" | "rewards" | "history" | "parent";
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(false),
    [data, setData] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(false),
    [dashboardLoaded, setDashboardLoaded] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState<Page>("home"),
    [childId, setChildId] = useState(""),
    [date, setDate] = useState(""),
    [parentToken, setParentToken] = useState(""),
    [parentUntil, setParentUntil] = useState(0),
    [showUnlock, setShowUnlock] = useState(false),
    [modal, setModal] = useState<{ kind: string; item?: any } | null>(null),
    [feedback, setFeedback] = useState<GrowthFeedback | null>(null),
    [online, setOnline] = useState(true);
  const unlockDestination = useRef<Page>("parent");
  const [parentTab,setParentTab] = useState("children");
  const authGeneration = useRef(0);
  const snapshotVersion = useRef(0), previousToday = useRef(""), unlockVersion = useRef(0);
  const lock = useRef(false),
    reqs = useRef<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!configured || lock.current) return;
    const version = ++snapshotVersion.current;
    const generation = authGeneration.current;
    setLoading(true);
    try {
      const v = await rpc<Dashboard | null>("get_dashboard");
      if (generation !== authGeneration.current || version !== snapshotVersion.current) return;
      setDashboardLoaded(true);
      setData(v?.family ? v : null);
      if (v?.family) {
        setChildId((old) => old || v.children[0]?.id || "");
        const nextToday = localDay(v.family.timezone, new Date(serverClock.now() ?? Date.now())), prior = previousToday.current;
        previousToday.current = nextToday;
        setDate((old) => !old || old === prior ? nextToday : old);
      }
      setError("");
    } catch (e) {
      if (generation === authGeneration.current && version === snapshotVersion.current) setError(safeError(e));
    } finally {
      if (generation === authGeneration.current && version === snapshotVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (!configured) {
      setAuthReady(true);
      return;
    }
    auth.getSession().then(({ data, stale }) => {
      if (!stale) setSession(data.session);
      setAuthReady(true);
    }).catch(() => { setAuthReady(true); setError("无法连接家庭服务器，请检查网络后刷新。"); });
    const { data: s } = auth.onAuthStateChange((_e, s) => {
      authGeneration.current++;
      snapshotVersion.current++;
      unlockVersion.current++;
      previousToday.current = "";
      setDashboardLoaded(false);
      setSession(s);
      setData(null);
      setChildId("");
      setDate("");
      setParentToken("");
      setParentUntil(0);
      setPage("home");
      setModal(null);
      setShowUnlock(false);
      setBusy(false);
      setLoading(false);
      setError("");
      setFeedback(null);
      reqs.current = {};
    });
    return () => s.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  useEffect(()=>{
    const reload=()=>void load();window.addEventListener("island-child-access-changed",reload);
    return ()=>window.removeEventListener("island-child-access-changed",reload);
  },[load]);
  useEffect(()=>{
    let waiting:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{if(lock.current){waiting=setTimeout(refresh,50);return;}void load();};
    const unsubscribe=subscribeLedgerInvalidation(data?.ledger_read_scope?.channel_id||"",refresh);
    return ()=>{unsubscribe();if(waiting!==undefined)clearTimeout(waiting)};
  },[data?.ledger_read_scope?.channel_id,load]);
  useEffect(() => {
    const check = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && session) void load();
    };
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    const v = () => {
      if (!document.hidden && session) void load();
    };
    document.addEventListener("visibilitychange", v);
    window.addEventListener("focus", v);
    window.addEventListener("pageshow", v);
    const interval = setInterval(() => {
      if (session && !document.hidden) void load();
    }, data?.tv_settings?.device_id || data?.switch_settings?.enabled ? 5000 : 30000);
    return () => {
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
      document.removeEventListener("visibilitychange", v);
      window.removeEventListener("focus", v);
      window.removeEventListener("pageshow", v);
      clearInterval(interval);
    };
  }, [session, load, data?.tv_settings?.device_id, data?.switch_settings?.enabled]);
  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), 2600);
    return () => clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 8000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (parentToken) {
      const t = setTimeout(
        () => {
          setParentToken("");
          setParentUntil(0);
        },
        Math.max(0, parentUntil - Date.now()),
      );
      return () => clearTimeout(t);
    }
  }, [parentToken, parentUntil]);
  async function lockParent() {
    if(busy)return;
    setBusy(true);
    try {await auth.signOut();setParentToken("");setParentUntil(0);setPage("home");setModal(null);}
    catch(e){setError("锁定未确认，请重试。"+safeError(e));}
    finally{setBusy(false);}
  }
  const photoRefreshPending = useRef(false);
  const refreshAfterPhoto = useCallback(() => {
    if (lock.current) { photoRefreshPending.current = true; return; }
    void load();
  }, [load]);
  useEffect(() => {
    if (!busy && photoRefreshPending.current) {
      photoRefreshPending.current = false;
      void load();
    }
  }, [busy, load]);
  const pendingJournal = useRef(new PendingMutationJournal());
  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    key?: string,
  ) {
    const generation = authGeneration.current;
    return withMutationLock(lock, (value) => {
      if (generation === authGeneration.current) setBusy(value);
    }, async () => {
      if (page !== "parent") primeChildVoice();
      snapshotVersion.current++;
      setLoading(false);
      setError("");
      try {
        const k = key || JSON.stringify([action, payload]);
        const durable = isJournaledMutation(action) ? await pendingJournal.current.prepare(data?.family.id || "",action,payload) : null;
        const id = durable?.id || reqs.current[k] || (reqs.current[k] = createRequestId());
        const d = await rpc<Dashboard>("family_mutate", {
          p_action: action,
          p_payload: payload,
          p_request_id: id,
          p_parent_token: parentToken || null,
        });
        if (durable) pendingJournal.current.complete(durable);
        if (generation !== authGeneration.current) return;
        snapshotVersion.current++;
        setData(d);
        setDashboardLoaded(true);
        delete reqs.current[k];
        const redeemed = action === "redeem" ? d.redemptions.find(r => r.reward_id === payload.reward_id && r.child_id === payload.child_id) : null;
        const redeemedReward = redeemed ? d.rewards.find(r => r.id === redeemed.reward_id) : null;
        const switchRedeem = !!redeemedReward && !!d.switch_settings?.enabled && redeemedReward.kind === "device_time" && redeemedReward.device_id === d.switch_settings.device_id;
        const tvRedeem = !!redeemedReward && redeemedReward.kind === "device_time" && redeemedReward.device_id === d.tv_settings?.device_id;
        const approvedDeviceRedeem = redeemed?.status === "approved" && redeemedReward?.kind === "device_time";
        const switchAction = !!d.switch_settings?.enabled && (
          ((action === "device_time_start") && payload.device_id === d.switch_settings.device_id) ||
          ((action === "device_time_extend" || action === "device_time_stop") && typeof payload.id === "string" && (d.switch_sessions || []).some(s => s.id === payload.id && s.device_id === d.switch_settings?.device_id))
        );
        const savedFeedback = action === "checkin"
          ? checkinFeedback(data?.checkins || [], d.checkins, payload.habit_id, payload.day)
          : null;
        setToast(action === "redeem" ? "" : action === "redeem_undo" ? "已撤销兑换，星星已退回；如有未用时间也已收回。"
          : switchAction && (action === "device_time_start" || action === "device_time_extend") ? "已提交，等待主机确认。"
          : switchAction && action === "device_time_stop" ? "结束请求已提交，等待主机回执。"
          : savedFeedback?.message || "已保存到家庭小岛");
        setFeedback(payload.day === previousToday.current ? savedFeedback : null);
        if (page !== "parent") {
          const childMessage = savedFeedback?.message || (switchAction ? ({
            device_time_start: "已提交，等待主机确认。",
            device_time_extend: "已提交追加，等待主机确认。",
            device_time_stop: "已提交结束请求，等待主机回执。",
          } as Record<string,string>)[action] : ({
            redeem: switchRedeem ? "Switch余额已累加，不会立即启动。" : tvRedeem ? "兑换成功，电视时间已经存好啦，准备好再开始使用。" : approvedDeviceRedeem ? "兑换成功，时间已经存好啦，准备好再开始使用。" : "愿望已经提交啦，等家长确认后就能使用。",
            history_submit: '已经交给家长确认啦，星星暂时不变。',
            history_withdraw: '这次申请已经撤回啦。',
            undo_checkin: "这次记录已经撤销，可以重新来。",
            timer_start: payload.kind === "focus" ? "准备好啦，先专心做这一小段吧。" : "计时开始啦，记得按约定结束哦。",
            timer_pause: "已经暂停，休息一下也没关系。",
            timer_resume: "我们继续这一小段吧。",
            timer_finish: "这段时间已经记下啦，伸个懒腰吧。",
          } as Record<string,string>)[action]);
          if (childMessage) speakChildFeedback(childMessage);
        }
        return d;
      } catch (e) {
        if (generation !== authGeneration.current) return;
        const message = safeError(e);
        setError(/switch_schedule_unsupported/.test(message) ? "Switch暂不支持设备允许时段，已暂停发送和追加；请让家长关闭该设备的允许时段设置，或等待主机端支持。" : message);
        if (page !== "parent") {
          speakChildFeedback(!navigator.onLine ? "网络暂时断开了，别着急，联网后再试一次。"
            : /星星不足|insufficient_stars/.test(message) ? "星星还不够，慢慢积累就好。"
            : /时间不足|insufficient_device_time/.test(message) ? "可用时间还不够，先去奖励小屋看看吧。"
            : /冷却|休息|cooldown/.test(message) ? "现在是休息时间，休息好了再来吧。"
            : /parent|token|PIN|家长/i.test(message) ? "这一步需要家长帮忙，我们请家长来看看。"
            : "这次操作还没确认成功，别着急，看看提示再试一次。");
        }
        const parentUnlockRequired = action === "undo_checkin"
          ? typeof e === "object" && e !== null && "message" in e
            && (e.message === "parent_required" || e.message === "spent_stars_requires_parent")
          : action !== "checkin" && action !== "redeem_undo" && /parent|token|PIN|家长/i.test(message);
        if (parentUnlockRequired) {
          setParentToken("");
          setShowUnlock(true);
        }
      }
    });
  }

  const activeMobileNavPage = page === "child" || page === "history" ? "home" : page;

  function nav(p: Page) {
    if (p === "parent" && !parentToken) {
      unlockDestination.current = "parent";
      setShowUnlock(true);
      return;
    }
    setFeedback(null);
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const current =
    data?.children.find((c) => c.id === childId) || data?.children[0];
  const today = data ? localDay(data.family.timezone, new Date(serverClock.now() ?? Date.now())) : "";
  const selectedDay = date || today;
  function selectChild(id: string, p: Page = "child") {
    setFeedback(null);
    setChildId(id);
    setDate(today);
    setPage(p);
  }
  if (!authReady)
    return (
      <div className="center-screen">
        <Island />
        <h2>正在驶向成长小岛…</h2>
      </div>
    );
  if (!configured)
    return (
      <AuthShell>
        <span className="eyebrow">准备启航</span>
        <h1>小岛还差最后一步</h1>
        <p>
          应用已准备好，但数据库尚未连接。请部署者配置本地数据库
          连接与家长账号，并执行数据库迁移。
        </p>
        <div className="notice">
          这里不会用本地缓存冒充真实数据库。连接完成后，两个孩子的记录才能安全保存与跨设备同步。
        </div>
        <p className="small">
          部署步骤见项目中的部署说明。无需提供真实孩子姓名。
        </p>
      </AuthShell>
    );
  if (!session) return <Login />;
  if (!data) {
    return (
      <AuthShell>
        {!dashboardLoaded ? (
          <><h2>{loading ? "正在读取家庭记录…" : "暂时无法读取家庭记录"}</h2>
          {!loading && <button className="primary" onClick={() => void load()}>重新读取</button>}</>
        ) : (
          <>
            <h1>欢迎创建你的成长小岛</h1>
            <p>为两个孩子准备独立空间。先用昵称开始，以后随时调整。</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget);
                try {
                  await rpc("create_family", {
                    p_name: f.get("name"),
                    p_timezone: f.get("timezone"),
                  });
                  await load();
                } catch (e) {
                  setError(safeError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="家庭小岛名称">
                <input
                  name="name"
                  defaultValue="我们家的成长小岛"
                  required
                  maxLength={40}
                />
              </Field>
              <Field label="家庭时区">
                <select name="timezone">
                  <option>Asia/Shanghai</option>
                  <option>Asia/Singapore</option>
                  <option>America/New_York</option>
                  <option>Europe/London</option>
                </select>
              </Field>
              <button disabled={busy} className="primary">
                创建两个孩子的空间 <ArrowRight size={18} />
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => void auth.signOut().catch((e) => setError(safeError(e)))}
            >
              退出账号
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </AuthShell>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            nav("home");
          }}
        >
          <span className="brand-icon">
            <Leaf size={25} />
          </span>
          <div>
            成长小岛<small>GROW A LITTLE, EVERY DAY</small>
          </div>
        </a>
        <p className="nav-label">我们的成长旅程</p>
        <nav>
          {(
            [
              { p: "home", i: Home, t: "家庭首页" },
              { p: "timer", i: TimerIcon, t: "专注与游戏" },
              { p: "growth", i: TrendingUp, t: "双人成长" },
              { p: "rewards", i: Gift, t: "奖励小屋" },
              { p: "penalties", i: ShieldCheck, t: "惩罚" },
            ] as const
          ).map((n) => (
            <button
              key={n.p}
              className={`nav-item ${page === n.p ? "active" : ""}`}
              onClick={() => nav(n.p)}
            >
              <n.i size={21} />
              {n.t}
              {page === n.p && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-children">
          <p className="nav-label">小岛居民</p>
          {data.children.map((c) => (
            <button
              key={c.id}
              className={`child-link ${page === "child" && c.id === current?.id ? "chosen" : ""}`}
              onClick={() => selectChild(c.id)}
            >
              <ChildAvatar child={c} size={44} />
              <span className="child-link-identity">
                <span className="child-link-name" title={c.nickname}>{c.nickname}</span>
                <ChildStarBalance data={data} child={c} />
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="kind-note">
            <Heart size={19} />
            <p>
              不和别人比，
              <br />
              只看自己的小进步。
            </p>
          </div>
          <button
            className={`nav-item ${page === "parent" ? "active" : ""}`}
            onClick={() => nav("parent")}
          >
            <Settings size={20} />
            家长空间
            <Lock size={14} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="breadcrumb">
            <span className="breadcrumb-family">{data.family.name}</span>
            <ChevronRight size={15} />
            <strong>
              {
                {
                  home: "家庭首页",
                  child: current?.nickname || "个人小岛",
                  timer: "专注与游戏",
                  growth: "双人成长",
                  rewards: "奖励小屋",
                  penalties: "惩罚",
                  parent: "家长空间",
                  history: "成长记录",
                }[page]
              }
            </strong>
          </span>
          <div className="top-actions">
            <button className="secondary review-shortcut" aria-label={`待确认 ${pendingReviewCount(data)} 项`} disabled={busy} onClick={()=>{setParentTab("review");nav("parent");}}>待确认<PendingBadge count={pendingReviewCount(data)}/></button>
            <ChildVoiceSettings/>
            <span className="cloud-state">
              <span />
              {online ? "家庭服务器" : "离线"}
            </span>
            <button
              className="icon-button"
              title="刷新记录"
              aria-label="刷新记录"
              onClick={() => load()}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className={"parent-pill "+(parentToken?"parent-unlocked":"parent-locked")}
              disabled={busy}
              onClick={() =>
                parentToken ? void lockParent() : (unlockDestination.current = "parent", setShowUnlock(true))
              }
            >
              <Lock size={17} />
              {parentToken ? "已解锁 · 点击锁定" : "已锁定 · 家长解锁"}
            </button>
          </div>
        </header>
        {!online && (
          <div className="notice" role="status">
            <WifiOff size={18} />
            网络断开，暂时不能打卡。计时仍按实际时间计算，联网后同步。
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="关闭提示" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <WalletCountdownBridge data={data}/>
        {page === "home" && (
          <>
            <div className="heading">
              <div>
                <span className="eyebrow">每一小步，都闪闪发光</span>
                <h1>
                  欢迎回到成长小岛 <span className="sun-mark">☀</span>
                </h1>
                <p>不着急，今天也按照自己的节奏慢慢长大。</p>
              </div>
              <div className="date-chip">
                <CalendarDays size={18} />
                {today.slice(5).replace("-", "月")}日 · 星期
                {dayNames[weekday(today)]}
              </div>
            </div>
            <section className="hero">
              <div className="hero-copy">
                <span className="pill">✦ 今日探险已开启</span>
                <h2>
                  小小的坚持，
                  <br />
                  会长成大大的力量。
                </h2>
                <p>
                  选择自己的小岛，开始今天的小任务。
                  <br />
                  每一次主动尝试，都值得被看见。
                </p>
                <div className="hero-foot">
                  <span className="tiny-stars">✧ ✦ ✧</span>
                  成长没有比赛，每个人都有自己的光。
                </div>
              </div>
              <Island />
            </section>
            <SectionTitle
              title="今天，去谁的小岛？"
              sub="两个独立的空间，两段各自精彩的旅程"
            />
            <div className="children-grid">
              {data.children.map((c) => (
                <ChildCard
                  key={c.id}
                  child={c}
                  data={data}
                  today={today}
                  onClick={() => selectChild(c.id)}
                />
              ))}
            </div>
            <div className="home-bottom">
              <section className="soft-card">
                <div className="section-icon mint">
                  <Leaf />
                </div>
                <div>
                  <h3>专注，从 5 分钟开始</h3>
                  <p>先完成一小段，再休息一下。开始本身就很棒。</p>
                </div>
                <button
                  className="round-arrow"
                  aria-label="进入专注计时"
                  onClick={() => nav("timer")}
                >
                  <ArrowRight />
                </button>
              </section>
              <section className="soft-card warm">
                <div className="section-icon peach">
                  <Heart />
                </div>
                <div>
                  <h3>一起，而不是比较</h3>
                  <p>在家长空间，看见每个孩子相对自己的进步。</p>
                </div>
                <button
                  className="round-arrow"
                  aria-label="查看双人成长"
                  onClick={() => nav("growth")}
                >
                  <ArrowRight />
                </button>
              </section>
            </div>
          </>
        )}
        {page === "penalties" && <PeerPenalties data={data} onSaved={load}/>}
        {page === "child" && current && (
          <>
            
            <div className="heading child-compact-heading">
              <div className="profile-heading">
                <ChildAvatar child={current} size={80} />
                <div>
                  <h1 className="child-island-name">{current.nickname}</h1>
                  <p className="child-island-slogan">今天也有小小的进步</p>
                  
                </div>
              </div>
              <div className="star-badge" aria-label={current.nickname+"的可用星星："+balance(data,current.id)}>
                <Star fill="currentColor" size={22} />
                {balance(data, current.id)}

              </div>
            </div>
            <div className="child-layout">
              <section className="panel task-panel">
                <div className="panel-heading child-task-heading">
                  <h2>{selectedDay === today ? "今日小任务" : "小任务"}</h2>
                  <button className="secondary child-history-action" onClick={() => nav("history")}><BookOpen size={18}/>成长记录</button>
                </div>
                <div className="child-task-tools">
                  <DatePicker
                    value={selectedDay}
                    today={today}
                    onChange={setDate}
                  />
                </div>
                <div className="progress-summary">
                  <span>
                    {progress(data, current.id, selectedDay).rest
                      ? "今天是休息日 🌿"
                      : !progress(data,current.id,selectedDay).total ? "今天没有日常目标" : `日常已完成 ${progress(data, current.id, selectedDay).done} / ${progress(data, current.id, selectedDay).total} 次`}
                  </span>
                  <strong>
                    {progress(data, current.id, selectedDay).rest
                      ? "休息也很重要"
                      : !progress(data,current.id,selectedDay).total ? "—" : progress(data, current.id, selectedDay).rate + "%"}
                  </strong>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: progress(data, current.id, selectedDay).rate + "%",
                      background: current.color,
                    }}
                  />
                </div>
                {progress(data, current.id, selectedDay).rest ? (
                  <div className="empty">今天不用完成任务，好好休息吧。</div>
                ) : (
                  <ChildDayHabitList childId={current.id} day={selectedDay} disabled={busy||!online||selectedDay!==today}
                    habits={visibleChildHabits(data, current.id, selectedDay)}>
                    {(h) => {
                        const approved = data.checkins.filter(
                          (c) =>
                            c.habit_id === h.id &&
                            c.day === selectedDay &&
                            c.status === "approved",
                        );
                        const pending = data.checkins.filter(
                          (c) =>
                            c.habit_id === h.id &&
                            c.day === selectedDay &&
                            c.status === "pending",
                        );
                        const finished = approved.length >= h.target_count;
                        const undoLatest = () => {
                          if(!online){speakChildFeedback("网络暂时断开了，联网后再打卡，你的努力没有白费。");return;}
                          const latest=latestCheckin([...approved,...pending]);
                          if(latest)void mutate("undo_checkin",{id:latest.id});
                        };
                        return (
                          <article
                            key={h.id}
                            className={`task-row ${finished ? "complete" : ""}`}
                          >
                            <div
                              className="task-icon"
                              style={{
                                background: h.color + "18",
                                color: h.color,
                              }}
                            >
                              <HabitArt name={h.name} icon={habitIcon(h.icon)}/>
                            </div>
                            <div className="task-text">
                              <div className="habit-title-voice"><h3>{h.name}</h3><HabitSpeaker name={h.name} id={h.id} childId={h.child_id} parentToken={parentToken}/></div>
                              <p>
                                {h.target_minutes
                                  ? `${h.target_minutes} 分钟 · `
                                  : ""}
                                {h.target_count > 1
                                  ? `${approved.length}/${h.target_count} 次 · `
                                  : ""}
                                <Star size={12} /> +{h.stars} 星星
                                {pending.length > 0 && (
                                  <span className="pending">
                                    {" "}
                                    · {pending.length} 次待家长确认
                                  </span>
                                )}
                              </p>
                            </div>
                              <div className="habit-check-actions">
                              {approved.length + pending.length < h.target_count &&
                              <button type="button" className="check-button habit-check-action" aria-label={`去打卡${h.name}`} disabled={busy} aria-disabled={!online} data-explainable={!online} onClick={()=>{
                                if(!online){speakChildFeedback("网络暂时断开了，联网后再打卡，你的努力没有白费。");return;}
                                void mutate("checkin",{habit_id:h.id,day:selectedDay});
                              }}><Circle size={20}/><span>去打卡</span></button>}
                              {(approved.length>0||pending.length>0)&&
                              <button type="button" className={`check-button habit-check-status habit-check-toggle ${pending.length&&!finished?'awaiting':'done-label'}`}
                                aria-label={`${pending.length&&!finished?'待确认':'已打卡'}，点击撤销最近一次：${h.name}`}
                                disabled={busy} aria-disabled={!online} data-explainable={!online} onClick={undoLatest}>
                                {pending.length&&!finished?<TimerIcon size={20}/>:<CheckCircle2 size={20}/>}
                                <span>{pending.length&&!finished?'待确认':approved.length<h.target_count?`已打卡 ${approved.length}`:'已打卡'}</span>
                              </button>}
                              </div>
                          </article>
                        );
                      }}
                  </ChildDayHabitList>
                )}
                <p className="gentle-note">
                  <Heart size={14} />
                  没做完也没关系，明天可以再尝试。
                </p>
              </section>
              <div className="side-stack">
                <ChildQuickSwitch children={data.children} value={current.id} onChange={id=>selectChild(id,"child")}/>
                <WeekCalendar data={data} child={current} today={today} />
                <GrowthGarden key={current.id} child={current}
                  done={approvedActivityCount(data,current.id,today)}
                  rest={progress(data, current.id, today).rest}
                  feedback={feedback} onFocus={() => nav("timer")} />
                <div className="child-sidebar-stats">
                  <GrowthCards data={data} child={current} today={today} />
                </div>
              </div>
            </div>
            <TimeWallet data={data} child={current} busy={busy} mutate={mutate}/>
            <ChildStarRules key={current.id} data={data} child={current}/>
          </>
        )}
        {page === "timer" && current && (
          <>
            <div className="heading">
              <div>
                <span className="eyebrow">练习掌握自己的节奏</span>
                <h1>专注一会儿，也好好休息</h1>
                <p>
                  计时根据真实时间记录。切换页面或锁屏后，回来可以继续查看。
                </p>
              </div>
              <ChildSelect
                children={data.children}
                value={current.id}
                onChange={(id) => setChildId(id)}
              />
            </div>
            <TimerView
              key={current.id}
              error={error}
              child={current}
              data={data}
              busy={busy}
              mutate={mutate}
            />
          </>
        )}
        {page === "history" && current && <ChildHistory key={current.id} data={data} child={current}
          onChild={setChildId} onBack={() => nav("child")} />}
        {page === "growth" && (
          <>
            <GrowthStatistics data={data} today={today} />
            <div className="children-grid growth-comparison">
              {data.children.map((c) => (
                <section className="growth-column" key={c.id}>
                  <div className="growth-child">
                    <ChildAvatar child={c} size={70} />
                    <div>
                      <h2>{c.nickname}</h2>
                      <p>和过去的自己比一比</p>
                    </div>
                  </div>
                  <GrowthCards data={data} child={c} today={today} />
                  <WeekCalendar data={data} child={c} today={today} />
                  <Trend data={data} child={c} today={today} days={30} />
                </section>
              ))}
            </div>
          </>
        )}
        {page === "rewards" && current && (
          <>
            <ChildQuickSwitch children={data.children} value={current.id} onChange={id=>selectChild(id,"rewards")}/>
            <div className="heading">
              <div>
                <span className="eyebrow">把努力变成温暖的约定</span>
                <h1>奖励小屋</h1>
                <p>{data.switch_settings?.enabled?"设备时间奖励兑换后自动到账；Switch兑换只累加钱包余额，不会立即启动。活动奖励由家长确认。":"时间奖励兑换后自动到账；活动奖励由家长确认。"}</p>
              </div>

            </div>
            <div className="reward-banner">
              <Star size={33} fill="currentColor" />
              <div>
                <h2>{balance(data, current.id)} 颗星星</h2>
                <p>{current.nickname}的可用星星 · 每一点努力都算数</p>
              </div>
            </div>
            <TimeWallet data={data} child={current} busy={busy} mutate={mutate}/>
            <ChildStarRules key={current.id} data={data} child={current}/>
            <RewardShelf key={`reward-shelf:${current.id}`} rewards={data.rewards} childId={current.id} available={balance(data,current.id)} renderReward={(r) => (
                  <article className="reward-card" key={r.id}>
                    <RewardArt reward={r} settings={data}/>
                    <div className="reward-title"><h3>{r.name}</h3><RuleSpeaker label={r.name} text={rewardExplanation(r,{tv:data.tv_settings?.device_id,switch:data.switch_settings?.enabled?data.switch_settings.device_id:null})}/></div>
                    {r.kind === "device_time" && <p>{Math.floor(Number(r.duration_seconds)/60)} 分钟 · 存入余额，准备好再用</p>}
                    <p>
                      <Star size={15} fill="currentColor" /> {r.cost} 颗星星
                    </p>
                    <RewardStarProgress available={balance(data,current.id)} cost={r.cost}/>
                    <button
                      disabled={busy}
                      aria-disabled={balance(data, current.id) < r.cost}
                      data-explainable={balance(data,current.id)<r.cost}
                      className="secondary"
                      onClick={() => {
                        if (balance(data, current.id) < r.cost) { speakChildFeedback("星星还不够，慢慢积累，不着急哦。"); return; }
                        if (r.kind === "device_time") {
                          void mutate("redeem", { child_id: current.id, reward_id: r.id });
                          return;
                        }
                        speakChildFeedback("先看看需要多少星星，确认后再提交愿望哦。");
                        setModal({ kind: "redeem", item: r });
                      }}
                    >
                      {balance(data, current.id) < r.cost
                        ? "慢慢积累，不着急"
                        : "许下这个小愿望"}
                    </button>
                  </article>
                )}/>
            <section className="panel">
              <h2>我的愿望记录</h2>
              {data.redemptions.filter((r) => r.child_id === current.id)
                .length === 0 ? (
                <p className="muted">
                  还没有兑换记录，看看你想和家人一起做什么吧。
                </p>
              ) : (
                data.redemptions
                  .filter((r) => r.child_id === current.id)
                  .map((r) => (
                    <div className="history-row" key={r.id}>
                      <Gift size={18} />
                      <strong>
                        {redemptionName(r, data.rewards)}
                      </strong>
                      <span>
                        {r.cancelled_at ? "已撤销，星星已退回" : r.status === "pending"
                          ? "等待家长确认"
                          : r.status === "approved"
                            ? (r.kind === "device_time" && r.device_id === data.switch_settings?.device_id && data.switch_settings?.enabled ? "Switch余额已到账，不会自动启动" : r.kind === "device_time" && r.device_id === data.tv_settings?.device_id ? "时间已到账，准备好再开始观看" : r.kind === "device_time" ? "时间已到账，可用时段内再开始使用" : "已确认，一起安排时间")
                            : "这次暂未安排"}
                      </span>
                      <time dateTime={r.created_at}>{new Intl.DateTimeFormat("zh-CN", { timeZone: data.family.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(r.created_at))}</time>
                      {(r.status === "pending" || r.status === "approved") && !r.cancelled_at && <button className="text-button" disabled={busy} onClick={()=>void mutate("redeem_undo",{id:r.id,child_id:r.child_id})}>撤销兑换</button>}
                    </div>
                  ))
              )}
            </section>
          </>
        )}
        {page === "parent" && (
          <ParentPanel
            tab={parentTab} setTab={setParentTab}
            onPhotoSaved={refreshAfterPhoto}
            data={data}
            today={today}
            token={parentToken}
            busy={busy}
            mutate={mutate}
            edit={setModal}
            onLogout={() => void auth.signOut().catch((e) => setError(safeError(e)))}
            lock={() => void lockParent()}
          />
        )}
        <footer className="footer">
          <Leaf size={15} />
          成长小岛 · v1.0.4 · 让成长回到每一个温暖的日常
          <span>只记录必要信息 · 数据属于你的家庭</span>
        </footer>
      </main>
      <nav className="mobile-nav" aria-label="主要导航">
        {(
          [
            { p: "home", i: Home, t: "首页" },
            { p: "timer", i: TimerIcon, t: "计时" },
            { p: "growth", i: TrendingUp, t: "成长" },
            { p: "rewards", i: Gift, t: "奖励" },
            { p: "penalties", i: ShieldCheck, t: "惩罚" },
            { p: "parent", i: Settings, t: "家长" },
          ] as const
        ).map((n) => (
          <button
            className={activeMobileNavPage === n.p ? "active" : ""}
            aria-current={activeMobileNavPage === n.p ? "page" : undefined}
            key={n.p}
            onClick={() => nav(n.p)}
          >
            <n.i size={20} />
            <span>{n.t}</span>
          </button>
        ))}
      </nav>
      {showUnlock && (
        <Dialog title="进入家长空间" close={() => { unlockVersion.current++; setShowUnlock(false); }}>
          <p>请输入现有家长密码。重要设置和奖励审核只由家长操作。</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const generation = authGeneration.current;
              const attempt = ++unlockVersion.current;
              const pin = String(new FormData(e.currentTarget).get("pin"));
              try {
                const token = await rpc<string>("unlock_parent", {
                  p_password: pin,
                });
                if (generation !== authGeneration.current || attempt !== unlockVersion.current) {
                  if (token) await rpc("revoke_parent", {p_parent_token: token}).catch(() => {
                    if (generation === authGeneration.current) setError("取消解锁的服务端撤销尚未确认，请重新登录后再使用共用设备。");
                  });
                  return;
                }
                if (!token) throw new Error("invalid_pin");
                setParentToken(token);
                setParentUntil(Date.now() + 29 * 60000);
                setShowUnlock(false);
                setPage(unlockDestination.current);
                unlockDestination.current = "parent";
                setError("");
              } catch (e) {
                if (generation === authGeneration.current) setError(safeError(e));
              } finally {
                if (generation === authGeneration.current) setBusy(false);
              }
            }}
          >
            <Field label="家长密码">
              <input
                autoFocus
                type="password"
                name="pin"
                required
                maxLength={128}
                autoComplete="off"
              />
            </Field>
            <button className="primary" disabled={busy}>
              解锁家长空间 <Lock size={16} />
            </button>
          </form>
          <p className="small">
            解锁约 30 分钟后自动失效。孩子无需登录，请不要分享家长密码。
          </p>
          {error && <p className="error">{error}</p>}
        </Dialog>
      )}
      {modal && (
        <Editor
          modal={modal}
          data={data}
          current={current}
          selectedDay={selectedDay}
          busy={busy}
          error={error}
          mutate={mutate}
          close={() => setModal(old => old === modal ? null : old)}
        />
      )}
      {page !== "parent" && current && <RedemptionUndoNotice data={data} childId={current.id} busy={busy} mutate={mutate}/>}
      {toast && (
        <div className="toast" role="status">
          {feedback && !feedback.pending ? <span className="feedback-buddy" aria-hidden="true"><Animal size={42}/></span> : <CheckCircle2 size={19} />}
          {toast}
        </div>
      )}
      {feedback && !feedback.pending && feedback.childId === current?.id && page === "child" && (
        <div className="celebration" aria-hidden="true">
          ✦ ✧ ⭐ ✧ ✦
        </div>
      )}
    </div>
  );
}
function ChildDayHabitList({
  habits, day, ...listProps
}: React.ComponentProps<typeof SortableHabitList> & { day: string }) {
  const planned: Habit[] = [];
  const displayOnly: Habit[] = [];
  for (const habit of habits) {
    if (scheduled(habit, day)) planned.push(habit);
    else displayOnly.push(habit);
  }
  return (
    <>
      {(planned.length > 0 || displayOnly.length === 0) && (
        <SortableHabitList {...listProps} habits={planned} />
      )}
      {displayOnly.length > 0 && (
        <section className="habit-category-item occasional" aria-label="偶尔习惯 · 遇到再做">
          {!planned.some(h => habitCategory(h) === "occasional") && (
            <h3 className="habit-category-heading">偶尔习惯 · 遇到再做</h3>
          )}
          <div className="sortable-habit-group" role="list">
            {displayOnly.map(h => (
              <div key={h.id} className="task-row" role="listitem">
                <div className="task-icon" style={{ background: h.color + "18", color: h.color }}>
                  <HabitArt name={h.name} icon={habitIcon(h.icon)} />
                </div>
                <div className="task-text"><h3>{h.name}</h3></div>
                <span className="status-pill">当日未排打卡</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-visual">
        <a className="brand">
          <span className="brand-icon">
            <Leaf />
          </span>
          <div>
            成长小岛<small>GROW A LITTLE, EVERY DAY</small>
          </div>
        </a>
        <h1>
          每一小步，
          <br />
          都闪闪发光。
        </h1>
        <p>
          两个独立的小岛，
          <br />
          一个温暖的家。
        </p>
        <Island />
        <span>不比较、不催促，一起慢慢长大。</span>
      </div>
      <div className="auth-card">{children}</div>
    </div>
  );
}
function Login() {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [setup,setSetup]=useState<{configured:boolean;open:boolean}|null>(null);
 useEffect(()=>{fetch("/api/auth/setup",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(setSetup).catch(()=>setMessage("暂时无法连接，请刷新重试。"));},[]);
 const first=setup && !setup.configured;
 return <AuthShell>
 <span className="eyebrow">欢迎来到家庭小岛</span>
 <h1>{first?"设置你的家庭密码":"进入你的家庭小岛"}</h1>
 <p>{first?"设置一次，以后只需输入密码。":"由家长输入密码，再让孩子选择自己的空间。"}</p>
 {first&&!setup.open?<div className="notice">首次设置入口暂未开放，请联系管理员开启。</div>:
 <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setMessage("");const f=new FormData(e.currentTarget);
 try{const password=String(f.get("password"));if(first)await auth.setup(password,String(f.get("confirmation")));else {const {error}=await auth.signInWithPassword({password});if(error)throw error;}}
 catch(e){setMessage(safeError(e));}finally{setBusy(false);}}}>
 <Field label={first?"设置密码":"家庭密码"}><input type="password" name="password" required maxLength={128} autoComplete={first?"new-password":"current-password"} placeholder="输入你自己的密码"/></Field>
 {first&&<Field label="再输入一次"><input type="password" name="confirmation" required maxLength={128} autoComplete="new-password"/></Field>}
 <button className="primary" disabled={busy||!setup}>{busy?"正在连接…":first?"设置并进入小岛":"进入成长小岛"}<ArrowRight size={18}/></button>
 </form>}
 {message&&<div role="status" className="notice">{message}</div>}
 <p className="small">不需要邮箱。密码不要求数字、符号或组合，请勿使用其他重要账号的密码。</p>
 <p className="auth-foot"><ShieldCheck size={16}/>只使用孩子昵称，不需要生日、学校或照片。</p>
 </AuthShell>;
}
function PasswordSettings(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 return <section><h3>修改家长密码</h3><form onSubmit={async e=>{
 e.preventDefault();if(busy)return;setBusy(true);setMessage("");const form=e.currentTarget,f=new FormData(form);
 try{await auth.changePassword(String(f.get("current")),String(f.get("password")),String(f.get("confirmation")));form.reset();setMessage("密码已修改，所有设备需要重新解锁家长模式。");}
 catch(e){setMessage(safeError(e));}finally{setBusy(false);}
 }}>
 <Field label="当前密码"><input type="password" name="current" required maxLength={128} autoComplete="current-password"/></Field>
 <Field label="新密码"><input type="password" name="password" required maxLength={128} autoComplete="new-password"/></Field>
 <Field label="再输入一次新密码"><input type="password" name="confirmation" required maxLength={128} autoComplete="new-password"/></Field>
 <button className="secondary" disabled={busy}>{busy?"正在保存…":"保存新密码"}</button>
 </form>{message&&<p role="status">{message}</p>}</section>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} className="dialog" aria-labelledby={titleId}>
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button aria-label="关闭" className="icon-button" onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}
function ChildSelect({
  children,
  value,
  onChange,
}: {
  children: Child[];
  value: string;
  onChange: (s: string) => void;
}) {
  return <ChildQuickSwitch children={children} value={value} onChange={onChange}/>;
}

function ChildCard({
  child: c,
  data,
  today,
  onClick,
}: {
  child: Child;
  data: Dashboard;
  today: string;
  onClick: () => void;
}) {
  const p = progress(data, c.id, today);
  const earnedVisible = ledgerVisibleForChild(data.ledger_read_scope, c.id);
  const earnedToday = effectiveEarnedStarDays(data, c.id, today, 1)[0].amount;
  return (
    <button
      onClick={onClick}
      className="child-card"
      style={{ "--child-color": c.color } as React.CSSProperties}
    >
      <div className="child-card-top">
        <ChildAvatar child={c} size={92} />
        <div>
          <span className="small-label">我的成长小岛</span>
          <h2>
            {c.nickname}
            <span className="level-badge">探索者</span>
          </h2>
          <p>今天，也来点亮一颗小星星吧</p>
        </div>
        <ArrowRight className="card-arrow" size={22} />
      </div>
      <div className="child-today-earned" title={earnedVisible?"按家庭时区统计今天实际到账且未撤销的收获；含今天批准的历史补卡，不含待审批、兑换消费或退款。":"这个孩子的星星账目当前没有读取权限，所以不显示数字；不要把看不到当成 0 颗星。"} aria-label={earnedVisible?`${c.nickname}今日收获 ${earnedToday} 颗星`:`${c.nickname}今日收获暂不可见`}><Star fill="currentColor" size={22} aria-hidden="true"/><span className="child-earned-copy"><span>今日收获</span><span className="child-earned-amount">{earnedVisible?<><strong>{earnedToday}</strong> 颗星</>:<><strong className="child-earned-unknown">—</strong><span className="child-earned-unknown-note">解锁后可见</span></>}</span></span></div>
      <div className="child-progress">
        <span>{p.rest ? "今天是休息日" : p.total ? "今日日常目标" : "今天没有日常目标"}</span>
        <strong>{p.rest ? "🌿" : `${p.done} / ${p.total}`}</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: p.rate + "%", background: c.color }} />
      </div>
      <div className="child-card-footer">
        <span>
          <Star fill="currentColor" size={16} />
          {balance(data, c.id)} 颗可用星星
        </span>
        <span className="enter-link">
          进入我的小岛 <ArrowRight size={15} />
        </span>
      </div>
      <div className="mini-week">
        {Array.from({ length: 7 }, (_, i) => offsetDay(today, i - 6)).map(
          (d) => {
            const p = progress(data, c.id, d);
            return (
              <div key={d}>
                <small>{dayNames[weekday(d)]}</small>
                <span className={p.rest ? "rest" : approvedActivityCount(data,c.id,d) ? "lit" : ""}>
                  {p.rest ? (
                    "🌿"
                  ) : approvedActivityCount(data,c.id,d) ? (
                    <Check size={13} />
                  ) : (
                    <span className="dot" />
                  )}
                </span>
              </div>
            );
          },
        )}
      </div>
    </button>
  );
}
function DatePicker({
  value,
  today,
  onChange,
}: {
  value: string;
  today: string;
  onChange: (s: string) => void;
}) {
  const [dateError, setDateError] = useState("");
  const errorId = useId();
  const change = (next: string) => {
    if (!validRecordDate(next, today)) {
      setDateError("请选择有效的日期，不能晚于家庭今天的日期。");
      return;
    }
    setDateError("");
    onChange(next);
  };
  return (
    <div>
      <div className="date-picker">
        <button aria-label="前一天" onClick={() => change(offsetDay(value, -1))}>
          <ChevronLeft size={16} />
        </button>
        <input
          aria-label="记录日期"
          type="date"
          value={value}
          max={today}
          aria-invalid={!!dateError}
          aria-describedby={dateError ? errorId : undefined}
          onChange={(e) => change(e.target.value)}
        />
        <button aria-label="后一天" aria-disabled={value >= today} data-explainable={value >= today} onClick={() => {if(value>=today){speakChildFeedback("已经是今天啦，明天的记录明天再来看看。");return;}change(offsetDay(value,1));}}>
          <ChevronRight size={16} />
        </button>
      </div>
      {dateError && <p id={errorId} className="small error" role="alert" style={{maxWidth: "22em"}}>{dateError}</p>}
    </div>
  );
}
function WeekCalendar({
  data,
  child,
  today,
}: {
  data: Dashboard;
  child: Child;
  today: string;
}) {
  return (
    <section className="panel calendar-panel">
      <div className="panel-heading">
        <h3>最近一周</h3>
        <CalendarDays size={19} />
      </div>
      <div className="week-calendar">
        {Array.from({ length: 7 }, (_, i) => offsetDay(today, i - 6)).map(
          (d) => {
            const p = progress(data, child.id, d);
            return (
              <div key={d}>
                <small>{dayNames[weekday(d)]}</small>
                <span
                  title={`${d} · 已打卡 ${approvedActivityCount(data,child.id,d)} 次 · 日常 ${p.done}/${p.total}`}
                  className={`${p.rest ? "rest" : approvedActivityCount(data,child.id,d) ? "lit" : ""} ${d === today ? "today" : ""}`}
                >
                  {p.rest ? (
                    "🌿"
                  ) : approvedActivityCount(data,child.id,d) ? (
                    <Check size={18} />
                  ) : (
                    Number(d.slice(-2))
                  )}
                </span>
              </div>
            );
          },
        )}
      </div>
      <p className="small">有尝试的日子会点亮，休息日不算失败。</p>
    </section>
  );
}
function GrowthCards({
  data,
  child,
  today,
}: {
  data: Dashboard;
  child: Child;
  today: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => offsetDay(today, -i));
  const ps = days.map((d) => progress(data, child.id, d));
  const total = ps.reduce((a, p) => a + p.total, 0),
    done = ps.reduce((a, p) => a + p.done, 0);
  const sessions = data.timers.filter(
    (t) =>
      t.child_id === child.id &&
      t.ended_at &&
      days.includes(localDay(data.family.timezone, new Date(t.ended_at))),
  );
  return (
    <div className="stat-grid">
      <div className="stat-card">
        <span>
          <CheckCircle2 size={17} />近 7 天完成率
        </span>
        <strong>
          {total ? Math.round((done / total) * 100) : "—"}
          {total>0&&<small>%</small>}
        </strong>
        <p>{total?"按自己的日常目标计算":"这段时间没有日常目标"}</p>
      </div>
      <div className="stat-card">
        <span>
          <TimerIcon size={17} />
          专注小积累
        </span>
        <strong>
          {Math.floor(
            sessions
              .filter((t) => t.kind === "focus")
              .reduce((s, t) => s + Number(t.actual_seconds || 0), 0) / 60,
          )}
          <small>分钟</small>
        </strong>
        <p>每一小段努力都算数</p>
      </div>
      <div className="stat-card">
        <span>
          <Gamepad2 size={17} />
          游戏守约
        </span>
        <strong>
          {
            sessions.filter(
              (t) =>
                t.kind === "game" &&
                (t.on_time === true || t.status === "completed"),
            ).length
          }
          <small>次</small>
        </strong>
        <p>如实记录，不扣已有星星</p>
      </div>
    </div>
  );
}
function Trend({data,child,today,days}:{data:Dashboard;child:Child;today:string;days:number}) {return <><EarnedStarsTrend data={data} child={child} today={today} days={days}/><BalanceStarsTrend data={data} child={child} today={today} days={days}/></>;}
function TimerView({
  error,
  child,
  data,
  busy,
  mutate,
}: {
  error: string;
  child: Child;
  data: Dashboard;
  busy: boolean;
  mutate: (a: string, p: Record<string, unknown>) => Promise<any>;
}) {
  const [kind, setKind] = useState<"focus" | "game">("focus"),
    [minutes, setMinutes] = useState("5"),
    [minuteError, setMinuteError] = useState(""),
    [now, setNow] = useState<number | null>(() => serverClock.now()),
    [finish, setFinish] = useState(false);
  const live = data.timers.find(
    (t) =>
      t.child_id === child.id &&
      (t.status === "running" || t.status === "paused"),
  );
  const currentKind = live?.kind || kind;
  useEffect(() => {
    let active = true;
    const tick = () => { if (active) setNow(serverClock.now()); };
    const sync = async () => { try { await synchronizeServerClock(); } catch {} finally { tick(); } };
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      serverClock.invalidate(); tick(); void sync();
    };
    tick(); void sync();
    const id = setInterval(tick, 250);
    const calibration = setInterval(() => { if (document.visibilityState !== "hidden") void sync(); }, 30000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    return () => { active = false; clearInterval(id); clearInterval(calibration); document.removeEventListener("visibilitychange", resume); window.removeEventListener("pageshow", resume); window.removeEventListener("focus", resume); };
  }, []);
  // RPC samples are observed before the new dashboard reaches this component.
  const clockNow = serverClock.now();
  const calibrated = clockNow !== null || live?.status === "paused";
  const seconds = live ? elapsed(live, clockNow ?? now ?? Date.parse(live.started_at)) : 0;
  const target =
    live?.target_seconds ||
    (currentKind === "focus"
      ? focusDurationSeconds(minutes) ?? 0
      : gameSecondsRemaining(data, child, localDay(data.family.timezone, new Date(clockNow ?? Date.now()))));
  const remaining = Math.max(0, target - seconds);
  const complete = Boolean(live && calibrated && remaining === 0);
  const autoFinish = useRef("");
  const nextAutoAttempt = useRef(0);
  useEffect(() => {
    if (
      live &&
      live.kind === "focus" &&
      live.status === "running" &&
      remaining === 0 &&
      calibrated &&
      !busy &&
      autoFinish.current !== live.id && performance.now() >= nextAutoAttempt.current
    ) {
      autoFinish.current = live.id;
      nextAutoAttempt.current = performance.now() + 2000;
      // A network midpoint estimate can be slightly ahead. Confirm with database
      // time before auto-finishing so a valid focus is never marked stopped early.
      void synchronizeServerClock().then(async (confirmed) => {
        if (confirmed === null || elapsed(live, confirmed) < live.target_seconds) {
          autoFinish.current = ""; return;
        }
        const result = await mutate("timer_finish", { id: live.id });
        if (!result) autoFinish.current = "";
      }).catch(() => { autoFinish.current = ""; });
    }
  }, [live, remaining, calibrated, now, busy, mutate]);
  const history = newestFirst(data.timers.filter((t) => t.child_id === child.id && t.ended_at), t => t.started_at)
    .slice(0, 8);
  return (
    <>
      <div className="timer-layout">
        <section className={`timer-card ${currentKind}`}>
          <div className="segmented timer-tabs">
            <button
              className={currentKind === "focus" ? "active" : ""}
              aria-disabled={!!live} data-explainable={!!live}
              onClick={() => { if (live) { speakChildFeedback("还有一段计时在进行，结束后再切换吧。"); return; } setKind("focus"); }}
            >
              <BookOpen size={18} />
              专注一会儿
            </button>
            <button
              className={currentKind === "game" ? "active" : ""}
              aria-disabled={!!live} data-explainable={!!live}
              onClick={() => { if (live) { speakChildFeedback("还有一段计时在进行，结束后再切换吧。"); return; } setKind("game"); }}
            >
              <Gamepad2 size={18} />
              游戏约定
            </button>
          </div>
          <p className="eyebrow">
            {child.nickname}的
            {currentKind === "focus" ? "小小专注时光" : "游戏时间"}
          </p>
          <div
            className="timer-ring"
            style={
              {
                "--progress": `${target > 0 ? Math.min(100, (seconds / target) * 100) : 0}%`,
              } as React.CSSProperties
            }
          >
            <div>
              <span className="timer-number" role="timer" aria-label="剩余时间">
                {live && !calibrated ? "校准中" : formatDuration(remaining)}
              </span>
              <span>
                {live && !calibrated ? "计时记录已保存，正在同步服务器时间" : live?.status === "paused"
                  ? "暂停一下，也没关系"
                  : !live && currentKind === "game" && target === 0
                    ? "今天的游戏时间已用完，明天再继续吧"
                  : complete
                    ? currentKind === "game"
                      ? "请保存游戏，主动结束"
                      : "这一小段，你做到了！"
                    : currentKind === "game"
                      ? "玩得开心，也记得约定"
                      : "只做眼前这一件小事"}
              </span>
            </div>
          </div>
          {!live && currentKind === "focus" && (
            <div className="duration-options">
              {[5, 8, 10, 12, 15].map((n) => (
                <button
                  className={minutes === String(n) ? "selected" : ""}
                  onClick={() => { setMinutes(String(n)); setMinuteError(""); }}
                  key={n}
                >
                  {n} 分钟
                </button>
              ))}
              <label>
                自定{" "}
                <input
                  aria-label="自定义专注分钟"
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  value={minutes}
                  aria-invalid={!!minuteError}
                  aria-describedby={minuteError ? "focus-minute-error" : undefined}
                  onChange={(e) => { setMinutes(e.target.value); setMinuteError(""); }}
                />{" "}
                分钟
              </label>
            </div>
          )}
          {!live && currentKind === "focus" && minuteError && <p id="focus-minute-error" className="error" role="alert">{minuteError}</p>}
          {live && currentKind === "game" && remaining <= 300 && !complete && (
            <div className="timer-reminder" role="status">
              还有不到 5 分钟，准备找一个合适的保存点吧。
            </div>
          )}
          {complete && (
            <div className="timer-reminder" role="alert">
              {currentKind === "game"
                ? "时间到了，保存进度，然后和游戏说再见吧。"
                : "专注时间到了！正在保存这次努力。"}
            </div>
          )}
          <div className="timer-controls">
            {!live ? (
              <button
                className="primary"
                disabled={busy}
                aria-disabled={currentKind === "game" && target === 0}
                onClick={() => {
                  if (currentKind === "game" && target === 0) { speakChildFeedback("今天约定的游戏时间用完啦，换一件喜欢的事情吧。"); return; }
                  const requested = currentKind === "focus" ? focusDurationSeconds(minutes) : target;
                  if (requested === null) { setMinuteError("请输入 1 到 120 之间的整数分钟。"); speakChildFeedback("选一个一到一百二十之间的整数分钟，我们从一小段开始吧。"); return; }
                  setMinuteError("");
                  void enableCountdownSound(false);
                  void mutate("timer_start", {
                    child_id: child.id,
                    kind: currentKind,
                    target_seconds: requested,
                  });
                }}
              >
                <Play size={19} />
                开始{currentKind === "focus" ? "专注" : "游戏时间"}
              </button>
            ) : (
              <>
                {currentKind === "focus" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      mutate(
                        live.status === "paused"
                          ? "timer_resume"
                          : "timer_pause",
                        { id: live.id },
                      )
                    }
                  >
                    {live.status === "paused" ? (
                      <Play size={18} />
                    ) : (
                      <Pause size={18} />
                    )}{" "}
                    {live.status === "paused" ? "继续" : "暂停"}
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    currentKind === "game"
                      ? setFinish(true)
                      : mutate("timer_finish", { id: live.id })
                  }
                >
                  <Square size={17} />
                  {complete ? "完成记录" : "结束并记录"}
                </button>
              </>
            )}
          </div>

          <p className="small">
            {currentKind === "game"
              ? "游戏计时不可暂停；再次开始只使用当天剩余额度。"
              : "提前结束也会保存实际时长，不会假装已经完成。"}
          </p>
        </section>
        <div className="side-stack">
          <section className="panel buddy-panel">
            <ChildAvatar child={child} size={105} />
            <h3>
              {currentKind === "focus"
                ? "先试 5 分钟就好"
                : "结束，也是很棒的能力"}
            </h3>
            <p>
              {currentKind === "focus"
                ? "清好桌面，只留一件要做的事。完成后站起来，喝口水，伸个懒腰。"
                : "开始前说好时间。快结束时保存进度，下一次依然可以继续。"}
            </p>
          </section>
          <section className="panel">
            <h3>给家长的小提示</h3>
            <p className="muted">
              计时可以帮助建立约定，但不会关闭任何游戏设备。
            </p>
            <div className="notice">
              iPad 锁屏或切到其他 App
              后，声音和弹窗提醒不保证出现。返回页面时会按真实时间恢复。
            </div>
          </section>
        </div>
      </div>
      <section className="panel">
        <h2>最近的练习</h2>
        {!history.length ? (
          <p className="muted">第一段练习，从今天开始。</p>
        ) : (
          history.map((t) => (
            <div className="history-row" key={t.id}>
              {t.kind === "focus" ? (
                <TimerIcon size={19} />
              ) : (
                <Gamepad2 size={19} />
              )}
              <div>
                <strong>{t.kind === "focus" ? "专注训练" : "游戏约定"}</strong>
                <small>
                  {new Intl.DateTimeFormat("zh-CN", {
                    timeZone: data.family.timezone,
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(t.started_at))}
                </small>
              </div>
              <span>{formatDuration(t.actual_seconds || 0)}</span>
              <span className="status-pill">
                {t.status === "completed"
                  ? t.kind === "game"
                    ? "按时结束"
                    : "完成目标"
                  : t.kind === "game"
                    ? "这次没做到，下次再试"
                    : "已记录努力"}
              </span>
            </div>
          ))
        )}
      </section>
      {finish && live && (
        <Dialog title="这次游戏约定怎么样？" close={() => setFinish(false)}>
          {error && <p role="alert" className="error">{error}</p>}
          <p>如实记录就好，不会扣掉你之前获得的星星。</p>
          <button
            className="primary full"
            disabled={busy}
            onClick={async () => {
              const result = await mutate("timer_finish", {
                id: live.id,
                kept_agreement: true,
              });
              if (result) setFinish(false);
            }}
          >
            我主动结束了
          </button>
          <button
            className="secondary full"
            disabled={busy}
            onClick={async () => {
              const result = await mutate("timer_finish", {
                id: live.id,
                kept_agreement: false,
              });
              if (result) setFinish(false);
            }}
          >
            这次没做到，下次再试
          </button>
          <p className="small">
            超过约定时间 1 分钟后，即使选主动结束，也会如实记录为未按时。
          </p>
        </Dialog>
      )}
    </>
  );
}
function ParentPanel({
  tab,setTab,
  onPhotoSaved,
  data,
  today,
  token,
  busy,
  mutate,
  edit,
  lock,
  onLogout,
}: {
  tab:string; setTab:(tab:string)=>void;
  data: Dashboard;
  today: string;
  token: string;
  busy: boolean;
  mutate: (a: string, p: Record<string, unknown>) => Promise<any>;
  edit: (x: any) => void;
  lock: () => void;
  onLogout: () => void;
  onPhotoSaved: () => void;
}) {
  const [rewardKind,setRewardKind]=useState<"rewards"|"penalties">("rewards");
  const pending = data.checkins.filter((c) => c.status === "pending"),
    requests = data.redemptions.filter((r) => r.status === "pending");
  function download(format: "json" | "csv") {
    if (!token) return;
    let content = JSON.stringify(data, null, 2);
    if (format === "csv") {
      const cell = csvCell;
      content =
        "\uFEFF" +
        [
          ["孩子", "日期", "习惯", "状态", "星星", "补录原因"],
          ...data.checkins.map((c) => [
            data.children.find((x) => x.id === c.child_id)?.nickname,
            c.day,
            checkinHabitName(data, c),
            c.status,
            c.stars,
            c.reason,
          ]),
        ]
          .map((r) => r.map(cell).join(","))
          .join("\r\n");
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([content], {
        type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
      }),
    );
    a.download = `成长小岛-${today}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <>
      <div className="heading">
        <div>
          <span className="eyebrow">小岛守护者空间</span>
          <h1>陪伴成长，不替代成长</h1>
          <p>分别设置每个孩子的节奏，给尝试留出空间。</p>
        </div>
        <button className="secondary" onClick={lock} disabled={busy}>
          <Lock size={17} />
          锁定家长空间
        </button>
      </div>
      <div className="parent-tabs">
        {[
          ["children", "孩子与习惯"],
          ["review", "待确认"],
          ["rewards", "奖励和惩罚"],
          ["accountBook", "星星与时间账本"],
          ["starRules", "星星约定"],
          ["settings", "家庭设置"],
["tv", "电视时间"],
["switchStatus", "Switch 状态与记录"],
        ].map(([v, t]) => (
          <button
            key={v}
            className={tab === v ? "active" : ""}
            onClick={() => setTab(v)}
          >
            {t}{v==="review"&&<PendingBadge count={pendingReviewCount(data)}/>}
          </button>
        ))}
      </div>
      {!token ? (
        <div className="notice">家长身份已过期，请重新解锁。</div>
      ) : (
        <>
          {(tab === "accountBook" || tab === "history") && <ParentAccountBook data={data} token={token} busy={busy} mutate={mutate}/> }
          {tab === "switchStatus" && <ParentSwitchStatus token={token} timezone={data.family.timezone} dashboard={data}/> }
          {tab === "tv" && <ParentTvSettings key={`${data.tv_settings?.device_id}:${data.tv_settings?.revision}:${!!data.tv_settings?.config}`} data={data} busy={busy} mutate={mutate} token={token}/> }

{tab === "starRules" && <ParentStarRules data={data} busy={busy} mutate={mutate}/>}
          <div hidden={tab !== "children"}><ParentHabitRules data={data} busy={busy} mutate={mutate}/></div>
          {data.children.map((c) => (
              <section key={c.id} hidden={tab !== "children"} className="panel parent-child-panel">
                <div className="panel-heading">
                  <div className="growth-child parent-child-identity">
                    <PhotoUpload child={c} token={token} onSaved={onPhotoSaved} />
                    <div>
                      <div className="parent-child-name"><h2>{c.nickname}</h2><ChildStarBalance data={data} child={c} /></div>
                      <p>
                        游戏：工作日 {c.weekday_minutes} 分钟 · 周末{" "}
                        {c.weekend_minutes} 分钟
                      </p>
                    </div>
                  </div>
                  <div className="parent-child-actions"><button
                    className="secondary"
                    onClick={() => edit({ kind: "child", item: c })}
                  >
                    编辑资料
                  </button>
                  <button className="primary" onClick={()=>edit({kind:"manualStars",item:{child_id:c.id}})}><Star size={17}/>临时加星星</button></div>
                </div>
              </section>
            ))}
          {tab === "review" && (
            <section className="panel">
              <h2>把努力好好看见</h2><HistoryProposalReview data={data} busy={busy} mutate={mutate}/>
              {!pending.length && !requests.length && !(data.history_proposals||[]).some(p=>p.status==="pending") && (
                <div className="empty">
                  <CheckCircle2 size={32} />
                  <h3>所有记录都已确认</h3>
                  <p>今天也给孩子一个具体的鼓励吧。</p>
                </div>
              )}
              <CheckinReviewList data={data} busy={busy} mutate={mutate}/>
              {requests.map((r) => (
                <div className="review-row" key={r.id}>
                  <div>
                    <h3>
                      {data.children.find((x) => x.id === r.child_id)?.nickname}{" "}
                      · {redemptionName(r, data.rewards)}
                    </h3>
                    <p>申请于 {requestTime(r.created_at,data.family.timezone)}</p>
                    <p>兑换 {r.cost} 星星 · 已预留，暂不安排会退回</p>
                    {r.kind === "device_time" && <p>{r.device_name} · 确认后存入 {Math.floor(Number(r.duration_seconds)/60)} 分钟</p>}
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      mutate("redemption_review", { id: r.id, approve: false })
                    }
                  >
                    暂不安排
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      mutate("redemption_review", { id: r.id, approve: true })
                    }
                  >
                    确认兑换
                  </button>
                </div>
              ))}
            </section>
          )}
          {tab === "rewards" && <nav className="child-quick-switch reward-kind-switch" aria-label="奖励和惩罚"><button type="button" aria-pressed={rewardKind==="rewards"} onClick={()=>setRewardKind("rewards")}><Gift size={20}/>奖励</button><button type="button" aria-pressed={rewardKind==="penalties"} onClick={()=>setRewardKind("penalties")}><ShieldCheck size={20}/>惩罚</button></nav>}
          {tab === "rewards" && rewardKind==="penalties" && <PenaltyRuleSettings token={token} busy={busy}/>}
          {tab === "rewards" && rewardKind==="rewards" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>一起期待的小事情</h2>
                <button
                  className="primary"
                  onClick={() =>
                    edit({
                      kind: "reward",
                      item: { name: "", cost: 10, child_id: null },
                    })
                  }
                >
                  <Plus size={17} />
                  创建奖励
                </button>
              </div>
              {data.rewards
                .filter(r => !r.archived_at)
                .map((r) => (
                  <div className="admin-row" key={r.id}>
                    <Gift size={22} />
                    <div>
                      <strong>{r.name}</strong>
                      <p>
                        {r.cost} 星星 · {r.kind === "device_time" ? `${Math.floor(Number(r.duration_seconds)/60)} 分钟 · ` : ""}{r.active === false ? "已停用 · " : ""}{" "}
                        {r.child_id
                          ? data.children.find((c) => c.id === r.child_id)
                              ?.nickname
                          : "两个孩子均可兑换"}
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => edit({ kind: "reward", item: r })}
                    >
                      编辑
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`删除${r.name}`}
                      disabled={busy}
                      onClick={() => edit({ kind: "deleteReward", item: r })}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
            </section>
          )}
          {(tab === "accountBook" || tab === "history") && (
            <details className="panel history-panel account-history-tools"><summary>补录、休息日与记录修正</summary><section>
              <div className="panel-heading">
                <h2>记录、补录与休息日</h2>
                <button
                  className="secondary"
                  onClick={() =>
                    edit({
                      kind: "rest",
                      item: {
                        child_id: data.children[0]?.id,
                        day: today,
                        is_rest: true,
                      },
                    })
                  }
                >
                  管理休息日
                </button>
              </div>
              <p className="muted">
                补打卡：进入孩子主页后切换日期，再点击对应任务。撤销保留审计记录。
              </p>
              {data.rests.map((r) => (
                <div className="history-row" key={r.id}>
                  <Leaf size={18} />
                  <span>
                    {data.children.find((c) => c.id === r.child_id)?.nickname} ·{" "}
                    {r.day} 休息
                  </span>
                  <small>{r.reason}</small>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      mutate("rest_save", {
                        child_id: r.child_id,
                        day: r.day,
                        is_rest: false,
                      })
                    }
                  >
                    取消休息日
                  </button>
                </div>
              ))}
              <h3>游戏记录修正</h3>
              {!data.timers.some(t => t.kind === "game" && t.ended_at) && <p className="history-empty">还没有已结束的游戏记录。</p>}
              {newestFirst(data.timers.filter((t) => t.kind === "game" && t.ended_at), t => t.started_at)
                .slice(0, 10)
                .map((t) => (
                  <div className="history-row" key={t.id}>
                    <span>
                      {data.children.find((c) => c.id === t.child_id)?.nickname}{" "}
                      · {localDay(data.family.timezone, new Date(t.started_at))}{" "}
                      · {t.status === "completed" ? "已守约" : "未守约"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => edit({ kind: "timerReview", item: t })}
                    >
                      修正记录
                    </button>
                  </div>
                ))}
              <h3>家长鼓励加星记录</h3>
              {!data.manual_star_grants?.length && <p className="history-empty">还没有临时加星记录，孩子的每份努力都会留在这里。</p>}
              {newestFirst(data.manual_star_grants||[],g=>g.created_at).slice(0,30).map(g=><div className="history-row" key={g.id}><strong>{data.children.find(c=>c.id===g.child_id)?.nickname} · +{g.amount} 星星</strong><span>{g.reason}{g.reversed_at && <><br/><strong>已纠正：−{g.amount} 星星</strong><br/>{g.reversal_reason}</>}</span><small>{localDay(data.family.timezone,new Date(g.created_at))}</small></div>)}
              <h3>最近记录</h3>
              {!data.checkins.length && <p className="history-empty">完成第一次习惯打卡后，就能在这里查看。</p>}
              {newestFirst(data.checkins, c => c.created_at)
                .slice(0, 40)
                .map((c) => (
                  <div className="history-row" key={c.id}>
                    <div>
                      <strong>
                        {
                          data.children.find((x) => x.id === c.child_id)
                            ?.nickname
                        }{" "}
                        · {checkinHabitName(data, c)}
                      </strong>
                      <small>
                        {c.day} {c.reason}
                      </small>
                    </div>
                    <span>
                      {
                        {
                          approved: "已确认",
                          pending: "待确认",
                          undone: "已撤销",
                          rejected: "未确认",
                        }[c.status]
                      }
                    </span>
                    {["approved", "pending"].includes(c.status) && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => mutate("undo_checkin", { id: c.id })}
                      >
                        撤销
                      </button>
                    )}
                  </div>
                ))}
            </section></details>
          )}
          {tab === "settings" && (
            <section className="panel settings-panel">
              <h2>家庭设置与数据</h2>
              <p>
                家庭日期与计时统计使用 {data.family.timezone}
                。修改时区会改变今天的日期边界，请谨慎调整。
              </p>
              <button
                className="secondary"
                onClick={() => edit({ kind: "family", item: data.family })}
              >
                <Settings size={18} />
                修改家庭名称与时区
              </button>
              <h3>密码输错保护</h3>
              <label className="check-label"><input type="checkbox" checked={!!data.family.login_lockout_enabled} disabled={busy} onChange={e=>void mutate("parent_lockout",{enabled:e.target.checked})}/>连续输错 5 次，暂停尝试 10 分钟</label>
              <p className="small">默认关闭。关闭时不会因输错次数锁定；开启后可以防止反复猜密码。</p>
              <PasswordSettings />
              <DevicesPanel data={data} edit={edit}/>
              <h3>导出你的家庭记录</h3>
              <p className="muted">
                JSON 包含完整读取快照；CSV
                包含习惯打卡。下载文件请妥善保存，不包含家长密码。
              </p>
              <div className="button-row">
                <button className="secondary" onClick={() => download("json")}>
                  <Download size={17} />
                  导出 JSON
                </button>
                <button className="secondary" onClick={() => download("csv")}>
                  <Download size={17} />
                  导出 CSV
                </button>
              </div>
              <h3>添加到 iPad 主屏幕</h3>
              <p>
                用 Safari 打开网站 → 轻点分享按钮 →「添加到主屏幕」→
                添加。登录后即可像独立 App 一样打开。
              </p>
              <div className="notice">
                当前版本需要联网打卡，离线自动同步将在后续版本提供。不要清除账号数据作为备份方式。
              </div>
              <button
                className="text-button danger"
                onClick={onLogout}
              >
                <LogOut size={17} />
                退出家长账号
              </button>
            </section>
          )}
        </>
      )}
    </>
  );
}
function Editor({
  inline = false,
  modal,
  data,
  current,
  selectedDay,
  busy,
  error,
  mutate,
  close,
}: {
  inline?: boolean;
  modal: { kind: string; item?: any };
  data: Dashboard;
  current?: Child;
  selectedDay: string;
  busy: boolean;
  error: string;
  mutate: (a: string, p: Record<string, unknown>) => Promise<any>;
  close: () => void;
}) {
  const { kind, item: i = {} } = modal;
  const isBoundSwitchReward = kind === "redeem" && i.kind === "device_time" && !!data.switch_settings?.enabled && i.device_id === data.switch_settings.device_id;
  const [saveError, setSaveError] = useState("");
  const [rewardSuggestion, setRewardSuggestion] = useState("");
  const [familyTimezone,setFamilyTimezone]=useState(i.timezone||data.family.timezone);
  const [suggestedMinutes,setSuggestedMinutes] = useState(i.duration_seconds ? Number(i.duration_seconds)/60 : 15);
  const [rewardKind,setRewardKind] = useState<"activity"|"device_time">(i.kind||"activity");
  const [week, setWeek] = useState<number[]>(
    i.weekdays || [1, 2, 3, 4, 5, 6, 7],
  );
  const titles: Record<string, string> = {
    child: "编辑小岛居民",
    habit: "设置一个小习惯",
    reward: "设置家庭奖励",
    family: "家庭设置",
    rest: "安排休息日",
    backdate: "补录一次努力",
    redeem: "确认这个小愿望",
    deleteHabit: "移除这个习惯？",
    deleteReward: "移除这个奖励？",
    timerReview: "修正游戏守约记录",
    device: "设置奖励时间设备",
  };
  if (kind === "manualStars") return <Dialog title="家长临时加星星" close={close}><ManualStarsForm data={data} initialChild={i.child_id} busy={busy} error={error} mutate={mutate} close={close}/></Dialog>;
  const content = (
    <>
      {inline && <h3>{i.id ? "编辑已有习惯" : "添加新习惯"}</h3>}
      {inline && saveError && <p role="alert" className="error">{saveError}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const v = (k: string) => String(f.get(k) || "");
          const n = (k: string) => Number(f.get(k));
          let action = "",
            payload: Record<string, unknown> = {};
          if (kind === "child") {
            action = "child_save";
            payload = {
              id: i.id,
              nickname: v("nickname"),
              avatar: v("avatar"),
              color: v("color"),
              weekday_minutes: n("weekday_minutes"),
              weekend_minutes: n("weekend_minutes"),
            };
          }
          if (kind === "habit") {
            action = "habit_save";
            payload = {
              ...(i.id ? { id: i.id } : {}),
              child_id: i.child_id,
              name: v("name"),
              icon: v("icon"),
              color: v("color"),
              weekdays: week,
              target_count: n("target_count"),
              target_minutes: n("target_minutes"),
              stars: n("stars"),
              requires_approval: f.has("requires_approval"),
              active: f.has("active"),
            };
          }
          if (kind === "reward") {
            action = "reward_save";
            payload = {
              ...(i.id ? { id: i.id } : {}),
              name: v("name"),
              cost: n("cost"),
              child_id: f.has("make_family_reward")?null:(v("child_id") || null),
              active: f.has("active"),
              kind: rewardKind,
              device_id: rewardKind === "device_time" ? v("device_id") : null,
              duration_seconds: rewardKind === "device_time" ? Number(suggestedMinutes)*60 : null,
            };
          }
          if (kind === "device") {
            action = "device_save";
            payload = {...(i.id ? {id:i.id} : {}),name:v("name"),active:f.has("active"),...(i.id&&i.id===data.tv_settings?.device_id?{}:{cooldown_seconds:n("cooldown_minutes")*60,max_extensions:n("max_extensions"),schedule_enabled:f.has("schedule_enabled"),schedules:JSON.parse(v("device_schedules")||"[]")})};
          }
          if (kind === "family") {
            action = "family_save";
            payload = {
              name: v("name"),
              timezone: v("timezone"),
              ...(v("timezone")!==data.family.timezone&&data.star_rule_versions?.length?{confirm_star_timezone:f.has("confirm_star_timezone")}:{}),
            };
          }
          if (kind === "rest") {
            action = "rest_save";
            payload = {
              child_id: v("child_id"),
              day: v("day"),
              reason: v("reason"),
              is_rest: true,
            };
          }
          if (kind === "backdate") {
            action = "checkin";
            payload = { habit_id: i.id, day: selectedDay, reason: v("reason") };
          }
          if (kind === "redeem") {
            action = "redeem";
            payload = { child_id: current!.id, reward_id: i.id };
          }
          if (kind === "timerReview") {
            action = "timer_review";
            payload = {
              id: i.id,
              kept_agreement: v("kept_agreement") === "true",
              reason: v("reason"),
            };
          }
          if (kind === "deleteHabit") {
            action = "habit_delete";
            payload = { id: i.id };
          }
          if (kind === "deleteReward") {
            action = "reward_delete";
            payload = { id: i.id };
          }
          setSaveError("");
          const result = await mutate(action, payload);
          if (result) close();
          else setSaveError("未能保存，请检查网络或家长解锁状态后重试。填写内容已保留。");
        }}
      >
        {kind === "device" && <>
          <Field label="设备名称"><input name="name" required maxLength={60} defaultValue={i.name} placeholder="例如：客厅电视、Switch"/></Field>
          <label className="checkbox"><input type="checkbox" name="active" defaultChecked={i.active !== false}/>启用这个时间类别</label>
          {(!i.id||i.id!==data.tv_settings?.device_id)&&<>
            <DeviceScheduleFields device={i} timezone={data.family.timezone}/>
            <Field label="每次结束后休息（分钟）"><input name="cooldown_minutes" type="number" required min="0" max="1440" step="1" defaultValue={(i.cooldown_seconds??900)/60}/></Field>
            <Field label="每次最多追加几次"><input name="max_extensions" type="number" required min="0" max="20" step="1" defaultValue={i.max_extensions??1}/></Field>
            <p className="small">0 表示不设冷却或不允许追加。按孩子分别计算；修改只影响下一次开始，不改变正在使用的约定。</p>
          </>}

          <p className="small">停用后不能开始新的奖励计时，已存余额和使用记录保留。这里不连接或控制设备。</p>
        </>}
        {kind === "child" && (
          <>
            <Field label="昵称">
              <input
                name="nickname"
                defaultValue={i.nickname}
                required
                maxLength={20}
              />
            </Field>
            <div className="form-two">
              <Field label="动物伙伴">
                <select name="avatar" defaultValue={i.avatar}>
                  <option value="fox">小狐狸</option>
                  <option value="bear">小熊</option>
                </select>
              </Field>
              <Field label="主题颜色">
                <input type="color" name="color" defaultValue={i.color} />
              </Field>
              <Field label="工作日游戏（分钟）">
                <input
                  type="number"
                  name="weekday_minutes"
                  min="0"
                  max="180"
                  defaultValue={i.weekday_minutes}
                />
              </Field>
              <Field label="周末游戏（分钟）">
                <input
                  type="number"
                  name="weekend_minutes"
                  min="0"
                  max="180"
                  defaultValue={i.weekend_minutes}
                />
              </Field>
            </div>
          </>
        )}
        {kind === "habit" && (
          <>
            {<>
              <Field label="从一个生活小步骤开始（可选）">
                <select aria-label="生活习惯模板" defaultValue="" onChange={e => {
                  const template = habitTemplates.find(t => t.id === e.currentTarget.value);
                  const form = e.currentTarget.form;
                  if (!template || !form) return;
                  (form.elements.namedItem("name") as HTMLInputElement).value = template.name;
                  (form.elements.namedItem("icon") as HTMLSelectElement).value = habitIcon(template.icon);
                }}>
                  <option value="">自己填写，或选择一个建议</option>
                  {habitTemplates.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <p className="small">只填入建议，不会自动保存。可以继续修改星期、星星和审核方式，再保存给这个孩子。陪伴、吃饭和阅读不需要靠积分换取。</p>
            </>}
            <Field label="习惯名称">
              <input
                name="name"
                defaultValue={i.name}
                required
                maxLength={60}
              />
            </Field>
            <div className="form-two">
              <Field label="图标">
                <select name="icon" defaultValue={habitIcon(i.icon)}>
                  {Object.keys(icons).map((k, idx) => (
                    <option value={k} key={k}>
                      {
                        [
                          "星星",
                          "阅读",
                          "专注",
                          "游戏",
                          "书包",
                          "整理",
                          "睡眠",
                          "运动",
                          "爱心",
                        ][idx]
                      }
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="颜色">
                <input name="color" type="color" defaultValue={i.color} />
              </Field>
            </div>
            <label className="field">
              <span>执行星期</span>
              <div className="button-row"><button type="button" className="secondary" onClick={()=>setWeek([1,2,3,4,5,6,7])}>全选星期</button><button type="button" className="secondary" onClick={()=>setWeek([])}>清除星期</button></div><div className="weekday-options">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    type="button"
                    className={week.includes(d) ? "selected" : ""}
                    key={d}
                    onClick={() =>
                      setWeek(
                        week.includes(d)
                          ? week.filter((x) => x !== d)
                          : [...week, d],
                      )
                    }
                  >
                    {dayNames[d % 7]}
                  </button>
                ))}
              </div>
            </label>
            <div className="form-two">
              <Field label="每日目标次数">
                <input
                  type="number"
                  name="target_count"
                  min="1"
                  max="20"
                  defaultValue={i.target_count}
                />
              </Field>
              <Field label="目标时长（0 表示不计时）">
                <input
                  type="number"
                  name="target_minutes"
                  min="0"
                  max="120"
                  defaultValue={i.target_minutes}
                />
              </Field>
              <Field label="每次奖励星星">
                <input
                  type="number"
                  name="stars"
                  min="0"
                  max="20"
                  defaultValue={i.stars}
                />
              </Field>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                name="requires_approval"
                defaultChecked={i.id ? i.requires_approval : true}
              />
              需要家长审核后发放星星
            </label>
            <label className="checkbox">
              <input type="checkbox" name="active" defaultChecked={i.active} />
              启用这个习惯
            </label>
          </>
        )}
        {kind === "reward" && (
          <>
            {!i.id && <>
              <Field label="温暖的家庭奖励建议（可选）">
                <select aria-label="家庭奖励模板" value={rewardSuggestion} onChange={e => {
                  const choice = rewardTemplates.find(t => t.id === e.currentTarget.value);
                  setRewardSuggestion(e.currentTarget.value);
                  const form = e.currentTarget.form;
                  if (!choice || !form) return;
                  const minutes = "minutes" in choice ? choice.minutes : undefined;
                  if (minutes) {setSuggestedMinutes(minutes);setRewardKind("device_time");} else setRewardKind("activity");
                  (form.elements.namedItem("name") as HTMLInputElement).value = choice.name;
                  (form.elements.namedItem("cost") as HTMLInputElement).value = String(choice.cost);
                }}>
                  <option value="">自己填写，或选择一个建议</option>
                  {rewardTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <p className="small">星星数量只是可调整的建议。选择模板不会保存；修改好后再确认。愿望储蓄是奖励名称，不会自动建立储蓄账户。</p>
            </>}
            <Field label="奖励名称">
              <input
                name="name"
                defaultValue={i.name}
                required
                maxLength={60}
              />
            </Field>
            <Field label="奖励类型"><select aria-label="奖励类型" value={rewardKind} onChange={e=>setRewardKind(e.target.value as "activity"|"device_time")}><option value="activity">普通家庭奖励</option><option value="device_time">可计时的设备奖励</option></select></Field>
            {rewardKind === "device_time" && <>
              <Field label="奖励时间设备"><select name="device_id" aria-label="奖励时间设备" required defaultValue={i.device_id||""}><option value="">请选择设备</option>{(data.devices||[]).filter(d=>d.active||d.id===i.device_id).map(d=><option key={d.id} value={d.id}>{d.name}{!d.active?"（已停用）":""}</option>)}</select></Field>
              {!(data.devices||[]).some(d=>d.active)&&<p className="notice">请先在家长空间 → 家庭设置添加设备名称，再创建时间奖励。</p>}
              <Field label="每次兑换的分钟数"><input aria-label="奖励约定分钟" type="number" min="1" max="180" step="1" required value={suggestedMinutes} onChange={e=>setSuggestedMinutes(Number(e.target.value))}/></Field>
              <p className="small">所有时间奖励兑换后立即自动到账，不需要家长确认。分钟数以此字段为准，名称不会自动重写。孩子点击开始后按真实时间消耗，不能暂停；不控制实际设备。</p>
            </>}
            <Field label="需要星星">
              <input
                type="number"
                name="cost"
                min="1"
                max="10000"
                defaultValue={i.cost}
              />
            </Field>
            <p className="small">新奖励全家共用；兑换时按孩子独立扣星和到账。</p>
            {i.child_id&&<label className="checkbox"><input type="checkbox" name="make_family_reward"/>将此旧奖励改为全家共用（未勾选时保留原适用范围）</label>}
            <input type="hidden" name="child_id" value={i.child_id||""}/>

            <label className="checkbox"><input type="checkbox" name="active" defaultChecked={i.active !== false}/>启用这个奖励</label>
            <p className="small">选择“可计时的设备奖励”才会发放时间；绑定电视的奖励自动到账，其他设备奖励需审核。名称中的文字不用于计算额度，不会自动打开或关闭设备。</p>
            <p className="small">基本阅读、吃饭和陪伴不需要积分；可奖励的是选择故事、活动或特别点心的机会。</p>
          </>
        )}
        {kind === "family" && (
          <>
            <Field label="家庭名称">
              <input
                name="name"
                defaultValue={i.name}
                maxLength={40}
                required
              />
            </Field>
            <Field label="时区（IANA 名称）">
              <input
                name="timezone"
                value={familyTimezone}
                onChange={e=>setFamilyTimezone(e.target.value)}
                list="timezones"
                required
              />
              <datalist id="timezones">
                <option>Asia/Shanghai</option>
                <option>Asia/Singapore</option>
                <option>America/New_York</option>
                <option>Europe/London</option>
              </datalist>
            </Field>
            <TimezoneStarNotice data={data} timezone={familyTimezone}/>
          </>
        )}
        {kind === "rest" && (
          <>
            <Field label="孩子">
              <select name="child_id" defaultValue={i.child_id}>
                {data.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nickname}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="休息日期">
              <input type="date" name="day" defaultValue={i.day} required />
            </Field>
            <Field label="原因（可选）">
              <input
                name="reason"
                maxLength={300}
                placeholder="旅行、身体不舒服，或只是想休息"
              />
            </Field>
            <p className="small">
              休息日不计入目标；已有记录会保留，不会抹掉努力。
            </p>
          </>
        )}
        {kind === "backdate" && (
          <>
            <p>
              为 {selectedDay} 补录「{i.name}」。
            </p>
            <Field label="补录原因">
              <input
                name="reason"
                required
                maxLength={300}
                placeholder="例如：昨天完成了，忘记打卡"
              />
            </Field>
          </>
        )}
        {kind === "redeem" && (
          <>
            <div className="reward-confirm">
              <Gift size={35} />
              <div className="reward-title"><h3>{i.name}</h3><RuleSpeaker label={i.name} text={rewardExplanation(i,{tv:data.tv_settings?.device_id,switch:data.switch_settings?.enabled?data.switch_settings.device_id:null})}/></div>
              <p>{i.cost} 颗星星 · {isBoundSwitchReward ? "确认兑换后累加Switch余额" : i.kind === "device_time" && i.device_id === data.tv_settings?.device_id ? "确认后时间自动到账" : "提交后等待家长确认"}</p>
            </div>
            <p className="small">
              {isBoundSwitchReward ? "确认兑换后扣除星星并累加Switch余额，不会立即启动；开始使用时还会单独确认发送多少分钟到主机。" : i.kind === "device_time" && i.device_id === data.tv_settings?.device_id ? "确认后扣除星星，时间累加到你的电视可用余额。点击开始观看才使用时间，仍需遵守允许时段和冷却约定。每次重新确认都会再次扣星并充值。" : "星星会先预留。如果家长暂不安排，星星会自动退回。每次重新确认都会创建一笔新的兑换，并再次预留星星。"}
            </p>
          </>
        )}
        {kind === "timerReview" && (
          <>
            <Field label="实际守约情况">
              <select
                name="kept_agreement"
                defaultValue={i.status === "completed" ? "true" : "false"}
              >
                <option value="true">按约定主动结束</option>
                <option value="false">这次没有做到</option>
              </select>
            </Field>
            <Field label="修正原因">
              <input name="reason" required maxLength={300} />
            </Field>
            <p className="small">修正保留审计信息，不会扣除已有星星。</p>
          </>
        )}
        {kind.startsWith("delete") && (
          <p>「{i.name}」将不再展示，历史记录仍然保留。</p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || (kind === "habit" && !week.length)}
          >
            {busy
              ? "正在保存…"
              : kind === "redeem"
                ? isBoundSwitchReward ? "确认兑换" : "提交愿望"
                : kind.startsWith("delete")
                  ? "确认移除"
                  : "保存"}
          </button>
        </div>
      </form>
    </>
  );
  return inline ? <section id={"habit-"+(i.id || "new-"+i.child_id)} className="habit-inline-editor" aria-label={i.id ? "编辑已有习惯" : "添加新习惯"}>{content}</section>
    : <Dialog title={titles[kind] || "编辑"} close={close}>{content}</Dialog>;
}



