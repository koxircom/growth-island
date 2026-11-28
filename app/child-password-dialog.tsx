"use client";
import {useEffect,useRef,useState} from "react";
type Mode="setup"|"unlock"|"change"|"parent-set";
type Props={childName:string;mode:Mode;onSubmit:(password:string)=>Promise<void>;onClose:()=>void};
/** Passwords exist only in this mounted dialog. Never place them in the mutation journal. */
export function ChildPasswordDialog({childName,mode,onSubmit,onClose}:Props){
 const [password,setPassword]=useState("");const [confirm,setConfirm]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");const mounted=useRef(true);const gate=useRef(false);const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{mounted.current=true;const el=dialog.current;if(el&&!el.open)el.showModal();return()=>{mounted.current=false;if(el?.open)el.close();}},[]);
 useEffect(()=>{setPassword("");setConfirm("");setError("")},[mode,childName]);
 const pin=mode==="change"||mode==="parent-set";const setup=mode!=="unlock";const close=()=>{if(gate.current)return;setPassword("");setConfirm("");setError("");onClose()};
 const title=mode==="parent-set"?"设置孩子密码":mode==="setup"?"设置我的密码":mode==="change"?"修改密码":"解锁兑换";
 return <dialog ref={dialog} className="child-password-dialog" aria-labelledby="child-password-title" onCancel={e=>{e.preventDefault();close()}}><form onSubmit={async e=>{e.preventDefault();if(gate.current)return;if(pin&&!/^[0-9]{6}$/.test(password)){setError("请输入 6 位数字密码。");return}if(Array.from(password).length<4||Array.from(password).length>32||new TextEncoder().encode(password).length>72){setError("请输入 4–32 个字符的密码。");return}if(setup&&password!==confirm){setError("两次密码不一样，再检查一下。");return}gate.current=true;setBusy(true);setError("");try{await onSubmit(password);if(mounted.current){setPassword("");setConfirm("");onClose()}}catch{if(mounted.current){setError("还没确认成功，请检查后再试。");setPassword("");setConfirm("")}}finally{gate.current=false;if(mounted.current)setBusy(false)}}}>
 <h2 id="child-password-title">{title}</h2><p>{childName}{mode==="unlock"?"，解锁后可以使用 10 分钟。":pin?"，设置 6 位数字密码。":"，请自己输入并记住密码。"}</p>
 <label className="field"><span>{setup?"新密码":"密码"}</span><input autoFocus type="password" autoComplete={setup?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} inputMode={pin?"numeric":undefined} pattern={pin?"[0-9]{6}":undefined} required maxLength={pin?6:64} disabled={busy}/></label>
 {setup&&<label className="field"><span>再输入一次</span><input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} inputMode={pin?"numeric":undefined} pattern={pin?"[0-9]{6}":undefined} required maxLength={pin?6:64} disabled={busy}/></label>}
 {error&&<p role="alert" className="error">{error}</p>}
 <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy||!password||(setup&&!confirm)}>{busy?"确认中…":setup?"保存密码":"解锁"}</button></div>
 </form></dialog>
}
