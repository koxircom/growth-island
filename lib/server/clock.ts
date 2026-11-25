import { pool } from './db';
/** Use the same database clock that timestamps timers, not the Next.js host clock. */
export async function clockSample(started: number) {
  const result = await pool().query("SELECT extract(epoch FROM clock_timestamp()) * 1000 AS milliseconds");
  return { serverTime: Number(result.rows[0].milliseconds), processingMs: Math.max(0, performance.now() - started) };
}
