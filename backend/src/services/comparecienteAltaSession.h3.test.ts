import { beforeEach, describe, expect, it, vi } from 'vitest';

const ids = vi.hoisted(() => ({
  organization: '00000000-0000-4000-8000-000000009001',
  user: '00000000-0000-4000-8000-000000009002',
  session: '00000000-0000-4000-8000-000000009003',
  compareciente: '00000000-0000-4000-8000-000000009004',
}));

const network = vi.hoisted(() => ({ uploadFile: vi.fn(), deleteFile: vi.fn(), downloadFile: vi.fn(), extract: vi.fn() }));
const fixture = vi.hoisted(() => {
  let session: any;
  let compareciente: any = null;
  let personaFisica: any = null;
  const events: any[] = [];
  const queries: any[] = [];
  const reset = () => {
    session = {
      id: ids.session, organization_id: ids.organization, usuario_id: ids.user,
      estatus: 'PENDIENTE_CONFIRMACION', expires_at: new Date('2099-01-01T00:00:00.000Z'),
      archived_at: null, borrador_json: {}, cargasTemporales: [], correlation_id: 'correlation-assisted',
    };
    compareciente = null; personaFisica = null; events.splice(0); queries.splice(0);
  };
  reset();
  const db: any = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(async (callback: any) => callback(db)),
    user: { findUnique: vi.fn().mockResolvedValue({ id: ids.user, activo: true }) },
    comparecienteAltaSession: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...session, cargasTemporales: [] })),
      findFirst: vi.fn().mockImplementation(() => Promise.resolve({ ...session, cargasTemporales: [] })),
      update: vi.fn().mockImplementation(({ data }: any) => { session = { ...session, ...data }; return Promise.resolve(session); }),
    },
    compareciente: {
      create: vi.fn().mockImplementation(({ data }: any) => { compareciente = { id: ids.compareciente, organization_id: ids.organization, ...data }; return Promise.resolve(compareciente); }),
      findFirst: vi.fn().mockImplementation(({ where, include }: any) => {
        if (!compareciente || where.id !== compareciente.id || (where.organization_id && where.organization_id !== ids.organization)) return Promise.resolve(null);
        if (include) return Promise.resolve({ ...compareciente, personaFisica, personaMoral: null, aliases: [], identificaciones: [] });
        return Promise.resolve(compareciente);
      }),
    },
    personaFisica: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => { personaFisica = { id: 'pf-1', ...data }; return Promise.resolve(personaFisica); }),
    },
    personaMoral: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    comparecienteAlias: { create: vi.fn() },
    comparecienteContacto: { create: vi.fn() },
    comparecienteDomicilio: { create: vi.fn() },
    comparecienteIdentificacion: { create: vi.fn() },
    cargaTemporalDocumento: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    documento: { create: vi.fn() },
    comparecienteDocumento: { create: vi.fn() },
    comparecienteDatoFuente: { create: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    domainEventOutbox: { create: vi.fn().mockImplementation(({ data }: any) => { const event = { id: `event-${events.length + 1}`, ...data }; events.push(event); return Promise.resolve(event); }) },
    screeningSource: { findMany: vi.fn().mockResolvedValue([]) },
    screeningSourceExecution: { create: vi.fn() },
    complianceScreeningResult: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(queries.find((item) => item.organization_id === where.organization_id && item.trigger_key === where.trigger_key && item.contract_version === where.contract_version) || null)),
      create: vi.fn().mockImplementation(({ data }: any) => { const query = { id: `query-${queries.length + 1}`, ...data }; queries.push(query); return Promise.resolve(query); }),
      update: vi.fn().mockImplementation(({ where, data }: any) => { const query = queries.find((item) => item.id === where.id); Object.assign(query, data); return Promise.resolve(query); }),
    },
  };
  return { db, events, queries, reset, getSession: () => session };
});

vi.mock('../config/prisma', () => ({ prisma: fixture.db, default: fixture.db }));
vi.mock('../auth/actorContext', () => ({ requireActorContext: () => ({ organizationId: ids.organization, userId: ids.user, sessionId: 'session-auth' }) }));
vi.mock('./supabase.service', () => ({ uploadFile: network.uploadFile, deleteFile: network.deleteFile, downloadFile: network.downloadFile }));
vi.mock('./openaiDocument.service', () => ({
  extraerMultiplesDocumentos: network.extract,
  curpToFechaNacimiento: vi.fn(), extraerFolioIneMrz: vi.fn(), autoridadPorTipoDocumento: vi.fn(), getOpenAIModelName: vi.fn(),
}));

import { ComparecienteAltaSessionService } from './comparecienteAltaSession.service';

describe('H3-F-001 · alta asistida canónica', () => {
  beforeEach(() => { fixture.reset(); vi.clearAllMocks(); });

  it('confirma la sesión, persiste un evento/Query H3 y el retry no duplica nada ni usa red', async () => {
    const params = {
      sessionId: ids.session, usuarioId: ids.user, documentosIntegrarIds: [],
      datosFormulario: { tipo_persona: 'FISICA', nombre: 'PERSONA', apellido_paterno: 'SINTETICA', apellido_materno: 'PRUEBA', nacionalidad: 'Mexicana' },
    };
    const first = await ComparecienteAltaSessionService.confirmarAltaDefinitiva(params);
    const retry = await ComparecienteAltaSessionService.confirmarAltaDefinitiva(params);

    expect(first.compareciente.id).toBe(ids.compareciente); expect(retry.compareciente.id).toBe(ids.compareciente);
    expect(fixture.db.compareciente.create).toHaveBeenCalledTimes(1);
    expect(fixture.events).toHaveLength(1); expect(fixture.events[0]).toMatchObject({ event_type: 'ComparecienteCreado', aggregate_id: ids.compareciente });
    expect(fixture.queries).toHaveLength(1); expect(fixture.queries[0]).toMatchObject({ contract_version: 'CUM-LST-001', query_kind: 'MASTER', trigger_reason: 'COMPARECIENTE_CREATED', execution_state: 'NOT_CONFIGURED' });
    expect(fixture.getSession()).toMatchObject({ estatus: 'COMPLETADO' });
    expect(network.uploadFile).not.toHaveBeenCalled(); expect(network.downloadFile).not.toHaveBeenCalled(); expect(network.extract).not.toHaveBeenCalled();
  });
});
