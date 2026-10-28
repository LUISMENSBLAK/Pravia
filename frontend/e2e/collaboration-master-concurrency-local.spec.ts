import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

const orgId = '7577aa7b-8149-4ba4-a07d-adca779a1d03';
const partyId = '7475c24d-888a-47f3-8b35-6517d1a44a14';
const users = [
  { email: 'alejandro.abarca@pravia.test', password: process.env.PRAVIA_E2E_ALEJANDRO_PASSWORD || '' },
  { email: 'javier.tapia@pravia.test', password: process.env.PRAVIA_E2E_JAVIER_PASSWORD || '' },
];

test('COL68/COL69 · ediciones simultáneas de maestros producen exactamente un éxito y un conflicto', async ({ request }, testInfo) => {
  const base = new URL(String(testInfo.project.use.baseURL));
  const dbUrl = process.env.PRAVIA_E2E_LOCAL_DATABASE_URL || '';
  if (base.hostname !== '127.0.0.1' || base.port !== '5176'
    || dbUrl !== 'postgresql://postgres@127.0.0.1:55439/postgres?schema=pravia_os'
    || users.some((user) => !user.password)) throw new Error('COLLAB_MASTER_CONCURRENCY_LOCAL_SAFETY_GATE_FAILED');
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const responses = await Promise.all(users.map((user) => request.post('/api/auth/login', { data: user })));
  responses.forEach((response) => expect(response.status()).toBe(200));
  const [alejandro, javier] = await Promise.all(responses.map((response) => response.json()));
  const headers = (auth: any) => ({ Authorization: `Bearer ${auth.access_token}` });
  expect(alejandro.user.organization.id).toBe(orgId);
  expect(javier.user.organization.id).toBe(orgId);
  let predioId = '';
  const partyBefore = await db.compareciente.findUniqueOrThrow({ where: { id: partyId } });
  try {
    const marker = randomUUID().slice(0, 8).toUpperCase();
    const partyWrites = await Promise.all([
      request.patch(`/api/comparecientes/${partyId}`, { headers: headers(alejandro), data: {
        observaciones: `COL CONCURRENCIA A ${marker}`, expectedVersion: partyBefore.version,
      } }),
      request.patch(`/api/comparecientes/${partyId}`, { headers: headers(javier), data: {
        observaciones: `COL CONCURRENCIA B ${marker}`, expectedVersion: partyBefore.version,
      } }),
    ]);
    expect(partyWrites.map((response) => response.status()).sort()).toEqual([200, 409]);
    const partyAfter = await db.compareciente.findUniqueOrThrow({ where: { id: partyId } });
    expect(partyAfter.version).toBe(partyBefore.version + 1);
    expect([`COL CONCURRENCIA A ${marker}`, `COL CONCURRENCIA B ${marker}`]).toContain(partyAfter.observaciones);
    const conflict = partyWrites.find((response) => response.status() === 409)!;
    expect((await conflict.json()).code).toBe('COMPARECIENTE_VERSION_CONFLICT');

    const created = await request.post('/api/predios', { headers: headers(javier), data: {
      apodo: `PREDIO COL CONCURRENCIA ${marker}`, ubicacion_texto: `Ubicación sintética ${marker}`,
    } });
    expect(created.status(), await created.text()).toBe(201);
    const predio = (await created.json()).data;
    predioId = predio.id;
    expect(predio.organization_id).toBe(orgId);
    const propertyWrites = await Promise.all([
      request.patch(`/api/predios/${predioId}`, { headers: headers(alejandro), data: {
        apodo: `PREDIO A ${marker}`, ubicacion_texto: `Ubicación sintética ${marker}`, expected_version: predio.version,
      } }),
      request.patch(`/api/predios/${predioId}`, { headers: headers(javier), data: {
        apodo: `PREDIO B ${marker}`, ubicacion_texto: `Ubicación sintética ${marker}`, expected_version: predio.version,
      } }),
    ]);
    expect(propertyWrites.map((response) => response.status()).sort()).toEqual([200, 409]);
    const propertyAfter = await db.predio.findUniqueOrThrow({ where: { id: predioId } });
    expect(propertyAfter.version).toBe(predio.version + 1);
    expect([`PREDIO A ${marker}`, `PREDIO B ${marker}`]).toContain(propertyAfter.apodo);
    expect((await propertyWrites.find((response) => response.status() === 409)!.json()).code).toBe('PREDIO_VERSION_STALE');
  } finally {
    const current = await db.compareciente.findUniqueOrThrow({ where: { id: partyId } });
    if (current.observaciones !== partyBefore.observaciones) {
      const restored = await request.patch(`/api/comparecientes/${partyId}`, { headers: headers(alejandro), data: {
        observaciones: partyBefore.observaciones, expectedVersion: current.version,
      } });
      expect(restored.status(), await restored.text()).toBe(200);
    }
    if (predioId) {
      await db.auditLog.deleteMany({ where: { entidad_id: predioId } });
      await db.predio.delete({ where: { id: predioId } });
    }
    await db.$disconnect();
  }
});
