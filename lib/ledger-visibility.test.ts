import {describe,it,expect} from 'vitest';
import {ledgerVisibleForChild} from './earned-stars';

describe('ledger visibility decides whether a star count is measured or unknown',()=>{
 it('parent scope sees every child ledger',()=>{
  expect(ledgerVisibleForChild({kind:'parent',child_id:null},'a')).toBe(true);
 });
 it('locked scope must not present a zero as a real count',()=>{
  expect(ledgerVisibleForChild({kind:'locked',child_id:null},'a')).toBe(false);
 });
 it('child scope sees its own ledger only',()=>{
  const scope={kind:'child' as const,child_id:'a'};
  expect(ledgerVisibleForChild(scope,'a')).toBe(true);
  expect(ledgerVisibleForChild(scope,'b')).toBe(false);
 });
 it('missing scope keeps older payloads visible instead of hiding real numbers',()=>{
  expect(ledgerVisibleForChild(undefined,'a')).toBe(true);
 });
});
