import React from 'react';
import {createRoot} from 'react-dom/client';
import {PenaltyRuleSettings} from '../app/penalty-rule-settings';
import '../app/globals.css';
(window as any).fetch=async()=>({ok:true,json:async()=>({data:[{rule_id:'rule-1',revision:1,name:'测试约定',description:'',stars:1,enabled:true}]})});
createRoot(document.getElementById('root')!).render(<PenaltyRuleSettings token="fixture" busy={false}/>);
setTimeout(()=>{
 const result:Record<string,unknown>={};
 try{
 const buttons=Array.from(document.querySelectorAll('button'));
 const create=buttons.find(b=>b.textContent?.includes('创建惩罚'));
 if(!create)throw Error('missing create');create.click();
 setTimeout(()=>{
  try{
   const dialog=document.querySelector('dialog[open]') as HTMLDialogElement;
   if(!dialog)throw Error('create not modal');
   const form=dialog.querySelector('form');const cancel=Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent==='取消');
   const actions=Array.from(dialog.querySelectorAll('.dialog-actions button')).map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});
   const rect=dialog.getBoundingClientRect();
   result.create=!!form;result.viewport=window.innerWidth;result.docWidth=document.documentElement.scrollWidth;result.dialog={left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};result.actions=actions;
   cancel?.click();
   setTimeout(()=>{try{
    if(document.querySelector('dialog[open]'))throw Error('cancel failed');
    const edit=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='编辑');if(!edit)throw Error('missing edit');edit.click();
    setTimeout(()=>{const e=document.querySelector('dialog[open]');result.edit=!!e&&e.getAttribute('aria-label')==='编辑惩罚';result.ok=result.create===true&&result.edit===true;document.getElementById('result')!.textContent=JSON.stringify(result);},200);
   }catch(e){document.getElementById('result')!.textContent=String(e)}},200);
  }catch(e){document.getElementById('result')!.textContent=String(e)}
 },200);
 }catch(e){document.getElementById('result')!.textContent=String(e)}
},600);
