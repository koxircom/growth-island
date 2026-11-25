import type {SwitchSession,SwitchSnapshot,SwitchStatus} from "./model";
import {usageChoices} from "./time-wallet";

export const SWITCH_MAX_SECONDS = 10800;
export const SWITCH_STATUS_MAX_AGE_MS = 15000;

/** Find the active session associated with a particular console. */
export function switchActiveSessionForBinding(sessions: SwitchSession[], deviceId: string, bindingId: string | null) {
  const active = sessions.filter(session => session.device_id === deviceId && session.state !== "ended");
  if (!bindingId) return null;
  const sessionBinding = (session: SwitchSession) => {
    const id = (session as SwitchSession & {binding_id?: string | null}).binding_id;
    return typeof id === "string" && id.trim() ? id : null;
  };
  const bound = active.find(session => sessionBinding(session) === bindingId);
  if (bound) return bound;
  // Legacy sessions without a binding still block a selected console safely.
  const legacy = active.filter(session => !sessionBinding(session));
  return legacy.length === 1 ? legacy[0] : null;
}

export type SwitchQueueState = {
  online: boolean;
  ready: boolean;
  pending: boolean;
  hasLive: boolean;
  mine: boolean;
  other: boolean;
  hostWithoutSession: boolean;
  deviceActive: boolean;
  scheduleUnsupported: boolean;
  selected: number;
};

/**
 * The browser may enqueue an allocation while the bound host is asleep or
 * offline, but the page itself must still be online and no known session may
 * be overwritten. The worker/host remains authoritative for delivery.
 */
export function switchCanQueue(state: SwitchQueueState) {
  return state.online && !state.ready && !state.pending && state.deviceActive &&
    !state.scheduleUnsupported && !state.other && !state.hostWithoutSession &&
    Number.isFinite(state.selected) && state.selected > 0 &&
    (state.mine || !state.hasLive);
}

function wholeSeconds(value: number | string | null | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : null;
}

/** Only a non-unknown device snapshot can prove a remaining Switch allowance. */
export function confirmedSwitchRemaining(snapshot: SwitchSnapshot | null | undefined): number | null {
  if (!snapshot || snapshot.session_state === "unknown") return null;
  const remaining = wholeSeconds(snapshot.remaining_seconds);
  return remaining === null ? null : Math.min(SWITCH_MAX_SECONDS, remaining);
}

/** A signed sleeping snapshot is state evidence, never permission to send immediately. */
export function switchHostSleeping(snapshot: SwitchSnapshot | null | undefined) {
  return snapshot?.session_state === "paused" || snapshot?.session_state === "sleeping";
}

/** A fresh paused host with an id is an existing session, not an idle queue target. */
export function switchHostHasUnmatchedSession(snapshot: SwitchSnapshot | null | undefined) {
  if (!snapshot || snapshot.session_state === "playing") return !!snapshot;
  return snapshot.session_state === "paused" &&
    typeof snapshot.session_id === "string" && snapshot.session_id.trim().length > 0;
}

/** A snapshot expires at 15 seconds; a future timestamp is not trusted as fresh. */
export function switchSnapshotFresh(status: SwitchStatus | null | undefined, now: number | null, maxAgeMs = SWITCH_STATUS_MAX_AGE_MS) {
  if (!status?.snapshot || !status.checked_at || now === null || !Number.isFinite(now)) return false;
  const checkedAt = Date.parse(status.checked_at);
  return Number.isFinite(checkedAt) && now >= checkedAt && now - checkedAt < maxAgeMs;
}

export function switchSnapshotReady(status: SwitchStatus | null | undefined, now: number | null, online = true) {
  const snapshot = status?.snapshot;
  return online && switchSnapshotFresh(status, now) && !!snapshot &&
    snapshot.session_state !== "unknown" && !switchHostSleeping(snapshot) &&
    snapshot.clock_trusted === true && snapshot.native_verified === true;
}

function sameGrantedSeconds(a: number | string | null | undefined, b: number | string | null | undefined) {
  const left = Number(a), right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.floor(left) === Math.floor(right);
}

function sampleId(snapshot: SwitchSnapshot | null | undefined) {
  return snapshot?.sample_sequence ?? snapshot?.sequence ?? null;
}

function sameBootAndSample(a: SwitchSnapshot | null | undefined, b: SwitchSnapshot | null | undefined) {
  const aSample = sampleId(a), bSample = sampleId(b);
  return !!a?.boot_id && !!b?.boot_id && a.boot_id === b.boot_id &&
    aSample !== null && bSample !== null && String(aSample) === String(bSample);
}

function matchingStatusSnapshot(session: SwitchSession | null | undefined, status: SwitchStatus | null | undefined) {
  const current = status?.snapshot;
  return session && current && current.session_id === session.id &&
    sameGrantedSeconds(current.granted_seconds, session.granted_seconds) ? current : null;
}

/** Use only a correlated session snapshot; never borrow another session's heartbeat. */
export function switchSessionSnapshot(session: SwitchSession | null | undefined, status: SwitchStatus | null | undefined) {
  const matching = matchingStatusSnapshot(session, status);
  if (!session) return status?.snapshot ?? null;
  if (matching && !session.pending) return matching;
  return session.remote ?? null;
}

export function switchSessionView(session: SwitchSession | null | undefined, status: SwitchStatus | null | undefined, now: number | null, online = true) {
  const snapshot = switchSessionSnapshot(session, status);
  const remaining = confirmedSwitchRemaining(snapshot);
  const matching = matchingStatusSnapshot(session, status);
  const fresh = online && switchSnapshotFresh(status, now) && (!session
    || (!!matching && (!session.pending || sameBootAndSample(snapshot, matching))));
  const ready = !session
    ? switchSnapshotReady(status, now, online)
    : fresh && !!snapshot && snapshot.session_state !== "unknown" &&
      !switchHostSleeping(snapshot) && !switchHostSleeping(matching) &&
      snapshot.clock_trusted === true && snapshot.native_verified === true;
  return {
    snapshot,
    remaining_seconds: remaining,
    fresh,
    stale: !fresh,
    pending: !!session?.pending || session?.state === "pending",
    ready,
    explicitPaused: fresh && snapshot?.session_state === "paused",
  };
}

/** A confirmed top-up increases the existing device allowance without resetting use. */
export function switchRemainingAfterTopUp(grantedSeconds: number | string, consumedSeconds: number | string, topUpSeconds: number | string) {
  const granted = wholeSeconds(grantedSeconds) ?? 0;
  const consumed = wholeSeconds(consumedSeconds) ?? 0;
  const topUp = wholeSeconds(topUpSeconds) ?? 0;
  return Math.min(SWITCH_MAX_SECONDS, Math.max(0, granted - consumed) + topUp);
}

/** The cumulative grant cap applies to the session, not to the current remainder. */
export function switchTopUpChoices(availableSeconds: number, grantedSeconds: number | string) {
  const available = wholeSeconds(availableSeconds) ?? 0;
  const granted = Math.min(SWITCH_MAX_SECONDS, wholeSeconds(grantedSeconds) ?? 0);
  return usageChoices(Math.min(available, SWITCH_MAX_SECONDS - granted));
}
