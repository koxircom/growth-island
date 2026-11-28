import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHILD_AUDIO } from "./child-audio-manifest";
import {
  PENALTY_INTRO_TEXT,
  PENALTY_RECORDED_VOICE,
  penaltyExplanation,
} from "./penalty-explanation";

const EXPECTED_V9: Record<string, string> = {
  [PENALTY_INTRO_TEXT]: "/audio/child-v9/penalty_intro.wav",
  "小便后没有抬起马桶坐垫，扣1颗星星。": "/audio/child-v9/penalty_toilet_seat.wav",
  "大小便没有冲，扣1颗星星。": "/audio/child-v9/penalty_flush.wav",
  "吃饭跑来跑去，扣1颗星星。": "/audio/child-v9/penalty_eating_run.wav",
  "无理取闹，扣2颗星星。闹情绪的时候，不好讲理，事后讲道理，讲明白。": "/audio/child-v9/penalty_tantrum.wav",
  "故意欺负妹妹，扣1颗星星。": "/audio/child-v9/penalty_bully_sister.wav",
  "听音乐停不下来，扣1颗星星。": "/audio/child-v9/penalty_music_stop.wav",
  "刚刚已记录，请勿重复点击。": "/audio/child-v9/penalty_recent.wav",
  "今天已到约定上限。": "/audio/child-v9/penalty_daily_limit.wav",
  "星星不足，不会透支。": "/audio/child-v9/penalty_no_stars.wav",
  [PENALTY_RECORDED_VOICE]: "/audio/child-v9/penalty_recorded.wav",
};

describe("child-v9 penalties page and rule audio", () => {
  it("pins all 11 child-v9 prompts to valid mono 24kHz PCM WAV files under 3 MiB", () => {
    const entries = Object.entries(EXPECTED_V9);
    expect(entries).toHaveLength(11);
    for (const [text, url] of entries) {
      expect(CHILD_AUDIO[text]).toBe(url);
      expect(url).toMatch(/^\/audio\/child-v9\/[a-z0-9_]+\.wav$/);
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

  it("formats penalty rule explanations to match prerecorded manifest keys verbatim", () => {
    expect(
      penaltyExplanation({ name: "小便后没有抬起马桶坐垫", description: "", stars: 1 }),
    ).toBe("小便后没有抬起马桶坐垫，扣1颗星星。");
    expect(
      penaltyExplanation({
        name: "无理取闹",
        description: "闹情绪的时候，不好讲理，事后讲道理，讲明白。",
        stars: 2,
      }),
    ).toBe("无理取闹，扣2颗星星。闹情绪的时候，不好讲理，事后讲道理，讲明白。");
  });
});
