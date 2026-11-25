import {describe,it,expect} from "vitest";
import {checkinHabitName,type Dashboard} from "./model";
import {csvCell} from "./csv";
describe("history uses effective names",()=>{
 const data={habits:[{id:"h",name:"新名字"}],habit_versions:[{habit_id:"h",effective_day:"2026-11-12",name:"新名字",archived:true},{habit_id:"h",effective_day:"2026-11-01",name:"旧名字"}]} as Dashboard;
 it("matches old day even after rename/archive",()=>expect(checkinHabitName(data,{habit_id:"h",day:"2026-11-10"})).toBe("旧名字"));
 it("resolves archived version without discarding record",()=>expect(checkinHabitName(data,{habit_id:"h",day:"2026-11-12"})).toBe("新名字"));
 it("falls back for legacy data",()=>expect(checkinHabitName({...data,habit_versions:[]},{habit_id:"h",day:"2026-10-01"})).toBe("新名字"));
 it("keeps a readable missing-habit fallback",()=>expect(checkinHabitName(data,{habit_id:"gone",day:"2026-11-10"})).toBe("习惯打卡"));
});
describe("CSV safe fields",()=>{
 for(const text of ["=SUM(1,2)"," +1","\t=1","\r-1","\n@foo"])it("neutralizes "+JSON.stringify(text),()=>expect(csvCell(text)).toBe('"\''+text+'"'));
 it("escapes quotes and preserves ordinary text",()=>expect(csvCell('a,"b"')).toBe('"a,""b"""'));
});
