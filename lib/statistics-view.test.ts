import {it,expect} from 'vitest';
import {statisticsView} from '../app/growth-statistics';
it('keeps received child scope across four cards, time and source categories',()=>{
 const view=statisticsView({timezone:'Asia/Shanghai',period:'week',start:'2026-11-16',end:'2026-11-23',as_of:'2026-11-18',buckets:[{date:'2026-11-18',child_id:'a',category:'focus',seconds:180,count:1},{date:'2026-11-18',child_id:'a',category:'game:pending',seconds:900,count:2}],stars:[['checkin',7],['manual_bonus',2],['star_streak',3],['refund',31],['redemption',-11],['star_deduction',-2],['star_reversal',1],['undo',-1]].map(([source_type,amount])=>({date:'2026-11-18',child_id:'a',source_type:String(source_type),amount:Number(amount),count:1})),redemptions:[],balances:[{child_id:'a',balance:101}],notes:[]});
 expect(view.income).toBe(12);expect(view.spent).toBe(11);expect(view.refunds).toBe(31);expect(view.adjustment).toBe(-1);expect(view.corrections).toBe(-1);expect(view.balance).toBe(101);expect(view.totals.get('focus')).toBe(180);expect(view.pending).toBe(2);expect(view.chart).toHaveLength(7);expect(view.starSources.get('refund')).toBe(31);
});
