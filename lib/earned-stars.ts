import {type Dashboard,localDay,offsetDay} from './model';
export type LedgerVisibilityScope={kind:"parent"|"family"|"child"|"locked";child_id:string|null}|undefined;

/** Whether the current ledger read scope lets this viewer see the child's ledger rows.
 * An absent scope means an older payload that has no visibility metadata; treat it as visible
 * so the UI does not hide real numbers. "locked" and another child's scope mean the rows were
 * filtered out server-side, so a counted zero would be a guess, not a measurement.
 */
export function ledgerVisibleForChild(scope:LedgerVisibilityScope,childId:string){
 if(!scope)return true;
 if(scope.kind==="parent"||scope.kind==="family")return true;
 return scope.kind==="child"&&scope.child_id===childId;
}
/** Gross earned stars by ledger posting day. Refunds, reversals and balances are not earnings. */
export function earnedStarDays(data:Dashboard,childId:string,today:string,days:number){
 const result=Array.from({length:days},(_,i)=>({day:offsetDay(today,i-days+1),amount:0,count:0}));
 const byDay=new Map(result.map(x=>[x.day,x]));
 const adjustments=new Map((data.star_adjustments||[]).filter(a=>a.child_id===childId).map(a=>[a.id,a.kind]));
 for(const row of data.star_ledger||[]){
  if(row.child_id!==childId||Number(row.amount)<=0)continue;
  const kind=row.source_type==='star_adjustment'?adjustments.get(row.source_id):null;
  if(!['checkin','manual_bonus','star_streak','star_savings'].includes(row.source_type)&&kind!=='streak'&&kind!=='savings')continue;
  const point=byDay.get(localDay(data.family.timezone,new Date(row.created_at)));
  if(point){point.amount+=Number(row.amount);point.count++;}
 }
 return result;
}

/** Effective earnings retain the original posting day. Spending/refunds are not earnings.
 * A later cancellation removes only its linked original income, never unrelated today's income.
 */
export function effectiveEarnedStarDays(data:Dashboard,childId:string,today:string,days:number){
 const ledger=(data.star_ledger||[]).filter(row=>row.child_id===childId);
 const undo=new Map<string,number>();
 for(const row of ledger) if(row.source_type==='undo' && Number(row.amount)<0)
  undo.set(row.source_id,(undo.get(row.source_id)||0)+Number(row.amount));
 const reversedGrants=new Set((data.manual_star_grants||[]).filter(g=>g.child_id===childId&&g.reversed_at).map(g=>g.id));
 const reversedAdjustments=new Set((data.star_adjustments||[]).filter(a=>a.child_id===childId&&a.kind==='reversal'&&a.related_id).map(a=>a.related_id));
 const effective=ledger.map(row=>{
  if(row.source_type==='checkin'&&Number(row.amount)>0)
   return {...row,amount:Math.max(0,Number(row.amount)+(undo.get(row.source_id)||0))};
  if(row.source_type==='manual_bonus'&&reversedGrants.has(row.source_id)) return {...row,amount:0};
  if(row.source_type==='star_adjustment'&&reversedAdjustments.has(row.source_id)) return {...row,amount:0};
  return row;
 });
 return earnedStarDays({...data,star_ledger:effective},childId,today,days);
}
