import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHILD_AUDIO } from "./child-audio-manifest";

const EXPECTED_V8: Record<string, string> = {
  "现在已经显示全部日期啦。": "/audio/child-v8/history_all_dates.wav",
  "已经是第一页啦。": "/audio/child-v8/history_first_page.wav",
  "这段记录已经看完啦，新的小进步会慢慢留下来。": "/audio/child-v8/history_end.wav",
  "可用时间还不够，先去奖励小屋看看吧。": "/audio/child-v8/no_time_soft.wav",
  "现在是休息时间，休息好了再来吧。": "/audio/child-v8/rest_soft.wav",
  "这一步需要家长帮忙，我们请家长来看看。": "/audio/child-v8/need_parent.wav",
  "已经是今天啦，明天的记录明天再来看看。": "/audio/child-v8/already_today.wav",
  "还有一段计时在进行，结束后再切换吧。": "/audio/child-v8/timer_busy.wav",
  "今天约定的游戏时间用完啦，换一件喜欢的事情吧。": "/audio/child-v8/game_limit_done.wav",
  "选一个一到一百二十之间的整数分钟，我们从一小段开始吧。": "/audio/child-v8/minutes_invalid.wav",
  "已经结束啦，没用完的时间已退回。": "/audio/child-v8/wallet_ended_refund.wav",
  "要追加这段时间吗？确认后才会使用余额哦。": "/audio/child-v8/wallet_extend_confirm.wav",
  "已经追加好了，结束后记得休息哦。": "/audio/child-v8/wallet_extended.wav",
  "一起下军旗，需要3颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。": "/audio/child-v8/reward_junqi.wav",
  "听故事10分钟，需要3颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。": "/audio/child-v8/reward_story.wav",
  "看电视的约定（20分钟），需要6颗星星。兑换20分钟，先存进电视余额，准备好再开始观看。": "/audio/child-v8/reward_tv20.wav",
  "玩switch（60分钟），需要15颗星星。兑换60分钟，先存进Switch余额。开始使用时再发送，等主机联网确认后才开始。": "/audio/child-v8/reward_switch60.wav",
  "零花钱奖励2元，需要25颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。": "/audio/child-v8/reward_money2.wav",
  "零花钱限额提升1元（一天最高5元），需要50颗星星。提交后星星先预留，等家长确认；如果没有安排，星星会退回。": "/audio/child-v8/reward_money_limit.wav"
};

describe("child-v8 static child feedback and reward audio", () => {
  it("pins all 19 child-v8 prompts to valid mono 24kHz PCM WAV files under 3 MiB", () => {
    const entries = Object.entries(EXPECTED_V8);
    expect(entries).toHaveLength(19);
    for (const [text, url] of entries) {
      expect(CHILD_AUDIO[text]).toBe(url);
      expect(url).toMatch(/^\/audio\/child-v8\/[a-z0-9_]+\.wav$/);
      const buf = readFileSync("public" + url);
      expect(buf.byteLength).toBeGreaterThan(44);
      expect(buf.byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
      expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect(buf.readUInt16LE(22)).toBe(1);
      expect(buf.readUInt32LE(24)).toBe(24000);
      expect(buf.readUInt16LE(34)).toBe(16);
    }
  });
});
