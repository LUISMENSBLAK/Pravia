import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from '../../backend/node_modules/pdf-lib/cjs/index.js';
import { PrismaClient } from '../../backend/node_modules/@prisma/client/default.js';

test('Chat: archivos reales, drag/drop, extracción natural, follow-up, alta confirmada y Ver cambios', async ({ page, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:5176');
  const url = new URL(process.env.QA_CLIENT_CASE_DATABASE_URL!);
  expect([url.hostname, url.port, url.pathname]).toEqual(['127.0.0.1','55521','/pravia_client_qa']);
  const db = new PrismaClient({ datasourceUrl: url.href });
  const org = '21110000-0000-4000-8000-000000000001', run = randomUUID().slice(0,8);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const eventsBefore = await db.eventoAgenda.count({ where: { organization_id: org } });
  try {
    await page.goto('/login'); await page.getByLabel('Correo electrónico').fill('documentos.qa@pravia.test');
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.QA_LOCAL_PASSWORD!);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await page.waitForURL('**/mi-dia');
    await page.getByRole('button', { name: 'Abrir PRAVIA IA', exact: true }).click();
    const chat = page.getByRole('dialog', { name: 'PRAVIA IA', exact: true });
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    const sheet = pdf.addPage(); sheet.drawText(`SINTETICO QA ${run} - SIN VALIDEZ JURIDICA\nNombre: ELISA\nApellido paterno: NUEVA\nApellido materno: DOCUMENTAL\nCorreo: elisa.${run}@example.test\nNo se proporciona RFC ni CURP.`, { x: 35, y: 750, font, size: 14, lineHeight: 26 });
    const fixtures = [
      { name: `sintetico-${run}.pdf`, mime: 'application/pdf', buffer: Buffer.from(await pdf.save()), drag: true },
      { name: `sintetico-${run}.png`, mime: 'image/png', buffer: await readFile('/tmp/pravia-client-qa-20261121.amVOGW/fixtures/chat-persona-sintetica.png'), drag: false },
      { name: `sintetico-${run}.jpg`, mime: 'image/jpeg', buffer: await readFile('/tmp/pravia-chat-sintetico-nov25.jpg'), drag: true },
      { name: `sintetico-${run}.heic`, mime: 'image/heic', buffer: await readFile('/tmp/pravia-chat-sintetico-nov25.heic'), drag: false },
    ];
    for (const fixture of fixtures) {
      await chat.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
      const uploaded = page.waitForResponse(response => response.url().endsWith('/attachments') && response.request().method() === 'POST');
      if (fixture.drag) {
        const transfer = await page.evaluateHandle(({ base64, name, mime }) => {
          const data = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
          const transfer = new DataTransfer(); transfer.items.add(new File([data], name, { type: mime })); return transfer;
        }, { base64: fixture.buffer.toString('base64'), name: fixture.name, mime: fixture.mime });
        await chat.dispatchEvent('dragover', { dataTransfer: transfer });
        await expect(chat.getByText('Suelta tus archivos aquí')).toBeVisible();
        await chat.dispatchEvent('drop', { dataTransfer: transfer });
      } else await chat.locator('input[type="file"]').setInputFiles({ name: fixture.name, mimeType: fixture.mime, buffer: fixture.buffer });
      const upload = await uploaded; expect(upload.status()).toBe(201); const attachment = (await upload.json()).data;
      await expect(chat.getByLabel('Adjuntos temporales')).toContainText(fixture.name);
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/assistant/messages') && response.request().method() === 'POST', { timeout: 180000 });
      await chat.getByLabel('Pregúntame algo...').fill('Extrae la información importante'); await chat.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
      await expect(chat.getByLabel('Adjuntos temporales')).toHaveCount(0);
      const response = await responsePromise; expect(response.status()).toBe(200); const result = await response.json();
      expect(result.message).not.toContain('No respondo consultas ajenas'); expect(result.message.toUpperCase()).toContain('ELISA');
      const persisted = await db.assistantAttachment.findUniqueOrThrow({ where: { id: attachment.id } });
      expect(persisted.message_id).toBeTruthy(); expect(persisted.mime_type).toBe(fixture.mime); expect(persisted.size_bytes).toBe(fixture.buffer.length);
      expect(JSON.stringify(persisted.extraction).toUpperCase()).toContain('ELISA');
      if (fixture.mime === 'image/heic') expect(JSON.stringify(persisted.extraction)).toContain('original_preserved');
      const conversation = await db.assistantConversation.findUniqueOrThrow({ where: { id: persisted.conversation_id } });
      expect(conversation.organization_id).toBe(org);
      if (fixture.mime === 'application/pdf') {
        const prepare = page.waitForResponse(response => response.url().endsWith('/assistant/messages') && response.request().method() === 'POST', { timeout: 180000 });
        await chat.getByLabel('Pregúntame algo...').fill('Con esos datos crea un compareciente de persona física. No agregues RFC ni CURP.');
        await chat.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
        expect((await prepare).status()).toBe(200);
        const confirmation = chat.getByRole('button', { name: /Confirmar/ }).last(); await expect(confirmation).toBeVisible();
        const confirmed = page.waitForResponse(response => response.url().endsWith('/confirmations') && response.request().method() === 'POST');
        await confirmation.click(); expect((await confirmed).status()).toBe(200);
        const link = chat.getByRole('link', { name: 'Ver cambios', exact: true }); await expect(link).toBeVisible();
        const href = await link.getAttribute('href'); expect(href).toMatch(/^\/comparecientes\//);
        const party = await db.compareciente.findUniqueOrThrow({ where: { id: href!.split('/').pop()! }, include: { personaFisica: true } });
        expect(party.organization_id).toBe(org); expect(party.personaFisica?.nombre).toBe('ELISA'); expect(party.personaFisica?.rfc).toBeNull(); expect(party.personaFisica?.curp).toBeNull();
        await link.click(); await page.waitForURL('**/comparecientes/*');
        await expect(chat.getByLabel('Adjuntos temporales')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: /ELISA NUEVA DOCUMENTAL/ })).toBeVisible();
        const editReply = page.waitForResponse(response => response.url().endsWith('/assistant/messages') && response.request().method() === 'POST', { timeout: 180000 });
        await chat.getByLabel('Pregúntame algo...').fill('Cambia la ocupación de este compareciente a ARQUITECTA QA');
        await chat.getByRole('button', { name: 'Enviar mensaje', exact: true }).click(); expect((await editReply).status()).toBe(200);
        const editConfirm = page.waitForResponse(response => response.url().endsWith('/confirmations') && response.request().method() === 'POST');
        await chat.getByRole('button', { name: /Confirmar/ }).last().click(); expect((await editConfirm).status()).toBe(200);
        expect((await db.personaFisica.findUniqueOrThrow({ where: { compareciente_id: party.id } })).ocupacion).toBe('ARQUITECTA QA');
        const undoReply = page.waitForResponse(response => response.url().endsWith('/assistant/messages') && response.request().method() === 'POST');
        await chat.getByLabel('Pregúntame algo...').fill('Deshaz ese cambio'); await chat.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
        expect((await undoReply).status()).toBe(200);
        const undoConfirm = page.waitForResponse(response => response.url().endsWith('/confirmations') && response.request().method() === 'POST');
        await chat.getByRole('button', { name: /Confirmar/ }).last().click(); expect((await undoConfirm).status()).toBe(200);
        expect((await db.personaFisica.findUniqueOrThrow({ where: { compareciente_id: party.id } })).ocupacion).toBe(party.personaFisica!.ocupacion);
        expect(await db.auditLog.count({ where: { organization_id: org, entidad_id: party.id, accion: 'AI_ACTION_COMPLETED' } })).toBeGreaterThanOrEqual(3);
      }
      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    expect(await db.eventoAgenda.count({ where: { organization_id: org } })).toBe(eventsBefore);
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});
