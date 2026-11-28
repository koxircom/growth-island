import {HABIT_AUDIO} from "./habit-voice-static";
// Exact fixed phrases only. These aliases preserve the recorded meaning.
// waiting is parent approval, not TV acknowledgement or habit approval.
// parent is TV manual blocking only, never generic parent authentication.
// Successful start/finish/saved are called only after a confirmed server result.
export const CHILD_AUDIO:Record<string,string> = {
  "还没有可用时间，先去奖励小屋兑换哦。": "/audio/child-v1/no-time.wav",
  "还没有可用的电视时间，先去奖励小屋兑换哦。": "/audio/child-v1/no-time.wav",
  "你好呀！别着急，我们一步一步来。": "/audio/child-v1/hello.wav",
  "你好呀！我们一步一步来。": "/audio/child-v1/hello.wav",
  "记下啦，你又向前迈了一小步。": "/audio/child-v1/saved.wav",
  "你完成了自己的一小步，给自己一个小小的赞！": "/audio/child-v1/saved.wav",
  "现在是约定的休息时间，休息结束就能再开始啦。": "/audio/child-v1/rest.wav",
  "现在是约定的休息时间，休息结束就能再看啦。": "/audio/child-v1/rest.wav",
  "现在还没到约定的观看时间，到了时间再来吧。": "/audio/child-v1/window.wav",
  "已经提交啦，等家长确认后就能使用。": "/audio/child-v1/waiting.wav",
  "愿望已经提交啦，等家长确认后就能使用。": "/audio/child-v1/waiting.wav",
  "这次操作还没确认成功，别着急，看看提示再试一次。": "/audio/child-v1/failure.wav",
  "星星还不够，慢慢积累，不着急哦。": "/audio/child-v1/stars.wav",
  "星星还不够，慢慢积累就好。": "/audio/child-v1/stars.wav",
  "计时开始啦，记得按约定结束哦。": "/audio/child-v1/start.wav",
  "已经暂停，休息一下也没关系。": "/audio/child-v1/pause.wav",
  "我们继续这一小段吧。": "/audio/child-v1/resume.wav",
  "这段时间已经记下啦，伸个懒腰吧。": "/audio/child-v1/finish.wav",
  "还没确认电视状态，等一小会儿再试。时间不会因此扣掉哦。": "/audio/child-v1/stale.wav",
  "家长暂时暂停了电视，可以一起商量什么时候看哦。": "/audio/child-v1/parent.wav",
  "先看看需要多少星星，确认后再提交愿望哦。": "/audio/child-v1/confirm.wav",
  "网络暂时断开了，别着急，联网后再试一次。": "/audio/child-v1/retry.wav",
  "网络暂时断开了，联网后再打卡，你的努力没有白费。": "/audio/child-v1/retry.wav"
};

export const RULE_STREAK_TEXT="选定习惯的当日目标全部完成，并在当天结束前审核通过，才计一次。连续三次奖励一颗星，七次及之后每七次奖励两颗星；每个孩子每周最多三颗星。休息日和非执行日跳过，漏做则从头开始；暂停或归档会清零。";
export const RULE_SAVINGS_TEXT="周一到周日，按每天晚上的余额求一周平均。达到二十、四十、六十、八十、一百颗星，下周一分别奖励一、二、三、四、六颗存星利息，每周最多六颗，不按百分比复利。";
CHILD_AUDIO[RULE_STREAK_TEXT]="/audio/child-v4/streak_complete.wav";
CHILD_AUDIO[RULE_SAVINGS_TEXT]="/audio/child-v11/savings_complete.wav";

CHILD_AUDIO['尽情享受看电视的时间。']='/audio/child-v3/tv_enjoy.wav';

CHILD_AUDIO['需要先用星星兑换。']='/audio/child-v3/redeem_first.wav';

export const RULE_TIMING_REVIEW_TEXT="连续规则，包括关闭，从次日生效，存星规则从下周一生效。次日或次周自动结算，不补算启用前的记录；补卡或次日审核不追补已结束日的连续奖励。已发奖励不会因后来修改打卡自动扣回。";
export const RULE_BASICS_TEXT="吃饭、阅读、休息和家人的陪伴，不需要用星星交换。遇到困难可以和家长商量。";
CHILD_AUDIO[RULE_TIMING_REVIEW_TEXT]="/audio/child-v4/policy_complete.wav";
CHILD_AUDIO[RULE_BASICS_TEXT]="/audio/child-v4/rule_basics_complete.wav";

CHILD_AUDIO['这次记录已经撤销，可以重新来。']='/audio/child-v3/undo.wav';
CHILD_AUDIO['准备好啦，先专心做这一小段吧。']='/audio/child-v3/focus.wav';

CHILD_AUDIO['兑换成功，电视时间已经存好啦，准备好再开始使用。']='/audio/child-v3/tv_credit.wav';
CHILD_AUDIO['Switch余额已累加，不会立即启动。']='/audio/child-v3/switch_credit.wav';

CHILD_AUDIO['已经交给家长确认啦，星星暂时不变。']='/audio/child-v3/history_submit.wav';
CHILD_AUDIO['这次申请已经撤回啦。']='/audio/child-v3/history_withdraw.wav';
CHILD_AUDIO['已经记下你的尝试，等家长确认。']='/audio/child-v3/checkin_pending.wav';

export const TV_HELP_TEXT="兑换后，电视时间先存起来，准备好再开始观看。";
export const SWITCH_HELP_TEXT="兑换后，游戏时间先存起来。点亮主机并确认后，再开始使用。";
CHILD_AUDIO[TV_HELP_TEXT]="/audio/child-v4/tv_help.wav";
CHILD_AUDIO[SWITCH_HELP_TEXT]="/audio/child-v4/switch_help.wav";

