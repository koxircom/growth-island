import type {StarLedgerEntry} from './model';
/** Display only: hide exact checkin/reversal pairs. Never alter accounting or audit rows. */
export function growthLedgerRows(rows:StarLedgerEntry[]):StarLedgerEntry[]{
 const groups=new Map<string,StarLedgerEntry[]>();
 for(const row of rows){if(row.source_type!=='checkin'&&row.source_type!=='undo')continue;
 const key=row.child_id+':'+row.source_id;groups.set(key,[...(groups.get(key)||[]),row]);}
 const hidden=new Set<string>();
 for(const group of groups.values()){
 if(group.length===2&&group.some(r=>r.source_type==='checkin')&&group.some(r=>r.source_type==='undo')&&group.reduce((n,r)=>n+Number(r.amount),0)===0)
 for(const row of group)hidden.add(row.id);
 }
 return rows.filter(row=>!hidden.has(row.id));
}
