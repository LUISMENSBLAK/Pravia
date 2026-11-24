import { describe, expect, it } from 'vitest';
import { archiveProtocolPosition, parseArchiveProtocol } from './archiveProtocol';
const config = { revision: 0, anchor_folio: '1001', anchor_libro: 7, anchor_tomo: 2, tomos_por_libro: 3, folios_por_tomo: 40 };
describe('Archivo: explicit protocol configuration, never universal capacities', () => {
  it('requires all parameters without assuming ten tomes or 200 folios', () => { expect(() => parseArchiveProtocol({})).toThrow(); expect(() => parseArchiveProtocol({ ...config, folios_por_tomo: 0 })).toThrow(); });
  it('starts at an explicit anchor and consumes folios without reinterpreting instruments', () => { expect(archiveProtocolPosition(config, '1001')).toEqual({ next_folio:'1001', libro:'7', tomo:'2', folios_restantes:40 }); expect(archiveProtocolPosition(config, '1040')?.folios_restantes).toBe(1); });
  it('advances tome and book at the configured boundaries', () => { expect(archiveProtocolPosition(config, '1041')).toMatchObject({libro:'7',tomo:'3',folios_restantes:40}); expect(archiveProtocolPosition(config, '1081')).toMatchObject({libro:'8',tomo:'1'}); });
  it('does not pretend a position before the configured anchor is calculable', () => { expect(archiveProtocolPosition(config, '1000')).toBeNull(); });
  it('handles folios above Number.MAX_SAFE_INTEGER exactly', () => { const large={...config,anchor_folio:'9007199254740993'}; expect(archiveProtocolPosition(large,'9007199254741033')?.tomo).toBe('3'); });
  it('rejects invalid tome, revision and signed bigint overflow', () => { for(const bad of [{anchor_tomo:4},{revision:-1},{anchor_folio:'9223372036854775808'}]) expect(()=>parseArchiveProtocol({...config,...bad})).toThrow(); });
});