Object.assign(CHILD_AUDIO,HABIT_AUDIO);

CHILD_AUDIO["这条习惯的语音暂未准备好。"]="/audio/child-v5/unavailable.wav";

// child-v8: synthesized child-UI feedback and active reward explanations
CHILD_AUDIO["现在已经显示全部日期啦。"] = "/audio/child-v8/history_all_dates.wav";
CHILD_AUDIO["已经是第一页啦。"] = "/audio/child-v8/history_first_page.wav";
CHILD_AUDIO["这段记录已经看完啦，新的小进步会慢慢留下来。"] = "/audio/child-v8/history_end.wav";
CHILD_AUDIO["可用时间还不够，先去奖励小屋看看吧。"] = "/audio/child-v8/no_time_soft.wav";
CHILD_AUDIO["现在是休息时间，休息好了再来吧。"] = "/audio/child-v8/rest_soft.wav";
CHILD_AUDIO["这一步需要家长帮忙，我们请家长来看看。"] = "/audio/child-v8/need_parent.wav";
CHILD_AUDIO["已经是今天啦，明天的记录明天再来看看。"] = "/audio/child-v8/already_today.wav";
CHILD_AUDIO["还有一段计时在进行，结束后再切换吧。"] = "/audio/child-v8/timer_busy.wav";
CHILD_AUDIO["今天约定的游戏时间用完啦，换一件喜欢的事情吧。"] = "/audio/child-v8/game_limit_done.wav";
CHILD_AUDIO["选一个一到一百二十之间的整数分钟，我们从一小段开始吧。"] = "/audio/child-v8/minutes_invalid.wav";
CHILD_AUDIO["已经结束啦，没用完的时间已退回。"] = "/audio/child-v8/wallet_ended_refund.wav";
CHILD_AUDIO["要追加这段时间吗？确认后才会使用余额哦。"] = "/audio/child-v8/wallet_extend_confirm.wav";
CHILD_AUDIO["已经追加好了，结束后记得休息哦。"] = "/audio/child-v8/wallet_extended.wav";
CHILD_AUDIO["一起下军旗，需要3颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。"] = "/audio/child-v8/reward_junqi.wav";
CHILD_AUDIO["听故事10分钟，需要3颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。"] = "/audio/child-v8/reward_story.wav";
CHILD_AUDIO["看电视的约定（20分钟），需要6颗星星。兑换20分钟，先存进电视余额，准备好再开始观看。"] = "/audio/child-v8/reward_tv20.wav";
CHILD_AUDIO["玩switch（60分钟），需要15颗星星。兑换60分钟，先存进Switch余额。开始使用时再发送，等主机联网确认后才开始。"] = "/audio/child-v8/reward_switch60.wav";
CHILD_AUDIO["零花钱奖励2元，需要25颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。"] = "/audio/child-v8/reward_money2.wav";
CHILD_AUDIO["零花钱限额提升1元（一天最高5元），需要50颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。"] = "/audio/child-v8/reward_money_limit.wav";

// child-v9: child penalties page intro, 6 penalty rules, and penalty feedback
CHILD_AUDIO["一起遵守约定。如果没做到约定事项，点一下对应的扣星按钮记录哦。"] = "/audio/child-v9/penalty_intro.wav";
CHILD_AUDIO["小便后没有抬起马桶坐垫，扣1颗星星。"] = "/audio/child-v9/penalty_toilet_seat.wav";
CHILD_AUDIO["大小便没有冲，扣1颗星星。"] = "/audio/child-v9/penalty_flush.wav";
CHILD_AUDIO["吃饭跑来跑去，扣1颗星星。"] = "/audio/child-v9/penalty_eating_run.wav";
CHILD_AUDIO["无理取闹，扣2颗星星。闹情绪的时候，不好讲理，事后讲道理，讲明白。"] = "/audio/child-v9/penalty_tantrum.wav";
CHILD_AUDIO["故意欺负妹妹，扣1颗星星。"] = "/audio/child-v9/penalty_bully_sister.wav";
CHILD_AUDIO["听音乐停不下来，扣1颗星星。"] = "/audio/child-v9/penalty_music_stop.wav";
CHILD_AUDIO["刚刚已记录，请勿重复点击。"] = "/audio/child-v9/penalty_recent.wav";
CHILD_AUDIO["今天已到约定上限。"] = "/audio/child-v9/penalty_daily_limit.wav";
CHILD_AUDIO["星星不足，不会透支。"] = "/audio/child-v9/penalty_no_stars.wav";
CHILD_AUDIO["已经记录好啦，下次我们一起记住约定哦。"] = "/audio/child-v9/penalty_recorded.wav";

// child-v10: growth garden reflection prompts
CHILD_AUDIO["刚才哪一步，是你自己想办法完成的？"] = "/audio/child-v10/garden_talk_1.wav";
CHILD_AUDIO["如果有点难，下一次可以先做哪一小步？"] = "/audio/child-v10/garden_talk_2.wav";
CHILD_AUDIO["今天你想感谢自己什么？小小的尝试也算。"] = "/audio/child-v10/garden_talk_3.wav";


// child-v11: savings vault, arrival celebration, and redemption tier-drop reminder
CHILD_AUDIO["把星星存起来，下周一就能多领存星利息哦！存得越多，长出的小星星越多。"] = "/audio/child-v11/savings_vault_intro.wav";
CHILD_AUDIO["存星利息到账啦！你好好存住了星星，又长出新的小星星咯！"] = "/audio/child-v11/savings_arrived.wav";
CHILD_AUDIO["现在换完星星会变少，下周的存星利息也会少一点哦，要现在换还是等周一领完利息再换呀？"] = "/audio/child-v11/savings_drop_warning.wav";
