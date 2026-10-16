import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { MiDiaNotebookService } from '../services/miDiaNotebook.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día notebook integration requires isolated local PostgreSQL.');
}
const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día notebook · physical PostgreSQL', () => {
  it('arrastra sólo al dueño, conserva historia y revierte todo el fixture', async () => {
    const org = randomUUID();
    const foreignOrg = randomUUID();
    const owner = randomUUID();
    const peer = randomUUID();
    const foreign = randomUUID();
    const ownCase = randomUUID();
    const peerCase = randomUUID();
    const foreignCase = randomUUID();
    const actor = { id: owner, organizationId: org, rol: 'ABOGADO', scope: 'ASSIGNED_OBJECTS', permissions: ['expedientes.read'] } as Actor;
    const peerActor = { ...actor, id: peer } as Actor;
    const foreignActor = { ...actor, id: foreign, organizationId: foreignOrg } as Actor;
    const monday = new Date('2026-10-12T18:00:00.000Z');
    const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
    const rollback = new Error('MIDIA_NOTEBOOK_ROLLBACK');
    let generatedTaskId = '';

    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [
          { id: org, name: 'Notebook local QA' },
          { id: foreignOrg, name: 'Notebook foreign QA' },
        ] });
        await tx.user.createMany({ data: [owner, peer, foreign].map((id) => ({ id,
          nombre: 'Notebook', apellido: 'QA', email: `notebook-${id}@example.test`,
          password_hash: 'synthetic-only', rol: 'ABOGADO' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: org, user_id: owner, rol: 'ABOGADO' },
          { organization_id: org, user_id: peer, rol: 'ABOGADO' },
          { organization_id: foreignOrg, user_id: foreign, rol: 'ABOGADO' },
        ] });
        await tx.expediente.createMany({ data: [
          { id: ownCase, organization_id: org, numero_pravia: `EXP-QA-${ownCase}`, abogado_id: owner, creador_id: owner },
          { id: peerCase, organization_id: org, numero_pravia: `EXP-QA-${peerCase}`, abogado_id: peer, creador_id: peer },
          { id: foreignCase, organization_id: foreignOrg, numero_pravia: `EXP-QA-${foreignCase}`, abogado_id: foreign, creador_id: foreign },
        ] });
        await tx.tarea.createMany({ data: [
          { organization_id: org, expediente_id: ownCase, asignado_a_id: owner, creador_id: owner,
            titulo: 'Fuente propia', fecha_limite: new Date('2026-10-12T18:00:00.000Z') },
          { organization_id: org, expediente_id: peerCase, asignado_a_id: owner, creador_id: peer,
            titulo: 'Expediente inaccesible', fecha_limite: new Date('2026-10-12T18:00:00.000Z') },
          { organization_id: foreignOrg, expediente_id: foreignCase, asignado_a_id: foreign, creador_id: foreign,
            titulo: 'Fuente de otro tenant', fecha_limite: new Date('2026-10-12T18:00:00.000Z') },
        ] });
        await tx.miDiaPersonalTask.createMany({ data: [
          { organization_id: org, user_id: owner, title: 'Viernes pendiente',
            original_on: day('2026-10-09'), effective_on: day('2026-10-09'), carry_history: [] },
          { organization_id: org, user_id: peer, title: 'Tarea del colega',
            original_on: day('2026-10-12'), effective_on: day('2026-10-12'), carry_history: [] },
          { organization_id: foreignOrg, user_id: foreign, title: 'Tarea ajena',
            original_on: day('2026-10-12'), effective_on: day('2026-10-12'), carry_history: [] },
        ] });

        const scopedDb = {
          userPreference: tx.userPreference, notaria: tx.notaria,
          miDiaPersonalTask: tx.miDiaPersonalTask, tarea: tx.tarea, auditLog: tx.auditLog,
          $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
        } as unknown as PrismaClient;
        const service = new MiDiaNotebookService(scopedDb);
        const created = await service.create(actor, { title: 'Tarea futura', date: '2026-10-16' }, monday);
        generatedTaskId = created.id;
        expect(created.original_on).toEqual(day('2026-10-16'));
        const mondayView = await service.list(actor, { date: '2026-10-12' }, monday);
        expect(mondayView.tasks.map((task) => task.title)).toEqual(['Viernes pendiente']);
        expect(mondayView.systemItems.map((task) => [task.title, task.href])).toEqual([
          ['Fuente propia', `/expedientes/${ownCase}#seguimiento`],
        ]);
        expect(mondayView.tasks[0].original_on).toEqual(day('2026-10-09'));
        expect(mondayView.tasks[0].effective_on).toEqual(day('2026-10-12'));
        expect(mondayView.tasks[0].carry_history).toEqual([{ from: '2026-10-09', to: '2026-10-12' }]);
        expect(await tx.auditLog.count({ where: { organization_id: org, entidad_id: mondayView.tasks[0].id,
          accion: 'CARRY_MI_DIA_TASK' } })).toBe(1);
        expect((await service.list(actor, { view: 'UPCOMING' }, monday)).tasks.map((task) => task.id)).toContain(created.id);
        expect((await service.list(peerActor, { date: '2026-10-12' }, monday)).tasks.map((task) => task.title)).toEqual(['Tarea del colega']);
        expect((await service.list(foreignActor, { date: '2026-10-12' }, monday)).tasks.map((task) => task.title)).toEqual(['Tarea ajena']);
        await expect(service.update(peerActor, created.id, { completed: true })).rejects.toMatchObject({ status: 404 });
        await expect(service.update(foreignActor, created.id, { completed: true })).rejects.toMatchObject({ status: 404 });
        const done = await service.update(actor, created.id, { completed: true });
        expect(done.completed_at).toBeInstanceOf(Date);
        expect((await service.list(actor, { view: 'UPCOMING' }, monday)).tasks.map((task) => task.id)).not.toContain(created.id);
        expect((await service.list(actor, { view: 'HISTORY' }, monday)).tasks.map((task) => task.id)).toContain(created.id);
        expect(await tx.auditLog.count({ where: { organization_id: org, entidad_id: created.id } })).toBe(2);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(await db.miDiaPersonalTask.count({ where: { id: generatedTaskId } })).toBe(0);
  });
});
