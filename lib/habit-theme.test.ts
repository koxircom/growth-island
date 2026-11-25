import {describe,it,expect} from "vitest";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {habitTheme} from "./habit-theme";
import {HABIT_AUDIO,habitVoiceText,HABIT_VOICE_UNAVAILABLE} from "./habit-voice-static";
describe("habit theme and prerecorded voice",()=>{
it("maps user examples and generic templates",()=>{expect(habitTheme("睡觉","star")).toBe("moon");expect(habitTheme("看望爷爷","star")).toBe("family");expect(habitTheme("自己穿好衣服","star")).toBe("shirt");expect(habitTheme("坐在餐桌前吃饭","star")).toBe("meal");});
it("preserves chosen icon and neutral unknown",()=>{expect(habitTheme("睡觉","heart")).toBe("heart");expect(habitTheme("新任务","star")).toBe("star");});
it("uses exact known phrases not invented audio",()=>{expect(HABIT_AUDIO["睡觉"]).toMatch(/child-v7\/habit-00\.wav$/);expect(HABIT_AUDIO["看望爷爷"]).toMatch(/child-v7\/habit-01\.wav$/);expect(HABIT_AUDIO["睡觉之后"]).toBeUndefined();});
it("every mapped phrase points at a shipped audio file",()=>{
 const missing=Object.entries(HABIT_AUDIO).filter(([,src])=>!existsSync(join(process.cwd(),"public",src))).map(([phrase])=>phrase);
 expect(missing).toEqual([]);
});
});

it("unknown and prototype keys never claim background generation",()=>{
 for(const text of ["constructor","toString","__proto__","新习惯","睡觉之后",""])
  expect(habitVoiceText(text)).toBe(HABIT_VOICE_UNAVAILABLE);
 expect(habitVoiceText(" 睡觉 ")).toBe("睡觉");
 expect(HABIT_VOICE_UNAVAILABLE).not.toMatch(/合成中/);
});
