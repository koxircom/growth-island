import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHILD_AUDIO } from "./child-audio-manifest";

const EXPECTED_V10: Record<string, string> = {
  "刚才哪一步，是你自己想办法完成的？": "/audio/child-v10/garden_talk_1.wav",
  "如果有点难，下一次可以先做哪一小步？": "/audio/child-v10/garden_talk_2.wav",
  "今天你想感谢自己什么？小小的尝试也算。": "/audio/child-v10/garden_talk_3.wav",
};

describe("child-v10 growth garden prompts", () => {
  it("pins all 3 garden reflection prompts to valid mono 24kHz PCM WAV files under 3 MiB", () => {
    const entries = Object.entries(EXPECTED_V10);
    expect(entries).toHaveLength(3);
    for (const [text, url] of entries) {
      expect(CHILD_AUDIO[text]).toBe(url);
      expect(url).toMatch(/^\/audio\/child-v10\/[a-z0-9_]+\.wav$/);
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
