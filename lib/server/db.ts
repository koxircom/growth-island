import { Pool, type PoolClient } from "pg";
const globalDatabase = globalThis as unknown as { growthPool?: Pool };
export function pool() {
  if (!process.env.DATABASE_URL) throw new Error("database_unavailable");
  if (!globalDatabase.growthPool) {
    const db = new Pool({
      connectionString: process.env.DATABASE_URL, max: 8,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      statement_timeout: 10000, idle_in_transaction_session_timeout: 15000,
    });
    // Idle sockets can fail during NAS/database restarts. pg discards them and reconnects.
    db.on("error", () => { console.error("Database connection interrupted; awaiting reconnect."); });
    globalDatabase.growthPool = db;
  }
  return globalDatabase.growthPool;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
