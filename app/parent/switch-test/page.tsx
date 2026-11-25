"use client";
import { useRef, useState } from "react";
const labels: Record<string,string> = {ready:"可提交一次测试",queued:"等待设备就绪，尚未确认发放",prepared:"已准备，尚未确认发放",dispatching:"等待设备回执",unknown:"结果待确认，不会重复发放",active:"设备已确认生效",resolved:"测试已结束",revoked:"授权已撤销",expired:"授权窗口已过期"};
export default function SwitchTest(){
 const [token,setToken]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[attempted,setAttempted]=useState(false);
 const gate=useRef(false);
 async function post(path:string,body:unknown){
  const r=await fetch(path,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const v=await r.json();if(!r.ok)throw Error(v.error||"service_unavailable");return v.data;
 }
 async function run(send:boolean){
  if(gate.current)return;gate.current=true;setBusy(true);if(send)setAttempted(true);
  try{const v=await post("/api/parent/switch-test"+(send?"":"/status"),{parent_token:token});setMessage(v?(labels[v.status]||"状态待确认"):"尚未配置一次性授权");}
  catch{setMessage(send?"提交结果待确认，请查询状态，不要重新发放。":"无法查询，请确认已登录且家长解锁未过期。");}
  finally{gate.current=false;setBusy(false);}
 }
 return <main className="switch-test"><h1>Switch 测试</h1><p>仅一次 10 分钟，不扣星星。</p>
 {!token?<form onSubmit={async e=>{e.preventDefault();if(gate.current)return;gate.current=true;setBusy(true);const form=e.currentTarget;const pin=String(new FormData(form).get("pin")||"");form.reset();try{const v=await post("/api/rpc/unlock_parent",{p_password:pin});if(typeof v!=="string")throw Error();setToken(v);setMessage("");}catch{setMessage("请先登录，再输入家长密码。");}finally{gate.current=false;setBusy(false);}}}>
 <label>家长密码<input name="pin" type="password" autoComplete="off" required maxLength={128}/></label><button disabled={busy}>解锁</button><a href="/">返回登录</a></form>:
 <div className="actions"><button disabled={busy||attempted} onClick={()=>void run(true)}>发放 10 分钟</button><button disabled={busy} onClick={()=>void run(false)}>查询状态</button><button disabled={busy} onClick={async()=>{if(gate.current)return;gate.current=true;setBusy(true);try{await post("/api/rpc/revoke_parent",{p_parent_token:token});setToken("");setMessage("");}catch{setMessage("锁定尚未确认，请重试。");}finally{gate.current=false;setBusy(false);}}}>锁定</button></div>}
 <p role="status" aria-live="polite">{message}</p>
 <style jsx>{`.switch-test{max-width:560px;margin:32px auto;padding:20px}h1{font-size:24px}form,label{display:grid;gap:12px}.actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}button,input{min-height:44px;padding:10px;border:1px solid #aaa;border-radius:10px;font:inherit}button{cursor:pointer}button:disabled{opacity:.5}p{overflow-wrap:anywhere}`}</style></main>;
}
