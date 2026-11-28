import {checkinHabitName,type Dashboard,localDay,offsetDay} from './model';
export type LedgerVisibilityScope={kind:"parent"|"family"|"child"|"locked";child_id:string|null}|undefined;

export const STREAK_BAR_COLOR = "#7c5ce0";
export const SAVINGS_BAR_COLOR = "#e9b308";

export type EarnedStarCategory = "regular" | "streak" | "savings";
export type EarnedStarDetailItem = {
 category: EarnedStarCategory;
 sourceType: "checkin" | "manual_bonus" | "streak" | "savings";
 label: string;
 amount: number;
 count: number;
};
export type EarnedStarDayBreakdown = {
 day: string;
 amount: number;
 count: number;
 regularAmount: number;
 checkinAmount: number;
 manualAmount: number;
 streakAmount: number;
 savingsAmount: number;
 items: EarnedStarDetailItem[];
};

const ITEM_ORDER: Record<EarnedStarDetailItem["sourceType"], number> = {
 savings: 0,
 streak: 1,
 manual_bonus: 2,
 checkin: 3,
};

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

function effectiveLedgerRows(data:Dashboard,childId:string){
 const ledger=(data.star_ledger||[]).filter(row=>row.child_id===childId);
 const undo=new Map<string,number>();
 for(const row of ledger) if(row.source_type==='undo' && Number(row.amount)<0)
  undo.set(row.source_id,(undo.get(row.source_id)||0)+Number(row.amount));
 const reversedGrants=new Set((data.manual_star_grants||[]).filter(g=>g.child_id===childId&&g.reversed_at).map(g=>g.id));
 const reversedAdjustments=new Set((data.star_adjustments||[]).filter(a=>a.child_id===childId&&a.kind==='reversal'&&a.related_id).map(a=>a.related_id));
 return ledger.map(row=>{
  if(row.source_type==='checkin'&&Number(row.amount)>0)
   return {...row,amount:Math.max(0,Number(row.amount)+(undo.get(row.source_id)||0))};
  if(row.source_type==='manual_bonus'&&reversedGrants.has(row.source_id)) return {...row,amount:0};
  if(['star_adjustment','star_streak','star_savings'].includes(row.source_type)&&reversedAdjustments.has(row.source_id)) return {...row,amount:0};
  return row;
 });
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
 const effective=effectiveLedgerRows(data,childId);
 return earnedStarDays({...data,star_ledger:effective},childId,today,days);
}

/** Detailed per-day breakdown separating daily/manual stars, streak bonuses, and savings interest. */
export function effectiveEarnedStarBreakdown(data:Dashboard,childId:string,today:string,days:number):EarnedStarDayBreakdown[]{
 const result:EarnedStarDayBreakdown[]=Array.from({length:days},(_,i)=>({
  day:offsetDay(today,i-days+1),
  amount:0,
  count:0,
  regularAmount:0,
  checkinAmount:0,
  manualAmount:0,
  streakAmount:0,
  savingsAmount:0,
  items:[],
 }));
 const byDay=new Map(result.map(x=>[x.day,x]));
 const adjustmentsById=new Map((data.star_adjustments||[]).filter(a=>a.child_id===childId).map(a=>[a.id,a]));
 const checkinsById=new Map((data.checkins||[]).filter(c=>c.child_id===childId).map(c=>[c.id,c]));
 const grantsById=new Map((data.manual_star_grants||[]).filter(g=>g.child_id===childId).map(g=>[g.id,g]));
 const itemMaps=new Map<string,Map<string,EarnedStarDetailItem>>();

 for(const row of effectiveLedgerRows(data,childId)){
  const amt=Number(row.amount);
  if(amt<=0)continue;
  const day=localDay(data.family.timezone,new Date(row.created_at));
  const point=byDay.get(day);
  if(!point)continue;

  const adj=row.source_type==='star_adjustment'?adjustmentsById.get(row.source_id):undefined;
  let item:Omit<EarnedStarDetailItem,'amount'|'count'>|null=null;

  if(row.source_type==='checkin'){
   const checkin=checkinsById.get(row.source_id);
   point.regularAmount+=amt;
   point.checkinAmount+=amt;
   item={category:'regular',sourceType:'checkin',label:checkin?checkinHabitName(data,checkin):'习惯打卡'};
  }else if(row.source_type==='manual_bonus'){
   const grant=grantsById.get(row.source_id);
   const reason=grant?.reason?.trim();
   point.regularAmount+=amt;
   point.manualAmount+=amt;
   item={category:'regular',sourceType:'manual_bonus',label:reason?`家长鼓励：${reason}`:'家长鼓励'};
  }else if(row.source_type==='star_streak'||(row.source_type==='star_adjustment'&&adj?.kind==='streak')){
   point.streakAmount+=amt;
   const habitName=adj?.habit_id?checkinHabitName(data,{habit_id:adj.habit_id,day:adj.period_day||day}):'';
   const label=habitName&&habitName!=='习惯打卡'?`连续奖励 · ${habitName}`:'连续奖励';
   item={category:'streak',sourceType:'streak',label};
  }else if(row.source_type==='star_savings'||(row.source_type==='star_adjustment'&&adj?.kind==='savings')){
   point.savingsAmount+=amt;
   item={category:'savings',sourceType:'savings',label:'存星利息'};
  }else{
   continue;
  }

  point.amount+=amt;
  point.count+=1;
  let map=itemMaps.get(day);
  if(!map){map=new Map();itemMaps.set(day,map);}
  const key=`${item.sourceType}:${item.label}`;
  const existing=map.get(key);
  if(existing){existing.amount+=amt;existing.count+=1;}
  else map.set(key,{...item,amount:amt,count:1});
 }

 for(const point of result){
  const map=itemMaps.get(point.day);
  if(map){
   point.items=[...map.values()].sort((a,b)=>ITEM_ORDER[a.sourceType]-ITEM_ORDER[b.sourceType]);
  }
 }
 return result;
}
