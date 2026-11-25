import { createRequestId } from "./mutation";

const PREFIX = "growth-pending-v1:";
const MAX_PENDING = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "checkin", "redeem","redeem_undo", "manual_star_grant", "manual_star_reverse",
  "star_deduct", "star_reverse", "device_time_start", "device_time_extend", "device_time_stop",
]);
export const isJournaledMutation = (action: string) => ACTIONS.has(action);
export type PendingMutationHandle = Readonly<{ id: string; key: string | null }>;
type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Canonicalize the actual JSON sent to the API, not object insertion order. */
export function canonicalMutationPayload(payload: Record<string, unknown>): string {
  const json = JSON.parse(JSON.stringify(payload));
  function sort(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === "object") return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sort(item)]),
    );
    return value;
  }
  return JSON.stringify(sort(json));
}
async function fingerprint(value: string) {
  if (!globalThis.crypto?.subtle) throw new Error("pending_mutation_hash_unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Only opaque request IDs and hashes are persisted. No payloads, names, reasons,
 * credentials or parent tokens. No TTL, automatic replay or silent eviction:
 * an uncertain response must keep its ID until an acknowledged retry succeeds.
 * sessionStorage intentionally scopes this journal to one browser tab.
 */
export class PendingMutationJournal {
  constructor(
    private readonly storage: () => JournalStorage = () => window.sessionStorage,
    private readonly makeId: () => string = createRequestId,
    private readonly hash: (value: string) => Promise<string> = fingerprint,
  ) {}

  async prepare(familyId: string, action: string, payload: Record<string, unknown>): Promise<PendingMutationHandle> {
    if (!isJournaledMutation(action)) return { id: this.makeId(), key: null };
    if (!UUID.test(familyId)) throw new Error("pending_mutation_family_required");
    const digest = await this.hash(canonicalMutationPayload(payload));
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("pending_mutation_hash_unavailable");
    const key = PREFIX + familyId + ":" + action + ":" + digest;
    try {
      const storage = this.storage();
      const existing = storage.getItem(key);
      if (existing !== null) {
        if (!UUID.test(existing)) throw new Error("pending_mutation_corrupt");
        return { id: existing, key };
      }
      let count = 0;
      for (let index = 0; index < storage.length; index++) {
        if (storage.key(index)?.startsWith(PREFIX)) count++;
      }
      if (count >= MAX_PENDING) throw new Error("pending_mutation_limit");
      const id = this.makeId();
      if (!UUID.test(id)) throw new Error("pending_mutation_corrupt");
      storage.setItem(key, id);
      if (storage.getItem(key) !== id) throw new Error("pending_mutation_storage_unavailable");
      return { id, key };
    } catch (error) {
      if (error instanceof Error && ["pending_mutation_corrupt", "pending_mutation_limit"].includes(error.message)) throw error;
      throw new Error("pending_mutation_storage_unavailable");
    }
  }

  /** Call only after a successful API response, never from a finally block. */
  complete(handle: PendingMutationHandle) {
    if (!handle.key) return;
    try {
      const storage = this.storage();
      if (storage.getItem(handle.key) === handle.id) {
        storage.removeItem(handle.key);
        if (storage.getItem(handle.key) !== null) throw new Error("pending_mutation_storage_unavailable");
      }
    } catch { throw new Error("pending_mutation_storage_unavailable"); }
  }
}
