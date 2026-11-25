import {it,expect} from "vitest";
import {habitTemplates} from "./habit-templates";
it("offers eight unique opt-in everyday steps without rewards or credentials",()=>{
 expect(habitTemplates).toHaveLength(8);
 expect(new Set(habitTemplates.map(x=>x.id)).size).toBe(8);
 expect(habitTemplates.every(x=>x.name.length>0&&x.name.length<=60)).toBe(true);
 expect(habitTemplates.every(x=>Object.keys(x).sort().join(",")==="icon,id,name")).toBe(true);
});
