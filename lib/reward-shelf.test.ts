import {describe,it,expect} from 'vitest';
import {childRewards,starEnoughRewards,rewardStarGap} from './reward-shelf';
import type {Reward} from './model';
const rewards:Reward[]=[{id:'shared',name:'共用',cost:3,child_id:null},{id:'a',name:'A',cost:8,child_id:'a'},{id:'b',name:'B',cost:2,child_id:'b'},{id:'off',name:'停用',cost:0,child_id:null,active:false}];
describe('read-only reward shelf',()=>{
 it('isolates children and excludes disabled rewards',()=>{expect(childRewards(rewards,'a').map(r=>r.id)).toEqual(['shared','a']);expect(childRewards(rewards,'b').map(r=>r.id)).toEqual(['shared','b'])});
 it('recomputes after balance changes without mutation',()=>{const original=JSON.stringify(rewards);expect(starEnoughRewards(childRewards(rewards,'a'),3).map(r=>r.id)).toEqual(['shared']);expect(starEnoughRewards(childRewards(rewards,'a'),8)).toHaveLength(2);expect(starEnoughRewards(childRewards(rewards,'a'),0)).toHaveLength(0);expect(JSON.stringify(rewards)).toBe(original)});
 it('handles exact balance, shortage, negative balances and free rewards',()=>{expect(rewardStarGap(3,3)).toBe(0);expect(rewardStarGap(2,8)).toBe(6);expect(rewardStarGap(-2,3)).toBe(5);expect(rewardStarGap(0,0)).toBe(0)});
 it('never marks invalid values as enough',()=>{for(const [a,c] of [[NaN,2],[Infinity,2],[3,NaN],[3,-1]])expect(rewardStarGap(a,c)).toBeNull()});
 it('handles empty catalogs',()=>{expect(childRewards([],'a')).toEqual([]);expect(starEnoughRewards([],3)).toEqual([])});
});
