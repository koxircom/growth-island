import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestId, withMutationLock } from "./mutation";
afterEach(() => vi.unstubAllGlobals());
describe("HTTP-compatible request identifiers", () => {
  it("uses native randomUUID when available", () => {
    const randomUUID = vi.fn(() => "00112233-4455-4677-8899-aabbccddeeff");
    vi.stubGlobal("crypto", { randomUUID });
    expect(createRequestId()).toBe("00112233-4455-4677-8899-aabbccddeeff");
    expect(randomUUID).toHaveBeenCalledOnce();
  });
  it("generates RFC 4122 v4 IDs with getRandomValues when randomUUID is absent", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, i) => i * 17));
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    expect(createRequestId()).toBe("00112233-4455-4677-8899-aabbccddeeff");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
  it("releases the lock and busy state after random-source failure, allowing retry", async () => {
    const lock = { current: false }, busy = vi.fn(), send = vi.fn();
    vi.stubGlobal("crypto", { getRandomValues: () => { throw new Error("random source failed"); } });
    const run = () => withMutationLock(lock, busy, async () => {
      const id = createRequestId();
      await send(id);
      return id;
    });
    await expect(run()).rejects.toThrow("random source failed");
    expect(lock.current).toBe(false);
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(send).not.toHaveBeenCalled();
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
    await expect(run()).resolves.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(send).toHaveBeenCalledOnce();
    expect(lock.current).toBe(false);
  });
  it("does not use weak randomness when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(createRequestId).toThrow("secure_random_unavailable");
  });
  it("does not start a second mutation while one is pending", async () => {
    const lock = { current: false }, busy = vi.fn(), second = vi.fn();
    let finish!: () => void;
    const pending = withMutationLock(lock, busy, () => new Promise<void>(resolve => { finish = resolve; }));
    await withMutationLock(lock, busy, second);
    expect(second).not.toHaveBeenCalled();
    expect(lock.current).toBe(true);
    finish(); await pending;
    expect(lock.current).toBe(false);
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });
});
