"use client";
import type {Child} from '@/lib/model';
import {ChildAvatar} from './child-photo';
export function ChildQuickSwitch({children,value,onChange,disabled=false,allLabel,label="切换孩子"}:{children:Child[];value:string;onChange:(id:string)=>void;disabled?:boolean;allLabel?:string;label?:string}){
return <nav className="child-quick-switch" aria-label={label}>{allLabel&&<button type="button" aria-pressed={value===''} disabled={disabled} onClick={()=>onChange('')}>{allLabel}</button>}{children.map(c=><button type="button" key={c.id} aria-pressed={c.id===value} disabled={disabled} onClick={()=>{if(c.id!==value)onChange(c.id)}}><ChildAvatar child={c} size={28}/><span>{c.nickname}</span></button>)}</nav>;
}
