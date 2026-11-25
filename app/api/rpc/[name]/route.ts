import {ledgerReadScope,scopeDashboard} from "@/lib/server/dashboard-scope";
import {setChildContext} from "@/lib/server/child-access";
import {randomInt} from "node:crypto";
import { clockSample } from "@/lib/server/clock";
import type { NextRequest } from "next/server";
import { sessionUser,sessionToken,digest,childViewer,login,setCookie,clearCookie } from "@/lib/server/auth";
import { pool,transaction } from "@/lib/server/db";
import { failure, HttpError, json, readBody } from "@/lib/server/http";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const businessErrors = new Set(["star_rules_conflict","child_unlock_required","history_conflict","history_pending_checkin","invalid_console_id","switch_not_active","switch_not_ready","switch_busy","switch_operation_pending","switch_already_bound","switch_not_bound","invalid_switch_binding","switch_sequence_conflict","switch_redemption_busy","switch_time_limit","switch_parent_required","redemption_external_unknown","redemption_undo_unavailable","redemption_time_already_used","device_time_cooldown", "device_extension_limit", "invalid_device_policy", "habit_changed_refresh", "star_timezone_confirmation_required", "invalid_star_rules", "invalid_star_adjustment", "star_daily_limit", "star_already_reversed", "star_adjustment_not_found", "invalid_reward_kind", "device_not_found", "device_inactive", "invalid_device_duration", "invalid_star_grant", "device_time_already_running", "insufficient_device_time", "device_usage_not_found", "already_reviewed", "authentication_required", "backfill_requires_parent_and_reason", "checkin_not_found", "child_not_found", "daily_game_time_used", "daily_goal_reached", "family_not_found", "game_timer_cannot_pause", "habit_not_active", "habit_not_active_on_date", "habit_not_found", "idempotency_conflict", "insufficient_stars", "invalid_date", "invalid_focus_duration", "invalid_request", "invalid_timer_kind", "invalid_timezone", "not_scheduled_today", "parent_required", "payload_too_large", "pin_must_be_6_to_12_digits", "redemption_not_found", "rest_day", "reward_not_found", "spent_stars_requires_parent", "timer_already_running", "timer_not_found", "two_children_maximum", "unknown_action"]);
export async function POST(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const started = performance.now();
  try {
    const { name } = await context.params;
    if (!["get_dashboard", "create_family", "unlock_parent", "lock_parent", "revoke_parent", "family_mutate"].includes(name)) throw new HttpError(404, "not_found");
    const body = await readBody(request);
    if(name==="unlock_parent"){
      const signed=await login({password:body.p_password});
      const old=sessionToken(request);
      if(old)await pool().query("SELECT auth.logout_session($1)",[digest(old)]);
      const token=(await pool().query("SELECT auth.issue_password_parent($1,$2) AS token",[digest(signed.token),signed.credentialHash])).rows[0].token;
      const response=json({data:token});setCookie(response,signed.token);return response;
    }
    if(name==="lock_parent"){
      const raw=sessionToken(request);
      if(raw)await pool().query("SELECT auth.logout_session($1)",[digest(raw)]);
      const response=json({data:{revoked:true}});clearCookie(response);return response;
    }
    const result = await transaction(async client => {
      const user = await childViewer(request, client);
      if (!user) throw new HttpError(401, "authentication_required");
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user.id]);
      await client.query("SELECT set_config('request.session_hash',$1,true)",[user.visitor?"":digest(sessionToken(request)!)]);
      const readScope=await ledgerReadScope(client,request,user);
      const execute=async()=>{
      if(name==="revoke_parent"){
        if(typeof body.p_parent_token!=="string"||!/^[a-f0-9]{64}$/.test(body.p_parent_token))throw new HttpError(400,"invalid_request");
        return (await client.query("SELECT public.lock_parent($1) AS result",[body.p_parent_token])).rows[0].result;
      }
      if (name === "get_dashboard") { await client.query("SELECT public.settle_owned_device_usage()"); return (await client.query("SELECT public.get_dashboard() AS result")).rows[0].result; }
      if (name === "create_family") {
        if(user.visitor)throw new HttpError(403,"parent_required");
        body.p_pin=String(randomInt(100000000,999999999));
        if (typeof body.p_name !== "string" || body.p_name.trim().length < 1 || body.p_name.length > 40 ||
          typeof body.p_pin !== "string" || !/^[0-9]{6,12}$/.test(body.p_pin) ||
          (body.p_timezone !== undefined && typeof body.p_timezone !== "string")) throw new HttpError(400, "invalid_request");
        // A lost HTTP response must not create another family or replace its PIN.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [user.id]);
        const existing = (await client.query("SELECT public.current_family_id() AS id")).rows[0].id;
        if (existing) return existing;
        return (await client.query("SELECT public.create_family($1,$2,$3) AS result", [body.p_name, body.p_pin, body.p_timezone || "Asia/Shanghai"])).rows[0].result;
      }
      if (typeof body.p_action !== "string" || body.p_action.length > 40 ||
        typeof body.p_request_id !== "string" || !uuid.test(body.p_request_id) ||
        !body.p_payload || typeof body.p_payload !== "object" || Array.isArray(body.p_payload) ||
        (body.p_parent_token != null && (typeof body.p_parent_token !== "string" || body.p_parent_token.length > 256)))
        throw new HttpError(400, "invalid_request");
      await setChildContext(client,request);
      const childActions=new Set(["history_submit","history_withdraw","checkin","undo_checkin","redeem","redeem_undo","timer_start","timer_pause","timer_resume","timer_finish","device_time_start","device_time_stop","device_time_extend"]);
      if(user.visitor && !childActions.has(body.p_action as string))throw new HttpError(403,"parent_required");
      if(user.visitor)body.p_parent_token=null;
      if(["history_submit","history_withdraw","history_review"].includes(body.p_action as string))return (await client.query("SELECT public.history_proposal_mutate($1,$2::jsonb,$3::uuid,$4) AS result",[body.p_action,JSON.stringify(body.p_payload),body.p_request_id,body.p_parent_token||null])).rows[0].result;
      if(body.p_action==="parent_lockout"){
        const payload=body.p_payload as Record<string,unknown>;
        if(typeof payload.enabled!=="boolean")throw new HttpError(400,"invalid_request");
        return (await client.query("SELECT public.set_parent_lockout($1,$2) AS result",[payload.enabled,body.p_parent_token])).rows[0].result;
      }
      if(body.p_action==="manual_star_reverse"){
        return (await client.query("SELECT public.reverse_manual_stars($1::jsonb,$2::uuid,$3) result",[JSON.stringify(body.p_payload),body.p_request_id,body.p_parent_token||null])).rows[0].result;
      }
      if(body.p_action==="habit_batch_delete")return (await client.query("SELECT public.family_habit_delete_batch($1,$2::jsonb,$3::uuid,$4) AS result",[body.p_action,JSON.stringify(body.p_payload),body.p_request_id,body.p_parent_token||null])).rows[0].result;
      if(body.p_action==="star_rules_family_save")return (await client.query("SELECT public.family_star_rules_save($1::jsonb,$2::uuid,$3) result",[JSON.stringify(body.p_payload),body.p_request_id,body.p_parent_token||null])).rows[0].result;
      if(body.p_action==="habit_batch_multi")return (await client.query("SELECT public.family_habit_multi($1::jsonb,$2::uuid,$3) AS result",[JSON.stringify(body.p_payload),body.p_request_id,body.p_parent_token||null])).rows[0].result;
      if(body.p_action==="habit_batch_save" || body.p_action==="habit_batch_active" || body.p_action==="habit_batch_patch" || body.p_action==="habit_batch_apply"){
        return (await client.query("SELECT public.family_habit_batch($1,$2::jsonb,$3::uuid,$4) AS result",
          [body.p_action, JSON.stringify(body.p_payload), body.p_request_id, body.p_parent_token || null])).rows[0].result;
      }
      return (await client.query("SELECT public.family_mutate($1,$2::jsonb,$3::uuid,$4) AS result",
        [body.p_action, JSON.stringify(body.p_payload), body.p_request_id, body.p_parent_token || null])).rows[0].result;
      };
      return scopeDashboard(await execute(),readScope);
    });
    // Clock calibration must not turn an already committed mutation into an error.
    // The timer can resynchronize independently if this auxiliary read fails.
    return json({ data: result, clock: await clockSample(started).catch(() => null) });
  } catch (error) {
    const dbError = error as { code?: string; message?: string };
    if (dbError.code === "P0001" && businessErrors.has(dbError.message || "")) return json({ error: dbError.message }, 400);
    if (["22P02", "23514", "23502", "22007", "22008"].includes(dbError.code || "")) return json({ error: "invalid_request" }, 400);
    if (dbError.code === "23505") return json({ error: "conflict_refresh" }, 409);
    return failure(error);
  }
}
