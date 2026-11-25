/** Create an idempotency key on both HTTPS and explicitly supported LAN HTTP. */
export function createRequestId(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") throw new Error("secure_random_unavailable");
  // getRandomValues is available outside secure contexts; never fall back to Math.random.
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Release UI state even if preparing a request fails before any network call. */
export async function withMutationLock<T>(
  lock: { current: boolean },
  setBusy: (busy: boolean) => void,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  if (lock.current) return;
  lock.current = true;
  try {
    setBusy(true);
    return await operation();
  } finally {
    lock.current = false;
    setBusy(false);
  }
}
