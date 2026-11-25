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
export const RULE_SAVINGS_TEXT="周一至周日，整周最低余额达到二十、五十、一百颗星，分别奖励一颗、三颗、六颗星，每周最多六颗星。新档位从更新后的下一个完整周开始，之前仍按旧档位。中途花掉再补回仍按最低余额计算，不按百分比复利。";
CHILD_AUDIO[RULE_STREAK_TEXT]="/audio/child-v4/streak_complete.wav";
CHILD_AUDIO[RULE_SAVINGS_TEXT]="/audio/child-v4/savings_complete.wav";

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
