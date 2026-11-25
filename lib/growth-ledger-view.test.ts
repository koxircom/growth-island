import {expect,it} from 'vitest';
import {growthLedgerRows} from './growth-ledger-view';
import type {StarLedgerEntry} from './model';
const row=(id:string,source_type:string,amount:number,source_id='source',child_id='child')=>({id,source_type,amount,source_id,child_id,created_at:'2026-11-14',posting_seq:null,balance_before:null,balance_after:null}) as StarLedgerEntry;
it('hides exact net zero pair without mutating source audit',()=>{const rows=[row('a','checkin',1),row('b','undo',-1)];expect(growthLedgerRows(rows)).toEqual([]);expect(rows).toHaveLength(2)});
it('does not hide unmatched or mismatched accounting',()=>{for(const rows of [[row('a','checkin',1)],[row('a','checkin',2),row('b','undo',-1)]])expect(growthLedgerRows(rows)).toEqual(rows)});
it('keeps other child/source and actual later re-completion',()=>{const rows=[row('a','checkin',1),row('b','undo',-1),row('c','checkin',1,'later'),row('d','undo',-1,'source','other')];expect(growthLedgerRows(rows).map(r=>r.id)).toEqual(['c','d'])});
it('never suppresses unrelated reward/expense rows',()=>{const rows=[row('a','manual_bonus',1),row('b','manual_reversal',-1)];expect(growthLedgerRows(rows)).toEqual(rows)});
