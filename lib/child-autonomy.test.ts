import {describe,it,expect,vi} from 'vitest';
import {ledgerReadScope,scopeDashboard} from './server/dashboard-scope';
import {ledgerVisibleForChild} from './earned-stars';
import type {NextRequest} from 'next/server';
import type {PoolClient} from 'pg';

describe('household child access',()=>{
 it('makes both children\'s ledger rows visible to a visitor without a child password',async()=>{
  const client={query:vi.fn()} as unknown as PoolClient;
  const scope=await ledgerReadScope(client,{} as NextRequest,{id:'owner',visitor:true});
  expect(scope.kind).toBe('family');expect(client.query).not.toHaveBeenCalled();
  const input={family:{},children:[{id:'a'},{id:'b'}],checkins:[{child_id:'a'},{child_id:'b'}],star_ledger:[{child_id:'a',amount:2},{child_id:'b',amount:3}]};
  const result=scopeDashboard(input,scope) as typeof input;
  expect(result.star_ledger).toEqual(input.star_ledger);expect(result.checkins).toEqual(input.checkins);
  expect(ledgerVisibleForChild(scope,'a')).toBe(true);expect(ledgerVisibleForChild(scope,'b')).toBe(true);
 });
 it('does not identify a household visitor as a parent',async()=>{
  const scope=await ledgerReadScope({} as PoolClient,{} as NextRequest,{id:'owner',visitor:true});
  expect(scope.kind).not.toBe('parent');
 });
});
