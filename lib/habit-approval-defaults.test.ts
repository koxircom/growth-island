import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
it("new rules default to parent approval and enabled",()=>{
 for(const f of ["app/habit-rule-dialog.tsx","app/parent-habit-rules.tsx"]){const s=readFileSync(f,"utf8");expect(s).toContain("requires_approval:true,active:true");}
});
it("only new rules select all children; edits retain explicit existing choices",()=>{
 const s=readFileSync("app/habit-rule-dialog.tsx","utf8");
 expect(s).toContain("creating?data.children.map(c=>c.id):targets.map(t=>t.child_id)");
 expect(s).toContain("creating?initial:{}");
 expect(s).toContain("setChildren(v=>v.includes(c.id)?v.filter(id=>id!==c.id):[...v,c.id])");
 expect(s).toContain("value=\"false\"");
});
it("legacy form defaults new approval but retains existing false",()=>{
 expect(readFileSync("app/page.tsx","utf8")).toContain("defaultChecked={i.id ? i.requires_approval : true}");
});
