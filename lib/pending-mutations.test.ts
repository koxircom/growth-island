import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PendingMutationJournal, canonicalMutationPayload, isJournaledMutation } from "./pending-mutations";

const family = "00000000-0000-4000-8000-000000000001";
const family2 = "00000000-0000-4000-8000-000000000002";
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data, get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
function ids() {
  let n = 10;
  return () => "00000000-0000-4000-8000-" + String(n++).padStart(12, "0");
}
describe("reload-safe opaque pending mutation journal", () => {
  it("reuses the request after uncertain response and a page reload", async () => {
    const storage = memoryStorage(), makeId = ids();
    const a = await new PendingMutationJournal(() => storage, makeId, hash).prepare(family, "redeem", { child_id: "child", reward_id: "reward" });
    const b = await new PendingMutationJournal(() => storage, makeId, hash).prepare(family, "redeem", { reward_id: "reward", child_id: "child" });
    expect(b).toEqual(a);
  });
  it("makes the next identical intentional action new after acknowledged success", async () => {
    const storage = memoryStorage(), journal = new PendingMutationJournal(() => storage, ids(), hash);
    const a = await journal.prepare(family, "redeem", { reward_id: "r" });
    journal.complete(a);
    const b = await journal.prepare(family, "redeem", { reward_id: "r" });
    expect(b.id).not.toBe(a.id);
    expect(storage.length).toBe(1);
  });
  it("isolates family, action and payload", async () => {
    const journal = new PendingMutationJournal(() => memory, ids(), hash), memory = memoryStorage();
    const results = await Promise.all([
      journal.prepare(family, "redeem", { amount: 1 }),
      journal.prepare(family2, "redeem", { amount: 1 }),
      journal.prepare(family, "checkin", { amount: 1 }),
      journal.prepare(family, "redeem", { amount: 2 }),
    ]);
    expect(new Set(results.map(x => x.id)).size).toBe(4);
  });
  it("does not persist names, reasons or payload text", async () => {
    const memory = memoryStorage(), journal = new PendingMutationJournal(() => memory, ids(), hash);
    await journal.prepare(family, "manual_star_grant", { child_id: "secret-child", reason: "private reason", amount: 9 });
    const serialized = JSON.stringify([...memory.data]);
    for (const word of ["secret-child", "private reason", "amount"]) expect(serialized).not.toContain(word);
  });
  it("does not journal unapproved or sensitive actions", async () => {
    const storage = vi.fn(() => { throw Error("must not access"); });
    const journal = new PendingMutationJournal(storage, ids(), hash);
    for (const action of ["family_save", "unlock_parent", "password", "unknown"]) {
      expect(isJournaledMutation(action)).toBe(false);
      expect((await journal.prepare(family, action, { password: "secret" })).key).toBeNull();
    }
    expect(storage).not.toHaveBeenCalled();
  });
  it("fails closed if storage is denied or throws on set", async () => {
    await expect(new PendingMutationJournal(() => { throw Error("denied"); }, ids(), hash).prepare(family, "redeem", {}))
      .rejects.toThrow("pending_mutation_storage_unavailable");
    const memory = memoryStorage();
    memory.setItem = () => { throw Error("quota"); };
    await expect(new PendingMutationJournal(() => memory, ids(), hash).prepare(family, "redeem", {}))
      .rejects.toThrow("pending_mutation_storage_unavailable");
  });
  it("detects silent storage failure", async () => {
    const memory = memoryStorage(); memory.setItem = () => {};
    await expect(new PendingMutationJournal(() => memory, ids(), hash).prepare(family, "redeem", {}))
      .rejects.toThrow("pending_mutation_storage_unavailable");
  });
  it("never overwrites corrupt unresolved entries", async () => {
    const memory = memoryStorage(), journal = new PendingMutationJournal(() => memory, ids(), hash);
    const a = await journal.prepare(family, "redeem", {}); memory.setItem(a.key!, "broken");
    await expect(journal.prepare(family, "redeem", {})).rejects.toThrow("pending_mutation_corrupt");
    expect(memory.getItem(a.key!)).toBe("broken");
  });
  it("does not silently evict older unresolved requests", async () => {
    const memory = memoryStorage(), journal = new PendingMutationJournal(() => memory, ids(), hash);
    const first = await journal.prepare(family, "redeem", { n: 0 });
    for (let n = 1; n < 200; n++) await journal.prepare(family, "redeem", { n });
    await expect(journal.prepare(family, "redeem", { n: 200 })).rejects.toThrow("pending_mutation_limit");
    expect(await journal.prepare(family, "redeem", { n: 0 })).toEqual(first);
  });
  it("retains a newer handle if a stale completion arrives", async () => {
    const memory = memoryStorage(), journal = new PendingMutationJournal(() => memory, ids(), hash);
    const old = await journal.prepare(family, "redeem", {});
    journal.complete(old);
    const current = await journal.prepare(family, "redeem", {});
    journal.complete(old);
    expect(memory.getItem(current.key!)).toBe(current.id);
  });
  it("surfaces failed completion rather than claiming local cleanup", async () => {
    const memory = memoryStorage(), journal = new PendingMutationJournal(() => memory, ids(), hash);
    const handle = await journal.prepare(family, "redeem", {});
    memory.removeItem = () => { throw Error("denied"); };
    expect(() => journal.complete(handle)).toThrow("pending_mutation_storage_unavailable");
    expect(memory.getItem(handle.key!)).toBe(handle.id);
  });
  it("canonicalizes nested JSON but preserves array order", () => {
    expect(canonicalMutationPayload({ b: { y: 2, x: 1 }, a: undefined }))
      .toBe(canonicalMutationPayload({ b: { x: 1, y: 2 } }));
    expect(canonicalMutationPayload({ a: [1, 2] })).not.toBe(canonicalMutationPayload({ a: [2, 1] }));
  });
  it("does not touch storage when fingerprint fails or identity is invalid", async () => {
    const storage = vi.fn(() => memoryStorage());
    await expect(new PendingMutationJournal(storage, ids(), async () => { throw Error("hash failed"); }).prepare(family, "redeem", {})).rejects.toThrow("hash failed");
    await expect(new PendingMutationJournal(storage, ids(), hash).prepare("", "redeem", {})).rejects.toThrow("pending_mutation_family_required");
    expect(storage).not.toHaveBeenCalled();
  });
});
