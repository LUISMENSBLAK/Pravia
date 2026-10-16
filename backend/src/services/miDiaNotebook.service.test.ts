import { describe, expect, it, vi } from 'vitest';
import { MiDiaNotebookService } from './miDiaNotebook.service';

const actor = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as any;
const client = () => {
  const db = {
  userPreference: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Mexico_City' }) },
  notaria: { findFirst: vi.fn().mockResolvedValue({ horario_semanal: null }) },
  miDiaPersonalTask: {
    findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'task-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn(),
  },
  tarea: { findMany: vi.fn().mockResolvedValue([]) },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  return Object.assign(db, { $transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)) });
};

describe('Mi Día · libreta personal', () => {
  it('crea una tarea sólo en la organización y usuario actuales, con fecha original', async () => {
    const db = client();
    await new MiDiaNotebookService(db as any).create(actor, { title: '  Llamar cliente  ', date: '2026-10-13' }, new Date('2026-10-12T18:00:00Z'));
    expect(db.miDiaPersonalTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organization_id: actor.organizationId, user_id: actor.id, title: 'Llamar cliente',
      original_on: new Date('2026-10-13T00:00:00.000Z'), effective_on: new Date('2026-10-13T00:00:00.000Z'),
    }) });
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'CREATE_MI_DIA_TASK' }) }));
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it('arrastra un pendiente del viernes al lunes y conserva la fecha original', async () => {
    const db = client();
    db.miDiaPersonalTask.findMany.mockResolvedValueOnce([{ id: 'task-1', effective_on: new Date('2026-10-09T00:00:00Z'), carry_history: [], completed_at: null, canceled_at: null }]);
    const result = await new MiDiaNotebookService(db as any).list(actor, { date: '2026-10-12' }, new Date('2026-10-12T18:00:00Z'));
    expect(result.today).toBe('2026-10-12');
    expect(db.miDiaPersonalTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: actor.organizationId, user_id: actor.id }),
      data: expect.objectContaining({ effective_on: new Date('2026-10-12T00:00:00Z'), carry_history: [{ from: '2026-10-09', to: '2026-10-12' }] }),
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      accion: 'CARRY_MI_DIA_TASK', entidad_id: 'task-1',
    }) }));
  });

  it('respeta un lunes cerrado por el calendario operativo de la notaría', async () => {
    const db = client();
    db.notaria.findFirst.mockResolvedValueOnce({ horario_semanal: { lunes: { cerrado: true } } });
    db.miDiaPersonalTask.findMany.mockResolvedValueOnce([{ id: 'task-1', effective_on: new Date('2026-10-09T00:00:00Z'), carry_history: [], completed_at: null, canceled_at: null }]);
    await new MiDiaNotebookService(db as any).list(actor, { date: '2026-10-13' }, new Date('2026-10-13T18:00:00Z'));
    expect(db.miDiaPersonalTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      effective_on: new Date('2026-10-13T00:00:00Z'),
      carry_history: [{ from: '2026-10-09', to: '2026-10-13' }],
    }) }));
  });

  it('no pierde tareas de hoy detrás de más de 500 entradas históricas', async () => {
    const db = client();
    const old = Array.from({ length: 500 }, (_, index) => ({ id: `old-${index}`, original_on: new Date('2026-10-01T00:00:00Z'), effective_on: new Date('2026-10-01T00:00:00Z'), carry_history: [] }));
    const today = { id: 'today', original_on: new Date('2026-10-12T00:00:00Z'), effective_on: new Date('2026-10-12T00:00:00Z'), carry_history: [] };
    db.miDiaPersonalTask.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(old).mockResolvedValueOnce([old[0], today]);
    const result = await new MiDiaNotebookService(db as any).list(actor, { date: '2026-10-12' }, new Date('2026-10-12T18:00:00Z'));
    expect(result.tasks.map((row) => row.id)).toEqual(['today']);
    expect(result.hasMore).toBe(false);
    expect(db.miDiaPersonalTask.findMany).toHaveBeenCalledTimes(3);
  });

  it('arrastra también pendientes posteriores a la primera página de 500', async () => {
    const db = client();
    const overdue = Array.from({ length: 501 }, (_, index) => ({ id: `task-${String(index).padStart(3, '0')}`, effective_on: new Date('2026-10-09T00:00:00Z'), carry_history: [], completed_at: null, canceled_at: null }));
    db.miDiaPersonalTask.findMany.mockResolvedValueOnce(overdue.slice(0, 500)).mockResolvedValueOnce(overdue.slice(500)).mockResolvedValueOnce([]);
    await new MiDiaNotebookService(db as any).list(actor, { date: '2026-10-12' }, new Date('2026-10-12T18:00:00Z'));
    expect(db.miDiaPersonalTask.updateMany).toHaveBeenCalledTimes(501);
  });

  it('no permite cambiar tareas de otro usuario, aunque conozca el id', async () => {
    const db = client();
    await expect(new MiDiaNotebookService(db as any).update(actor, 'other-task', { completed: true }))
      .rejects.toMatchObject({ status: 404, code: 'MIDIA_TASK_NOT_FOUND' });
    expect(db.miDiaPersonalTask.findFirst).toHaveBeenCalledWith({ where: { id: 'other-task', organization_id: actor.organizationId, user_id: actor.id } });
    expect(db.miDiaPersonalTask.update).not.toHaveBeenCalled();
  });

  it('excluye las tareas futuras completadas o canceladas de Próximas', async () => {
    const db = client();
    await new MiDiaNotebookService(db as any).list(actor, { view: 'UPCOMING' }, new Date('2026-10-12T18:00:00Z'));
    expect(db.miDiaPersonalTask.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organization_id: actor.organizationId,
        user_id: actor.id,
        effective_on: { gt: new Date('2026-10-12T00:00:00.000Z') },
        completed_at: null,
        canceled_at: null,
      }),
    }));
  });

  it('proyecta una tarea SYSTEM desde su fuente accesible sin copiarla ni modificarla', async () => {
    const db = client();
    const permitted = { ...actor, scope: 'ASSIGNED_OBJECTS', permissions: ['expedientes.read'] };
    db.tarea.findMany.mockResolvedValueOnce([{ id: 'source-task', titulo: 'Preparar firma',
      estatus: 'PENDIENTE', expediente_id: 'case-1', fecha_limite: new Date('2026-10-12T18:00:00Z'), fecha_completada: null }]);
    const result = await new MiDiaNotebookService(db as any).list(permitted, { date: '2026-10-12' }, new Date('2026-10-12T18:00:00Z'));
    expect(result.systemItems).toEqual([{ id: 'source-task', origin: 'SYSTEM', title: 'Preparar firma',
      status: 'PENDIENTE', dueAt: new Date('2026-10-12T18:00:00Z'), completedAt: null,
      href: '/expedientes/case-1#seguimiento' }]);
    expect(result.systemHasMore).toBe(false);
    expect(db.tarea.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([
      expect.objectContaining({ expediente_id: { not: null } }),
    ]) }) }));
    expect(db.tarea.update).toBeUndefined();
    expect(db.miDiaPersonalTask.create).not.toHaveBeenCalled();
  });

  it('no consulta tareas SYSTEM sin permiso de Expedientes', async () => {
    const db = client();
    const result = await new MiDiaNotebookService(db as any).list({ ...actor, permissions: [] }, {}, new Date('2026-10-12T18:00:00Z'));
    expect(result.systemItems).toEqual([]);
    expect(db.tarea.findMany).not.toHaveBeenCalled();
  });

  it('actualiza una tarea propia y audita dentro de la transacción', async () => {
    const db = client();
    db.miDiaPersonalTask.findFirst.mockResolvedValueOnce({ id: 'task-1', effective_on: new Date('2026-10-12T00:00:00Z'), carry_history: [], completed_at: null });
    db.miDiaPersonalTask.update.mockResolvedValueOnce({ id: 'task-1', title: 'Terminado' });
    await new MiDiaNotebookService(db as any).update(actor, 'task-1', { title: 'Terminado' });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.miDiaPersonalTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1', organization_id: actor.organizationId, user_id: actor.id },
    }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'UPDATE_MI_DIA_TASK' }) }));
  });
});
