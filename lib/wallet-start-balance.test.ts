import {describe,it,expect,vi} from 'vitest';
import {walletBalanceGate,NO_WALLET_TIME,UNKNOWN_WALLET_TIME} from './wallet-start-balance';
describe('wallet start balance preflight',()=>{
 it('known empty balance uses existing prerecorded no-time prompt',()=>{for(const v of [0,'0',-1])expect(walletBalanceGate(v)).toBe(NO_WALLET_TIME)});
 it('missing/malformed is unknown, never empty or eligible',()=>{for(const v of [null,undefined,'',NaN,Infinity,'bad',false,{}])expect(walletBalanceGate(v)).toBe(UNKNOWN_WALLET_TIME)});
 it('positive balance permits later device safety checks, not automatic execution',()=>{expect(walletBalanceGate(60)).toBe('');expect(walletBalanceGate('120')).toBe('')});
 it('blocked event returns before device mutation',()=>{for(const v of [0,undefined]){const mutate=vi.fn(),voice=vi.fn();const click=()=>{const reason=walletBalanceGate(v);if(reason){voice(reason);return;}mutate()};click();expect(mutate).not.toHaveBeenCalled();expect(voice).toHaveBeenCalledTimes(1)}});
});

import {dashboardWalletBalance} from './wallet-start-balance';
it('complete empty dashboard ledger is known zero, missing payload stays unknown',()=>{expect(dashboardWalletBalance([], 'c','d')).toBe(0);expect(dashboardWalletBalance(undefined,'c','d')).toBeUndefined();expect(dashboardWalletBalance([{child_id:'c',device_id:'d',balance_seconds:120}],'c','d')).toBe(120);});
