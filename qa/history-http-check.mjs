import assert from 'node:assert/strict';
const origin='http://127.0.0.1:18359';
const base='http://127.0.0.1:3000';
const headers={'content-type':'application/json','origin':origin,'cookie':'growth_session='+ 'f'.repeat(64)};
const now=new Date();const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);const day=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const payload={habit_id:'00000000-0000-4000-8000-000000000004',day};
async function mutate(action,payload,id){const r=await fetch(base+'/api/rpc/family_mutate',{method:'POST',headers,body:JSON.stringify({p_action:action,p_payload:payload,p_request_id:id})});const j=await r.json();if(!r.ok)throw Error('HTTP '+r.status+' '+j.error);return j.data;}
const id='20000000-0000-4000-8000-000000000001';
const first=await mutate('checkin',payload,id);const c=first.checkins.find(c=>c.habit_id===payload.habit_id&&c.day===day&&c.status==='approved');assert.ok(c,'historical approved record absent');
const duplicate=await mutate('checkin',payload,id);assert.equal(duplicate.checkins.filter(c=>c.habit_id===payload.habit_id&&c.day===day&&c.status==='approved').length,1);
const undone=await mutate('undo_checkin',{id:c.id},'20000000-0000-4000-8000-000000000002');assert.equal(undone.checkins.find(x=>x.id===c.id).status,'undone');
console.log('PASS real HTTP historical checkin, retry and undo with synthetic child session and no parent token');
