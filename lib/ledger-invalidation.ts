type Notice={type:"ledger-invalidated";scope:string;id:string};
let channel:BroadcastChannel|undefined;
function ledgerChannel(){if(typeof BroadcastChannel==="undefined")return;try{return channel??=new BroadcastChannel("growth-ledger")}catch{return}}
export function publishLedgerInvalidation(scope:string){if(!/^[a-f0-9]{64}$/.test(scope))return;ledgerChannel()?.postMessage({type:"ledger-invalidated",scope,id:crypto.randomUUID()} satisfies Notice);}
export function publishChildScopeChange(){ledgerChannel()?.postMessage({type:"ledger-scope-changed",id:crypto.randomUUID()});}
export function subscribeLedgerInvalidation(scope:string,refresh:()=>void){
 const connection=ledgerChannel();if(!connection)return ()=>{};
 const seen=new Set<string>();let timer:ReturnType<typeof setTimeout>|undefined;
 const receive=(event:MessageEvent)=>{const v=event.data;if(!v||typeof v.id!=="string"||v.id.length>80||seen.has(v.id))return;if(v.type!=="ledger-scope-changed"&&(v.type!=="ledger-invalidated"||!/^[a-f0-9]{64}$/.test(scope)||v.scope!==scope))return;seen.add(v.id);if(seen.size>128)seen.delete(seen.values().next().value!);if(timer===undefined)timer=setTimeout(()=>{timer=undefined;refresh()},50);};
 connection.addEventListener("message",receive);
 return ()=>{connection.removeEventListener("message",receive);if(timer!==undefined)clearTimeout(timer)};
}
