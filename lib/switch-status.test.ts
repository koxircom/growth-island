import {describe,it,expect} from 'vitest';
import {redemptionDiagnosis,switchStatusLimitations,type SwitchRedemption} from './switch-status';
const order:SwitchRedemption={id:'test-order',child_id:'test-child',device_id:'test-device',device_name:'Switch',reward_name:'Test',cost:2,duration_seconds:600,status:'approved',created_at:'2026-11-12T00:00:00Z',reviewed_at:null,credited_seconds:600};
describe('Switch accounting must never masquerade as device evidence',()=>{
 it('reports unconnected state and remaining time as unknown',()=>{expect(switchStatusLimitations.online).toContain('未知');expect(switchStatusLimitations.remaining).toContain('未知');});
 it('approved and credited is still unconfirmed on the console',()=>{const d=redemptionDiagnosis(order);expect(d.label).toContain('设备生效未知');expect(d.attention).toBe(true);});
 it.each([null,0,599,601,'not-a-number'])('detects missing or inconsistent credit %s',credit=>{expect(redemptionDiagnosis({...order,credited_seconds:credit}).label).toContain('到账异常');});
 it('accepts PG bigint string only as local accounting',()=>{expect(redemptionDiagnosis({...order,credited_seconds:'600'}).label).toContain('设备生效未知');});
 it.each(['pending','rejected'] as const)('does not call %s device applied',status=>{expect(redemptionDiagnosis({...order,status,credited_seconds:null}).attention).toBe(false);});
});
