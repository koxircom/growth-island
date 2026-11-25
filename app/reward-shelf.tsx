"use client";
import {useState,type ReactNode} from 'react';
import {Star} from 'lucide-react';
import type {Reward} from '@/lib/model';
import {childRewards,starEnoughRewards,rewardStarGap} from '@/lib/reward-shelf';

export function RewardShelf({rewards,childId,available,renderReward}:{rewards:Reward[];childId:string;available:number;renderReward:(reward:Reward)=>ReactNode}) {
 const [onlyEnough,setOnlyEnough]=useState(false);
 const all=childRewards(rewards,childId),enough=starEnoughRewards(all,available),shown=onlyEnough?enough:all;
 return <section aria-label="挑选奖励">
  <nav className="child-quick-switch reward-shelf-filter" aria-label="奖励星星筛选">
   <button type="button" aria-pressed={!onlyEnough} onClick={()=>setOnlyEnough(false)}>全部奖励 · {all.length}</button>
   <button type="button" aria-pressed={onlyEnough} onClick={()=>setOnlyEnough(true)}>星星已够 · {enough.length}</button>
  </nav>
  <p className="small">只按可用星星筛选，兑换和使用仍遵守原来的家庭约定。</p>
  {!shown.length?<p className="muted" role="status">{all.length?'暂时没有星星已够的奖励，切回全部奖励看看目标吧。':'暂时没有适合你的奖励，等家长添加新的小愿望。'}</p>:<div className="reward-grid reward-gallery">{shown.map(renderReward)}</div>}
 </section>;
}
export function RewardStarProgress({available,cost}:{available:number;cost:number}) {
 const gap=rewardStarGap(available,cost);
 return <p className="small reward-star-progress"><Star size={15} aria-hidden="true"/>{gap===null?'星星信息更新中':gap===0?'星星已够，按家庭约定兑换':`还差 ${gap} 颗星星，慢慢积累`}</p>;
}
