import {it,expect} from "vitest";
import {rewardTemplates,rewardTemplateName} from "./reward-templates";
it("offers nine opt-in editable suggestions without device control",()=>{
 expect(rewardTemplates).toHaveLength(9);expect(new Set(rewardTemplates.map(t=>t.id)).size).toBe(9);
 for(const t of rewardTemplates){expect(t.cost).toBeGreaterThan(0);expect(t.cost).toBeLessThanOrEqual(10000);expect(rewardTemplateName(t.name,"minutes" in t?t.minutes:undefined).length).toBeLessThanOrEqual(60);}
});
it("formats minutes as text and rejects invalid durations",()=>{
 expect(rewardTemplateName("家庭电影夜",30)).toBe("家庭电影夜（30分钟）");
 expect(rewardTemplateName("选择故事")).toBe("选择故事");
 for(const x of [0,-1,181,1.5,NaN])expect(()=>rewardTemplateName("电视",x)).toThrow();
});
