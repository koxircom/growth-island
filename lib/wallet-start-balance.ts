export const NO_WALLET_TIME = '还没有可用时间，先去奖励小屋兑换哦。';
export const UNKNOWN_WALLET_TIME = '时间余额尚未确认，请稍候再试。';
export function walletBalanceGate(value:unknown):string {
 if(value===null||value===undefined||value===''||(typeof value!=='number'&&typeof value!=='string')) return UNKNOWN_WALLET_TIME;
 const amount=Number(value);
 return !Number.isFinite(amount)?UNKNOWN_WALLET_TIME:amount<=0?NO_WALLET_TIME:'';
}

/** Dashboard returns the complete grouped ledger; a missing pair is a known zero, not missing data. */
export function dashboardWalletBalance(rows:unknown,childId:string,deviceId:string):unknown {
 if(!Array.isArray(rows))return undefined;
 const row=rows.find(r=>r&&r.child_id===childId&&r.device_id===deviceId);
 return row ? row.balance_seconds : 0;
}
export const NEVER_REDEEMED_TIME='需要先用星星兑换。';
export const TV_STARTED_VOICE='尽情享受看电视的时间。';
/** Full dashboard redemption history only; any past/pending/cancelled record prevents 'never'. */
export function walletVoiceGate(balance:unknown,history:unknown,childId:string,deviceId:string){
 const gate=walletBalanceGate(balance);
 if(gate!==NO_WALLET_TIME||Number(balance)!==0||!Array.isArray(history))return gate;
 if(history.some(r=>!r||typeof r.child_id!=='string'||typeof r.kind!=='string'))return gate;
 return history.some(r=>r.child_id===childId&&r.device_id===deviceId)?gate:NEVER_REDEEMED_TIME;
}
export function trustedTvStart(session:{id:string;child_id:string;device_id:string;state:string;remote?:{started_at:number;ends_at:number}}|undefined,request:{id:string;childId:string;deviceId:string}|null,now:number|null){
 if(!session||!request||now===null||!Number.isFinite(now))return false;
 const remote=session.remote;
 return session.id===request.id&&session.child_id===request.childId&&session.device_id===request.deviceId&&session.state==='active'&&!!remote&&Number.isFinite(remote.started_at)&&Number.isFinite(remote.ends_at)&&remote.started_at>0&&remote.started_at*1000<=now+5000&&remote.ends_at*1000>now&&remote.ends_at>remote.started_at;
}
