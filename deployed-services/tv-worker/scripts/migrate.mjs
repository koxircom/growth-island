import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const url = process.env.DATABASE_ADMIN_URL;
const password = process.env.APP_DB_PASSWORD;
if (!url || !password || password.length < 24) throw new Error("Set DATABASE_ADMIN_URL and APP_DB_PASSWORD (at least 24 characters).");
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(742861010)");
  // These names are dedicated to this application. Do not silently repurpose
  // an existing cluster's privileged roles or inherit unrelated memberships.
  for (const name of ["anon", "authenticated", "growth_app", "growth_tv_worker", "growth_switch_worker"]) {
    const role = (await db.query("SELECT * FROM pg_roles WHERE rolname=$1", [name])).rows[0];
    if (!role) continue;
    if (role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolreplication || role.rolbypassrls ||
        (!["growth_app", "growth_tv_worker", "growth_switch_worker"].includes(name) && role.rolcanlogin) || (["growth_app", "growth_tv_worker", "growth_switch_worker"].includes(name) && role.rolinherit))
      throw new Error("Unsafe existing role attributes: " + name + ". Use a dedicated database cluster.");
    const memberships = (await db.query("SELECT parent.rolname, membership.admin_option,membership.inherit_option,membership.set_option FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid WHERE membership.member=$1", [role.oid])).rows;
    if (memberships.some(member => name !== "growth_app" || member.rolname !== "authenticated" || member.admin_option || member.inherit_option || !member.set_option))
      throw new Error("Unexpected existing role membership: " + name + ". Use a dedicated database cluster.");
    const members = (await db.query("SELECT child.rolname FROM pg_auth_members membership JOIN pg_roles child ON child.oid=membership.member WHERE membership.roleid=$1", [role.oid])).rows;
    if (members.some(member => name !== "authenticated" || member.rolname !== "growth_app"))
      throw new Error("Unexpected members of existing role: " + name + ". Use a dedicated database cluster.");
    if ((await db.query("SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=$1 AND deptype='o' LIMIT 1", [role.oid])).rowCount)
      throw new Error("Existing role owns database objects: " + name + ". Use a dedicated database cluster.");
  }
  for (const role of ["anon", "authenticated"]) {
    if (!(await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount)
      await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  }
  if (!(await db.query("SELECT 1 FROM pg_roles WHERE rolname='growth_app'")).rowCount)
    await db.query("CREATE ROLE growth_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  const quoted = (await db.query("SELECT quote_literal($1) AS value", [password])).rows[0].value;
  await db.query(`ALTER ROLE growth_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoted}`);
  await db.query("GRANT authenticated TO growth_app");
  await db.query("CREATE SCHEMA IF NOT EXISTS auth");
  await db.query("CREATE TABLE IF NOT EXISTS auth.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const paths = ["db/000_auth.sql", ...(await readdir(new URL("../supabase/migrations/", import.meta.url))).filter(f => f.endsWith(".sql")).sort().map(f => "supabase/migrations/" + f), "db/002_runtime_grants.sql", "db/003_household_password.sql", "db/004_parent_lock.sql", "db/005_reward_enabled.sql", "db/006_timer_action_clock.sql", "db/007_time_wallet.sql", "db/008_device_time_extend.sql", "db/009_star_rules.sql", "db/010_tv_integration.sql", "db/011_child_photos.sql", "db/012_child_access.sql", "db/013_switch_status.sql", "db/014_habit_batch.sql", "db/015_account_book.sql", "db/016_wallet_policy.sql", "db/017_history_display.sql", "db/018_statistics.sql", "db/019_tv_auto_credit.sql", "db/020_tv_redemption_undo.sql", "db/021_all_reward_undo.sql", "db/023_device_reward_auto_credit.sql", "db/024_device_schedule.sql", "db/025_switch_allocation.sql", "db/026_habit_patch.sql", "db/027_star_ledger_balances.sql", "db/028_star_savings_policy.sql", "db/029_history_proposals.sql", "db/030_history_reason_optional.sql", "db/031_time_account_book_fix.sql"];
  paths.push(...["db/one-shot/01-binding-hold-candidate.sql", "db/one-shot/02-combined-store-r7.sql", "db/one-shot/03-worker-journal-r7.sql", "db/one-shot/04-worker-main-selector.sql", "db/one-shot/05-authorization.sql", "db/one-shot/06-authorized-dispatch.sql", "db/one-shot/07-test-session-continuation.sql", "db/one-shot/08-test-status-continuation.sql", "db/one-shot/09-worker-permissions.sql", "db/one-shot/10-owner-status.sql", "db/one-shot/11-durable-dispatch.sql"]);
  paths.push("db/032_child_access_password.sql");
  paths.push("db/033_habit_approval_default.sql");
  paths.push("db/035_habit_multi_audience.sql");
  paths.push("db/036_habit_delete_batch.sql");
  paths.push("db/037_habit_category.sql");
  paths.push("db/038_checkin_undo_without_redemption_unlock.sql", "db/041_habit_auto_voice.sql", "db/042_habit_order.sql", "db/043_family_star_rules.sql", "db/044_peer_penalty.sql");
  paths.push("db/045_switch_two_consoles.sql");
  for (const name of paths) {
    const sql = await readFile(new URL("../" + name, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prior = (await db.query("SELECT checksum FROM auth.schema_migrations WHERE name=$1", [name])).rows[0];
    if (prior && prior.checksum !== checksum) throw new Error("Migration changed after application: " + name);
    if (!prior) {
      await db.query(sql);
      await db.query("INSERT INTO auth.schema_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
      console.log("Applied", name);
    }
  }
  const database = (await db.query("SELECT quote_ident(current_database()) AS name")).rows[0].name;
  await db.query(`GRANT CONNECT ON DATABASE ${database} TO growth_app`);
  if (process.env.TV_WORKER_DB_PASSWORD) {
    if (process.env.TV_WORKER_DB_PASSWORD.length < 24) throw new Error("TV_WORKER_DB_PASSWORD must have at least 24 characters.");
    const tvQuoted=(await db.query("SELECT quote_literal($1) value",[process.env.TV_WORKER_DB_PASSWORD])).rows[0].value;
    await db.query(`ALTER ROLE growth_tv_worker LOGIN PASSWORD ${tvQuoted}`);
  }
  await db.query(`GRANT CONNECT ON DATABASE ${database} TO growth_tv_worker`);
  if (process.env.SWITCH_WORKER_DB_PASSWORD) {
    if (process.env.SWITCH_WORKER_DB_PASSWORD.length < 24) throw new Error("SWITCH_WORKER_DB_PASSWORD must have at least 24 characters.");
    const quoted=(await db.query("SELECT quote_literal($1) value",[process.env.SWITCH_WORKER_DB_PASSWORD])).rows[0].value;
    await db.query(`ALTER ROLE growth_switch_worker LOGIN PASSWORD ${quoted}`);
  }
  await db.query(`GRANT CONNECT ON DATABASE ${database} TO growth_switch_worker`);
  await db.query("COMMIT");
  console.log("Database ready. Runtime credentials are separate from migration credentials.");
} catch (error) { await db.query("ROLLBACK"); throw error; }
finally { await db.end(); }


