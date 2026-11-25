import {describe,expect,it} from "vitest";
import {confirmedSwitchRemaining,switchActiveSessionForBinding,switchCanQueue,switchHostHasUnmatchedSession,switchHostSleeping,switchRemainingAfterTopUp,switchSessionView,switchSnapshotFresh,switchSnapshotReady,switchTopUpChoices} from "./switch-wallet";
import type {SwitchSession,SwitchStatus} from "./model";

const status:SwitchStatus={
 checked_at:"2026-11-13T00:00:00.000Z",
 snapshot:{session_id:"s1",session_state:"playing",granted_seconds:1800,consumed_seconds:1080,remaining_seconds:720,clock_trusted:true,native_verified:true,sequence:4},
};
const session:SwitchSession={id:"s1",child_id:"c1",device_id:"switch",state:"active",granted_seconds:1800,consumed_seconds:1080,pending:false,remote:status.snapshot};
const queueState={online:true,ready:false,pending:false,hasLive:false,mine:false,other:false,hostWithoutSession:false,deviceActive:true,scheduleUnsupported:false,selected:300};

describe("device-authoritative Switch wallet",()=>{
 it("does not treat another console's queued session as the unselected console",()=>{
  const queued={...session,state:"pending" as const,binding_id:"switch-1"};
  expect(switchActiveSessionForBinding([queued],"switch",null)).toBeNull();
  expect(switchActiveSessionForBinding([queued],"switch","switch-2")).toBeNull();
  expect(switchActiveSessionForBinding([queued],"switch","switch-1")).toEqual(queued);
  expect(switchActiveSessionForBinding([{...session}],"switch","switch-2")).toEqual(session);
 });
 it("allows an online browser to queue while the host state is unavailable",()=>{
  expect(switchCanQueue(queueState)).toBe(true);
  expect(switchCanQueue({...queueState,online:false})).toBe(false);
  expect(switchCanQueue({...queueState,ready:true})).toBe(false);
  expect(switchCanQueue({...queueState,selected:0})).toBe(false);
 });
 it("allows only the current child to queue an extension and preserves guards",()=>{
  expect(switchCanQueue({...queueState,hasLive:true,mine:true})).toBe(true);
  expect(switchCanQueue({...queueState,hasLive:true,other:true})).toBe(false);
  expect(switchCanQueue({...queueState,deviceActive:false})).toBe(false);
  expect(switchCanQueue({...queueState,scheduleUnsupported:true})).toBe(false);
  expect(switchCanQueue({...queueState,hostWithoutSession:true})).toBe(false);
  expect(switchCanQueue({...queueState,pending:true})).toBe(false);
 });
 it("adds a confirmed top-up to the current remainder",()=>{
  expect(switchRemainingAfterTopUp(1800,1080,1800)).toBe(2520);
 });
 it("keeps the last known remainder while a top-up is pending",()=>{
  const view=switchSessionView({...session,pending:true},status,Date.parse("2026-11-13T00:00:05.000Z"));
  expect(view.remaining_seconds).toBe(720);
  expect(view.pending).toBe(true);
  expect(view.fresh).toBe(false);
 });
 it("does not freshen an old session with a different session heartbeat",()=>{
  const previous={...session,remote:{...status.snapshot,session_id:"s1",boot_id:"boot-a",sample_sequence:3,remaining_seconds:720}};
  const current={...status,snapshot:{...status.snapshot,session_id:"s2",boot_id:"boot-b",sample_sequence:8,remaining_seconds:300}};
  const view=switchSessionView(previous,current,Date.parse("2026-11-13T00:00:05.000Z"));
  expect(view.remaining_seconds).toBe(720);
  expect(view.fresh).toBe(false);
 });
 it("uses a current correlated snapshot for a settled session",()=>{
  const current={...status,snapshot:{...status.snapshot,boot_id:"boot-b",sample_sequence:8,remaining_seconds:600}};
  const view=switchSessionView(session,current,Date.parse("2026-11-13T00:00:05.000Z"));
  expect(view.remaining_seconds).toBe(600);
  expect(view.fresh).toBe(true);
 });
 it("allows a pending top-up to retain freshness only for the same device sample",()=>{
  const pending={...session,pending:true,remote:{...status.snapshot,boot_id:"boot-a",sample_sequence:3,remaining_seconds:720}};
  const current={...status,snapshot:{...status.snapshot,boot_id:"boot-a",sample_sequence:3,remaining_seconds:720}};
  const view=switchSessionView(pending,current,Date.parse("2026-11-13T00:00:05.000Z"));
  expect(view.remaining_seconds).toBe(720);
  expect(view.fresh).toBe(true);
 });
 it("does not mark a pending session ready when its latest signed state is sleeping",()=>{
  const pending={...session,pending:true,remote:{...status.snapshot,boot_id:"boot-a",sample_sequence:3,remaining_seconds:720}};
  const current={...status,snapshot:{...status.snapshot,boot_id:"boot-a",sample_sequence:3,session_state:"sleeping" as const,remaining_seconds:720}};
  const view=switchSessionView(pending,current,Date.parse("2026-11-13T00:00:05.000Z"));
  expect(view.fresh).toBe(true);
  expect(view.ready).toBe(false);
 });
 it("marks a snapshot stale at the fifteen-second boundary",()=>{
  expect(switchSnapshotFresh(status,Date.parse("2026-11-13T00:00:14.999Z"))).toBe(true);
  expect(switchSnapshotFresh(status,Date.parse("2026-11-13T00:00:15.000Z"))).toBe(false);
 });
 it("does not confirm unknown device state",()=>{
  const unknown={...status,snapshot:{...status.snapshot,session_state:"unknown" as const,remaining_seconds:720}};
  expect(confirmedSwitchRemaining(unknown.snapshot)).toBe(null);
  expect(switchSnapshotReady(unknown,Date.parse("2026-11-13T00:00:05.000Z"))).toBe(false);
  expect(switchSessionView({...session,remote:unknown.snapshot},unknown,Date.parse("2026-11-13T00:00:05.000Z")).ready).toBe(false);
 });
 it("queues signed paused and sleeping states instead of treating either as ready",()=>{
  for(const sessionState of ["paused","sleeping"] as const){
   const sleeping={...status,snapshot:{...status.snapshot,session_state:sessionState}};
   expect(switchHostSleeping(sleeping.snapshot)).toBe(true);
   expect(switchSnapshotReady(sleeping,Date.parse("2026-11-13T00:00:05.000Z"))).toBe(false);
   expect(switchSessionView(undefined,sleeping,Date.parse("2026-11-13T00:00:05.000Z")).ready).toBe(false);
  }
 });
 it("blocks an unmatched paused session but keeps zero-quota sleeping idle",()=>{
  const unmatched={...status,snapshot:{...status.snapshot,session_state:"paused" as const,session_id:"existing-session"}};
  expect(switchHostHasUnmatchedSession(unmatched.snapshot)).toBe(true);
  expect(switchCanQueue({...queueState,hostWithoutSession:true})).toBe(false);
  const sleeping={...status,snapshot:{...status.snapshot,session_state:"sleeping" as const,session_id:"",granted_seconds:0,consumed_seconds:0,remaining_seconds:0}};
  expect(switchHostHasUnmatchedSession(sleeping.snapshot)).toBe(false);
  expect(switchCanQueue({...queueState,hostWithoutSession:false})).toBe(true);
 });
 it("requires trusted native readiness and leaves room for leftover seconds",()=>{
  expect(switchSnapshotReady(status,Date.parse("2026-11-13T00:00:05.000Z"))).toBe(true);
  expect(switchSnapshotReady({...status,snapshot:{...status.snapshot,clock_trusted:false}},Date.parse("2026-11-13T00:00:05.000Z"))).toBe(false);
  expect(switchTopUpChoices(350,60)).toEqual([60,300,350]);
  expect(switchTopUpChoices(99999,10800)).toEqual([]);
 });
});
