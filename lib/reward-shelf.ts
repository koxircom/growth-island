import type {Reward} from './model';

// Presentation only: never authorizes redemption or alters its existing rules.
export function rewardStarGap(available:number,cost:number):number|null {
 if(!Number.isFinite(available)||!Number.isFinite(cost)||cost<0)return null;
 return Math.max(0,cost-available);
}
export function childRewards(rewards:Reward[],childId:string):Reward[] {
 return rewards.filter(r=>r.active!==false&&(!r.child_id||r.child_id===childId));
}
export function starEnoughRewards(rewards:Reward[],available:number):Reward[] {
 return rewards.filter(r=>rewardStarGap(available,r.cost)===0);
}
