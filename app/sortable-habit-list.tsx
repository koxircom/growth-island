"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {DndContext,DragOverlay,MouseSensor,TouchSensor,KeyboardSensor,closestCenter,pointerWithin,useSensor,useSensors,type DragEndEvent} from "@dnd-kit/core";
import {SortableContext,useSortable,verticalListSortingStrategy,sortableKeyboardCoordinates,arrayMove} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";
import {GripVertical} from "lucide-react";
import {createRequestId} from "@/lib/mutation";
import {habitCategory,type Habit,type HabitCategory} from "@/lib/model";
type Order={ids:string[];token:string};
type Orders=Record<HabitCategory,Order>;
const interactive="button,a,input,textarea,select,[role=button],[contenteditable=true]";
async function orderRequest(body:Record<string,unknown>,signal?:AbortSignal):Promise<Orders>{
 const response=await fetch("/api/habit-order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal});
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result?.data)throw new Error(result?.error||"request_failed");
 return result.data;
}
function SortableRow({habit,disabled,children}:{habit:Habit;disabled:boolean;children:ReactNode}){
 const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:habit.id,disabled});
 const canStart=(target:EventTarget)=>target instanceof Element&&!target.closest(interactive);
 return <div ref={setNodeRef} className={`sortable-habit${isDragging?" is-dragging":""}`} role="listitem"
  tabIndex={disabled?-1:0} aria-roledescription="可排序习惯" aria-label={`${habit.name}，按空格开始排序，方向键移动，再按空格保存，Escape取消`}
  aria-describedby={attributes["aria-describedby"]} aria-disabled={disabled||undefined}
  style={{transform:CSS.Transform.toString(transform),transition}}
  onMouseDown={e=>{if(canStart(e.target))listeners?.onMouseDown?.(e);}}
  onTouchStart={e=>{if(canStart(e.target))listeners?.onTouchStart?.(e);}}
  onKeyDown={e=>{if(e.target===e.currentTarget)listeners?.onKeyDown?.(e);}}>
  {children}<GripVertical className="habit-drag-grip" size={14} aria-hidden="true"/>
 </div>;
}
function CategoryList({items,disabled,onSort,render}:{items:Habit[];disabled:boolean;onSort:(ids:string[])=>void;render:(h:Habit)=>ReactNode}){
 const [active,setActive]=useState<string|null>(null);
 const [reduceMotion,setReduceMotion]=useState(false);
 useEffect(()=>{const media=matchMedia("(prefers-reduced-motion: reduce)");const update=()=>setReduceMotion(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update);},[]);
 const suppressClick=useRef(false),multiTouch=useRef(false);
 useEffect(()=>{
  const guard=(event:TouchEvent)=>{if(event.touches.length===1)multiTouch.current=false;else if(event.touches.length>1){multiTouch.current=true;setActive(null);}};
  document.addEventListener("touchstart",guard,{capture:true,passive:true});
  return()=>document.removeEventListener("touchstart",guard,true);
 },[]);
 const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:7}}),useSensor(TouchSensor,{activationConstraint:{delay:350,tolerance:6}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
 const finish=(event:DragEndEvent)=>{
  setActive(null);suppressClick.current=true;
  if(!event.over||event.active.id===event.over.id)return;
  const from=items.findIndex(h=>h.id===event.active.id),to=items.findIndex(h=>h.id===event.over!.id);
  if(from>=0&&to>=0)onSort(arrayMove(items,from,to).map(h=>h.id));
 };
 const dragging=items.find(h=>h.id===active);
 return <DndContext sensors={sensors} cancelDrop={()=>multiTouch.current} collisionDetection={args=>multiTouch.current?[]:args.pointerCoordinates?pointerWithin(args):closestCenter(args)}
  accessibility={{screenReaderInstructions:{draggable:"按空格或回车开始排序，方向键移动，空格或回车保存，Escape取消。只能在同一分类内移动。"},announcements:{
   onDragStart:({active})=>`开始移动${items.find(h=>h.id===active.id)?.name||"习惯"}。`,
   onDragOver:({over})=>over?`移动到第${items.findIndex(h=>h.id===over.id)+1}项。`:undefined,
   onDragEnd:()=>"已结束拖动，正在保存顺序。",onDragCancel:()=>"已取消，顺序不变。"}}}
  onDragStart={e=>{if(!e.activatorEvent.type.startsWith("touch"))multiTouch.current=false;if(!multiTouch.current)setActive(String(e.active.id));suppressClick.current=true;}}
  onDragEnd={finish} onDragCancel={()=>{setActive(null);suppressClick.current=true;}}>
  <SortableContext items={items.map(h=>h.id)} strategy={verticalListSortingStrategy}>
   <div role="list" className="sortable-habit-group" onPointerDownCapture={()=>{if(!active)suppressClick.current=false;}}
    onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}>
    {items.map(h=><SortableRow key={h.id} habit={h} disabled={disabled||items.length<2}>{render(h)}</SortableRow>)}
   </div>
  </SortableContext>
  <DragOverlay dropAnimation={reduceMotion?null:{duration:180,easing:"ease-out"}}>{dragging?<div className="habit-drag-overlay"><GripVertical size={20}/><strong>{dragging.name}</strong><span>放开保存位置</span></div>:null}</DragOverlay>
 </DndContext>;
}
export function SortableHabitList({habits,childId,disabled,children}:{habits:Habit[];childId:string;disabled:boolean;children:(h:Habit)=>ReactNode}){
 const [orders,setOrders]=useState<Orders|null>(null),[saving,setSaving]=useState(false),[notice,setNotice]=useState("");
 const generation=useRef(0),pending=useRef(false);
 const signature=habits.map(h=>`${h.id}:${habitCategory(h)}`).sort().join(",");
 useEffect(()=>{
  const controller=new AbortController(),g=++generation.current;setOrders(null);setNotice("");setSaving(false);pending.current=false;
  orderRequest({action:"read",child_id:childId},controller.signal).then(value=>{if(g===generation.current)setOrders(value);}).catch(e=>{if(e.name!=="AbortError"&&g===generation.current)setNotice("暂时无法读取排序，联网后重试。");});
  return ()=>{controller.abort();generation.current++;};
 },[childId,signature]);
 const save=async(category:HabitCategory,ids:string[])=>{
  if(!orders||pending.current||disabled)return;
  const before=orders,g=generation.current;pending.current=true;setSaving(true);setNotice("正在保存顺序…");
  // Apply the same visible-slot permutation as the server, preserving hidden habits.
  let i=0;const included=new Set(ids);
  setOrders({...orders,[category]:{...orders[category],ids:orders[category].ids.map(id=>included.has(id)?ids[i++]:id)}});
  try{const value=await orderRequest({action:"save",child_id:childId,category,ids,token:before[category].token,request_id:createRequestId()});if(g===generation.current){setOrders(value);setNotice("顺序已保存");}}
  catch(error){if(g!==generation.current)return;setOrders(before);
   // A lost response may have committed. Read authoritative order; never blindly retry the write.
   try{const value=await orderRequest({action:"read",child_id:childId});if(g===generation.current){setOrders(value);setNotice(error instanceof Error&&error.message==="habit_order_conflict"?"顺序已在其他页面更新，已同步，请重新拖动。":"保存结果未确认，已同步服务器顺序，请检查后重试。");}}
   catch{if(g===generation.current){setOrders(null);setNotice("网络中断，无法确认排序是否保存，请刷新后检查。");}}
  }finally{if(g===generation.current){pending.current=false;setSaving(false);}}
 };
 return <div className="task-list habit-sort-list" aria-busy={saving}>
  <p className="habit-sort-hint">长按或拖动习惯调整顺序，同类内排序</p>
  {(["routine","occasional"] as HabitCategory[]).map(category=>{
   const rank=new Map(orders?.[category].ids.map((id,index)=>[id,index]));
   const items=habits.filter(h=>habitCategory(h)===category).sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));
   return items.length>0?<section key={category} className={`habit-category-item ${category}`}>
    <h3 className="habit-category-heading">{category==="routine"?"日常习惯":"偶尔习惯 · 遇到再做"}</h3>
    <CategoryList items={items} disabled={disabled||saving||!orders} onSort={ids=>void save(category,ids)} render={children}/>
   </section>:null;
  })}
  {!habits.length&&<div className="empty">今天没有安排任务。可以让家长添加一个小目标。</div>}
  <p className="habit-sort-notice" role="status" aria-live="polite">{notice}</p>
 </div>;
}
