import {publishLedgerInvalidation} from "./ledger-invalidation";
import { serverClock } from "./server-clock";
export type Session = { user: { id: string; email: string; visitor?: boolean } };
export const configured = true;
type Listener = (event: string, session: Session | null) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | undefined;
let authEpoch = 0;
let sessionRead = 0;
let currentSession: Session | null = null;
function emit(session: Session | null) {
  authEpoch++;
  currentSession = session;
  for (const listener of listeners) listener(session ? "SIGNED_IN" : "SIGNED_OUT", session);
}
async function request(path: string, body?: unknown) {
  const epoch = authEpoch;
  const sent = performance.now();
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (response.ok && value.clock) serverClock.observe(value.clock, sent);
  if (!response.ok) {
    if (response.status === 401 && path.startsWith("/api/rpc/") && path !== "/api/rpc/unlock_parent" && epoch === authEpoch) emit(null);
    throw new Error(value.error || "service_unavailable");
  }
  return value;
}
async function synchronizeCookie() {
  // Even an older successful response changes the browser's shared HttpOnly cookie.
  // Invalidate every tab, then read the actual cookie identity before showing records.
  emit(null);
  channel?.postMessage("changed");
  const { data, stale } = await auth.getSession();
  if (!stale) emit(data.session);
  return { session: currentSession };
}
export const auth = {
  async getSession() {
    const epoch = authEpoch, sequence = ++sessionRead;
    const data = await request("/api/auth/session");
    if (epoch !== authEpoch || sequence !== sessionRead) return { data: { session: currentSession }, stale: true };
    currentSession = data.session;
    return { data, stale: false };
  },
  onAuthStateChange(listener: Listener) {
    listeners.add(listener);
    if (typeof BroadcastChannel !== "undefined" && !channel) {
      channel = new BroadcastChannel("growth-auth");
      channel.onmessage = () => {
        // Cookie changes in another tab invalidate every pending result immediately.
        emit(null);
        const epoch = authEpoch;
        void auth.getSession().then(({ data, stale }) => {
          if (!stale && epoch === authEpoch) emit(data.session);
        }).catch(() => { if (epoch === authEpoch) emit(null); });
      };
    }
    return { data: { subscription: { unsubscribe: () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = undefined; } } } } };
  },
  async signInWithPassword(credentials: { email?: string; password: string }) {
    const epoch = ++authEpoch;
    let cookieWritten = false;
    try {
      await request("/api/auth/login", credentials);
      cookieWritten = true;
      const data = await synchronizeCookie();
      return { data, error: null };
    } catch (error) { return { data: { session: null }, error: cookieWritten || epoch === authEpoch ? error as Error : null }; }
  },
  async setup(password: string, confirmation: string) {
    await request("/api/auth/setup",{password,confirmation});
    await synchronizeCookie();
  },
  async changePassword(currentPassword: string,password: string,confirmation: string) {
    await request("/api/auth/password",{currentPassword,password,confirmation});
    await synchronizeCookie();
  },
  async signOut() {
    const epoch = ++authEpoch;
    // Only claim logout after the server has revoked the persistent session.
    try {
      await request("/api/auth/logout", {});
      await synchronizeCookie();
    } catch { if (epoch === authEpoch) throw new Error("logout_not_confirmed"); }
  },
};
export async function rpc<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const epoch=authEpoch;
  const value=await request("/api/rpc/" + encodeURIComponent(name), params);
  if(name==="unlock_parent")channel?.postMessage("changed");
  if(name==="family_mutate" && epoch===authEpoch && value.data?.ledger_read_scope?.channel_id)publishLedgerInvalidation(value.data.ledger_read_scope.channel_id);
  return value.data as T;
}

export async function synchronizeServerClock() { await request("/api/time"); return serverClock.confirmed(); }
