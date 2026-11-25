"use client";
import {useRef,useState} from "react";
import {Animal} from "./art";
import type {Child} from "@/lib/model";
export function ChildAvatar({child,size=60}:{child:Child;size?:number}){
 const [failed,setFailed]=useState<string|null>(null);
 return child.photo_id && failed!==child.photo_id ? <img className="child-avatar-photo" src={`/api/children/${child.id}/photo?v=${child.photo_id}`} alt="" width={size} height={size} onError={()=>setFailed(child.photo_id!)} style={{borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>:<Animal kind={child.avatar} size={size}/>;
}
export function PhotoUpload({child,token,onSaved}:{child:Child;token:string;onSaved:()=>void}){
 const input=useRef<HTMLInputElement>(null),lock=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function upload(file?:File){
  if(!file||lock.current)return;
  if(file.size>5*1024*1024){setError("照片不能超过 5 MB，请选择较小的照片。");return;}
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setError("请选择 JPG、PNG 或 WebP 照片；HEIC 请先转为 JPG。");return;}
  lock.current=true;setBusy(true);setError("");
  try{
   const response=await fetch(`/api/children/${child.id}/photo`,{method:"POST",headers:{"Content-Type":file.type,"X-Parent-Token":token},body:file,credentials:"same-origin"});
   const value=await response.json();
   if(!response.ok)throw new Error(value.error);
   onSaved();setError("头像已保存");
  }catch(e){setError((e as Error).message==="parent_required"?"家长身份已过期，请重新解锁。":"上传结果未确认，请刷新检查头像后再重试。");}
  finally{lock.current=false;setBusy(false);if(input.current)input.current.value="";}
 }
 return <div className="photo-upload"><button type="button" className="photo-upload-button" disabled={busy} onClick={()=>input.current?.click()} aria-label={`上传${child.nickname}的头像照片`}><ChildAvatar child={child}/><span>{busy?"保存中…":"更换照片"}</span></button><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>void upload(e.target.files?.[0])}/>{error&&<small role="status">{error}</small>}</div>;
}
