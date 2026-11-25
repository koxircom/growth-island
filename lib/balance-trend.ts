import {type Dashboard,localDay,offsetDay,balance} from './model';
/** get_dashboard returns the complete family ledger (027), not a paginated slice. Fail closed if its sum does not reconcile. */
export function balanceStarDays(data:Dashboard,childId:string,today:string,days=30){
 const points=Array.from({length:days},(_,i)=>({day:offsetDay(today,i-days+1),balance:0,delta:0,income:0,expense:0,count:0}));
 const rows=(data.star_ledger||[]).filter(r=>r.child_id===childId), current=balance(data,childId);
 const fail=(reason:string)=>({points:[],reason,opening:0,empty:rows.length===0});
 if(!Number.isSafeInteger(current)||rows.some(r=>!Number.isSafeInteger(Number(r.amount))||!Number.isFinite(new Date(r.created_at).getTime())))return fail('流水格式暂时无法核对，余额走势暂不展示。');
 if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.reduce((n,r)=>n+Number(r.amount),0)!==current)return fail('流水与当前余额尚未核对一致，暂不推算历史余额。');
 const byDay=new Map(points.map(p=>[p.day,p]));let opening=0;
 for(const r of rows){const day=localDay(data.family.timezone,new Date(r.created_at)),amount=Number(r.amount);if(day>today)return fail('存在晚于当前日期的流水，暂不推算余额走势。');if(day<points[0].day)opening+=amount;const p=byDay.get(day);if(p){p.delta+=amount;p.count++;if(amount>0)p.income+=amount;else p.expense-=amount;}}
 let running=opening;for(const p of points){running+=p.delta;p.balance=running;}
 return{points,reason:'',opening,empty:rows.length===0};
}
