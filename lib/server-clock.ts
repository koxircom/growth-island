/** Database time anchored to a monotonic clock, never the device wall clock. */
export type ClockSample = { serverTime: number; processingMs: number };
export class ServerClock {
  private anchor: { server: number; monotonic: number; confirmed: number; sent: number } | null = null;
  private valid = true;
  private minSent = -Infinity;
  constructor(private monotonic: () => number = () => performance.now()) {}
  observe(sample: ClockSample, sent: number, received = this.monotonic()) {
    if (!Number.isFinite(sample.serverTime) || !Number.isFinite(sample.processingMs) || sample.processingMs < 0 || received < sent) return false;
    if (sent < this.minSent || (this.anchor && sent < this.anchor.sent)) return false;
    // Subtract server work: database/queue latency is not symmetric network latency.
    const networkMs = Math.max(0, received - sent - sample.processingMs);
    this.anchor = { server: sample.serverTime + networkMs / 2, monotonic: received, confirmed: sample.serverTime, sent };
    this.valid = true;
    return true;
  }
  now() { return this.valid && this.anchor ? this.anchor.server + Math.max(0, this.monotonic() - this.anchor.monotonic) : null; }
  confirmed() { return this.valid ? this.anchor?.confirmed ?? null : null; }
  invalidate() { this.valid = false; this.minSent = this.monotonic(); }
}
export const serverClock = new ServerClock();
