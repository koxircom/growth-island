import { describe, it, expect } from "vitest";
import {checkinFeedback,gardenStage} from "./growth-feedback";
import type {Checkin} from "./model";
const record:Checkin={id:"1",habit_id:"habit-a",child_id:"a",day:"2026-11-12",status:"approved",stars:2};
describe("gentle growth feedback",()=>{
 it("celebrates only newly persisted matching checkins",()=>{expect(checkinFeedback([], [record], record.habit_id, record.day)?.childId).toBe("a");expect(checkinFeedback([record],[record],record.habit_id,record.day)).toBeNull();});
 it("does not invent feedback for failures, undo, other children/dates",()=>{expect(checkinFeedback([record],[],record.habit_id,record.day)).toBeNull();expect(checkinFeedback([],[record],"other",record.day)).toBeNull();expect(checkinFeedback([],[record],record.habit_id,"2026-11-13")).toBeNull();expect(checkinFeedback([],[{...record,status:"rejected"}],record.habit_id,record.day)).toBeNull();});
 it("pending feedback never implies stars or approval",()=>{const f=checkinFeedback([],[{...record,status:"pending"}],record.habit_id,record.day);expect(f?.pending).toBe(true);expect(f?.message).toContain("等家长确认");});
 it("daily garden is bounded and handles invalid counts",()=>{expect([0,1,2,3,100,-1,NaN].map(gardenStage)).toEqual([0,1,2,3,3,0,0]);});
});
