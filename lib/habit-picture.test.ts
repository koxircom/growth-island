import {describe,it,expect} from "vitest";
import {habitPicture} from "../app/habit-art";
describe("concrete task pictures",()=>{
 it.each([
 ["主动开始写作业","pencil","write"],["准时上学8点出门","star","school"],
 ["到时间主动结束游戏","gamepad","game-stop"],["完成一段专注学习","timer","focus"],
 ["按时睡觉9点躺下","moon","sleep"],["整理书包","backpack","bag"],
 ["整理玩具或书桌","sparkles","tidy"],["看望爷爷奶奶","star","family"],
 ["自主阅读","book","read"],["自觉主动洗澡","star","bath"],
 ["运动或户外活动","sun","sport"],
 ["和爸爸妈妈一起复盘","star","review"],
 ["不离开座位认真把饭吃完","star","meal"],
 ["早上自觉刷牙洗脸穿衣服","star","morning"]])("%s",(name,icon,want)=>expect(habitPicture(name,icon)).toBe(want));
 it("prioritizes task semantics over a misleading saved default",()=>expect(habitPicture("自觉主动洗澡","moon")).toBe("bath"));
});
