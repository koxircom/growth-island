import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = (id: string) => ({ user: { id, email: id + "@example.test" } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { vi.resetModules(); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("authentication response ordering", () => {
  it("discards initial session read after a newer login", async () => {
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ session: session("b") })).mockResolvedValueOnce(response({ session: session("b") })));
    const { auth } = await import("./client");
    const initial = auth.getSession();
    await auth.signInWithPassword({ email: "b@example.test", password: "test" });
    old.resolve(response({ session: session("a") }));
    const result = await initial;
    expect(result.stale).toBe(true); expect(result.data.session.user.id).toBe("b");
  });
  it("does not sign out a newer login when an old RPC returns 401", async () => {
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ session: session("b") })).mockResolvedValueOnce(response({ session: session("b") })));
    const { auth, rpc } = await import("./client"); const listener = vi.fn(); auth.onAuthStateChange(listener);
    const pending = rpc("get_dashboard").catch(e => e);
    await auth.signInWithPassword({ email: "b@example.test", password: "test" });
    old.resolve(response({ error: "authentication_required" }, 401)); await pending;
    expect(listener).toHaveBeenCalledTimes(2); expect(listener).toHaveBeenLastCalledWith("SIGNED_IN", session("b"));
  });
  it("reconciles even an older login response that changes the shared cookie", async () => {
    const old = deferred(); let cookieIdentity = "b";
    vi.stubGlobal("fetch", vi.fn((path: string, options: { body?: string }) => {
      if (path === "/api/auth/session") return Promise.resolve(response({ session: session(cookieIdentity) }));
      if (options.body?.includes("a@example.test")) return old.promise;
      cookieIdentity = "b"; return Promise.resolve(response({ session: session("b") }));
    }));
    const { auth } = await import("./client"); const listener = vi.fn(); auth.onAuthStateChange(listener);
    const a = auth.signInWithPassword({ email: "a@example.test", password: "test" });
    await auth.signInWithPassword({ email: "b@example.test", password: "test" });
    expect(listener).toHaveBeenLastCalledWith("SIGNED_IN", session("b"));
    cookieIdentity = "a"; old.resolve(response({ session: session("a") })); await a;
    expect(listener).toHaveBeenLastCalledWith("SIGNED_IN", session("a"));
    expect((await auth.getSession()).data.session.user.id).toBe(cookieIdentity);
  });
  it("reconciles an older logout response that expires a newer cookie", async () => {
    const old = deferred(); let cookieIdentity: string | null = "b";
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/api/auth/logout") return old.promise;
      if (path === "/api/auth/session") return Promise.resolve(response({ session: cookieIdentity ? session(cookieIdentity) : null }));
      return Promise.resolve(response({ session: session("b") }));
    }));
    const { auth } = await import("./client"); const listener = vi.fn(); auth.onAuthStateChange(listener);
    const logout = auth.signOut();
    await auth.signInWithPassword({ email: "b@example.test", password: "test" });
    cookieIdentity = null; old.resolve(response({ ok: true })); await logout;
    expect(listener).toHaveBeenLastCalledWith("SIGNED_OUT", null);
  });
  it("only accepts the newest of overlapping session reads", async () => {
    const first = deferred(), second = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const { auth } = await import("./client");
    const a = auth.getSession(), b = auth.getSession();
    second.resolve(response({ session: session("b") })); expect((await b).stale).toBe(false);
    first.resolve(response({ session: session("a") })); expect((await a).stale).toBe(true);
  });
  it("a late broadcast refresh cannot overwrite a new local login", async () => {
    let channel: { onmessage: (() => void) | null };
    class Channel { onmessage = null; constructor() { channel = this; } postMessage() {} close() {} }
    vi.stubGlobal("BroadcastChannel", Channel);
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ session: session("b") })).mockResolvedValueOnce(response({ session: session("b") })));
    const { auth } = await import("./client"); const listener = vi.fn(); auth.onAuthStateChange(listener);
    channel!.onmessage!();
    await auth.signInWithPassword({ email: "b@example.test", password: "test" });
    old.resolve(response({ session: session("a") })); await new Promise(r => setTimeout(r, 0));
    expect(listener).toHaveBeenLastCalledWith("SIGNED_IN", session("b"));
    expect(listener.mock.calls.filter(call => call[1]?.user.id === "a")).toHaveLength(0);
  });
});
