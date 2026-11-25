import type {PoolClient} from "pg";
import type {NextRequest} from "next/server";
import {digest,sessionToken} from "./auth";

export type LedgerReadScope={kind:"parent"|"family"|"child"|"locked";child_id:string|null;channel_id:string};
export async function ledgerReadScope(client:PoolClient,request:NextRequest,user:{id:string;visitor?:boolean}):Promise<LedgerReadScope>{
 if(!user.visitor)return {kind:"parent",child_id:null,channel_id:digest("ledger-notice:parent:"+user.id+":"+digest(sessionToken(request)||""))};
 return {kind:"family",child_id:null,channel_id:digest("ledger-notice:family:"+user.id)};
}
const histories=["checkins","timers","redemptions","rests","manual_star_grants","star_ledger","star_adjustments","star_settlements","history_proposals","device_usage_sessions","switch_sessions","tv_sessions"];
export function scopeDashboard(value:unknown,scope:LedgerReadScope):unknown{
 if(!value||typeof value!=="object"||!("family" in value)||!("children" in value))return value;
 const result:Record<string,unknown>={...(value as Record<string,unknown>),ledger_read_scope:scope};
 if(scope.kind==="child"||scope.kind==="locked")for(const key of histories){const rows=result[key];if(Array.isArray(rows))result[key]=rows.filter(row=>scope.child_id && row?.child_id===scope.child_id);}
 return result;
}
