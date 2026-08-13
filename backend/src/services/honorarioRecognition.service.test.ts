import { describe, expect, it, vi } from 'vitest';
import { recognizeAcceptedQuote } from './honorarioRecognition.service';

describe('reconocimiento canónico de honorarios', () => {
  it('toma el snapshot de la versión aprobada y usa una clave única de cotización', async () => {
    const tx: any = {
      cotizacion: { findUnique: vi.fn().mockResolvedValue({ id: 'quote-1', user_id: 'lawyer-1', notaria_id: 'notary-1', versiones: [{ id: 'version-2', honorarios_pravia: 10_000 }], expediente: null }) },
      honorarioGenerado: { upsert: vi.fn().mockImplementation(({ create }) => create) },
    };
    const result = await recognizeAcceptedQuote(tx, { cotizacionId: 'quote-1', actorUserId: 'actor-1', recognizedAt: new Date('2026-08-12') });
    expect(result).toMatchObject({ clave_origen: 'COTIZACION:quote-1', cotizacion_version_id: 'version-2', monto: 10_000, evento_reconocimiento: 'COTIZACION_ACEPTADA' });
    expect(tx.honorarioGenerado.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { cotizacion_id: 'quote-1' } }));
  });

  it('no reconoce cotizaciones sin versión aprobada o sin honorarios', async () => {
    const tx: any = { cotizacion: { findUnique: vi.fn().mockResolvedValue({ id: 'quote-1', versiones: [], expediente: null }) }, honorarioGenerado: { upsert: vi.fn() } };
    await expect(recognizeAcceptedQuote(tx, { cotizacionId: 'quote-1', actorUserId: 'actor-1' })).rejects.toThrow('versión económica aprobada');
    expect(tx.honorarioGenerado.upsert).not.toHaveBeenCalled();
  });
});
