import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { FacturamaSandboxProvider, type FacturamaPayload } from '../src/services/facturamaSandboxProvider';
import { parseCfdi40Xml } from '../src/services/financeFiscal.service';

/** Opt-in transport certification with PUBLIC provider test identities only.
 * No production URL, customer data, DB writes or CSD secrets in this harness. */
async function main() {
  assert.equal(process.env.QA_FACTURAMA_SANDBOX, 'true');
  assert.equal(new URL(process.env.DATABASE_URL || '').hostname, '127.0.0.1');
  assert.equal(new URL(process.env.DATABASE_URL || '').port, '55521');
  const username = process.env.FACTURAMA_SANDBOX_USERNAME || '', password = process.env.FACTURAMA_SANDBOX_PASSWORD || '';
  assert.ok(username && password, 'Configure sandbox credentials in the process environment, never Git.');
  const root = '/tmp/pravia-client-qa-20261121.amVOGW';
  const manifest = `${root}/facturama-sandbox-run.json`;
  let previous: any;
  try { previous = JSON.parse(await readFile(manifest, 'utf8')); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.status === 'REJECTED_NO_DOCUMENT' && process.env.QA_CORRECT_REJECTED_DATE === 'true') {
    // A confirmed rejection/absence is not an uncertain successful stamp. Keep
    // that failed request verbatim before starting a corrected QA operation.
    await writeFile(`${root}/facturama-rejected-${previous.payload.Folio}.json`, JSON.stringify(previous, null, 2), { flag: 'wx' });
    previous = null;
  }
  if (previous?.status === 'STARTED' && process.env.QA_RECONCILE === 'true') {
    const query = new URL('https://apisandbox.facturama.mx/cfdi'); query.search = new URLSearchParams({ type: 'issuedLite', page: '0', folio: previous.payload.Folio }).toString();
    const response = await fetch(query, { redirect: 'error', headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }, signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `Read-only reconciliation failed: ${response.status}`); const rows: any = await response.json();
    assert.ok(Array.isArray(rows), 'Do not infer absence from an unknown provider response.');
    console.log(JSON.stringify({ read_only_reconciliation: 'PASS', matching_folio_documents: rows.length, production_writes: 'NONE' }));
    assert.equal(rows.length, 0, 'Existing provider document must be recovered, never blindly retried.');
    if (process.env.QA_CONFIRMED_HTTP400 === 'true') { previous.status = 'REJECTED_NO_DOCUMENT'; await writeFile(manifest, JSON.stringify(previous, null, 2)); }
    return;
  }
  if (previous?.status === 'STARTED') throw new Error('An earlier outcome is unknown. Reconcile the saved Folio/Date before any new POST.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const localIssueDate = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const p: FacturamaPayload = previous?.payload || {
    Folio: `PRAVIA-QA-${Date.now()}`, Date: localIssueDate, Serie: 'QA',
    CfdiType: 'I', Currency: 'MXN', PaymentForm: '99', PaymentMethod: 'PPD', ExpeditionPlace: '42501', Exportation: '01',
    Observations: 'PRAVIA - PRUEBA DE INTEGRACION SANDBOX - SIN VALIDEZ FISCAL',
    Issuer: { Rfc: 'EKU9003173C9', Name: 'ESCUELA KEMPER URGATE', FiscalRegime: '601' },
    Receiver: { Rfc: 'URE180429TM6', Name: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', FiscalRegime: '601', TaxZipCode: '86991', CfdiUse: 'G03' },
    Items: [{ ProductCode: '80121601', Description: 'Servicio de prueba de integracion PRAVIA sandbox, sin validez fiscal', UnitCode: 'E48', Quantity: 1, UnitPrice: 100, Subtotal: 100, TaxObject: '02', Total: 116, Taxes: [{ Name: 'IVA', Base: 100, Rate: 0.16, Total: 16, IsRetention: false }] }],
  };
  if (!previous) await writeFile(manifest, JSON.stringify({ status: 'STARTED', payload: p, public_provider_test_identities_only: true }, null, 2));
  if (previous?.status === 'COMPLETED' && process.env.QA_VERIFY_ONLY === 'true') {
    const xml = await readFile(`${root}/facturama-sandbox.xml`), pdf = await readFile(`${root}/facturama-sandbox.pdf`);
    assert.equal(createHash('sha256').update(xml).digest('hex'), previous.xml_sha256); assert.equal(createHash('sha256').update(pdf).digest('hex'), previous.pdf_sha256);
    const parsed = parseCfdi40Xml(xml); assert.equal(parsed.uuid, previous.uuid); assert.equal(parsed.total.toFixed(2), '116.00');
    console.log(JSON.stringify({ sandbox_xml_pdf_reopen: 'PASS', production_writes: 'NONE', integrated_application_stamp: 'NOT_YET_VERIFIED' })); return;
  }
  assert.ok(!previous || (['COMPLETED', 'REJECTED_NO_DOCUMENT'].includes(previous.status) && process.env.QA_RETRY_SAME_OPERATION === 'true'), 'Use verify-only or explicit same-operation idempotency test.');
  const provider = new FacturamaSandboxProvider({ username, password });
  const result = await provider.stamp({ version: '4.0', tipo: 'I', emisorRfc: p.Issuer.Rfc, receptorRfc: p.Receiver.Rfc, metodoPago: p.PaymentMethod, total: '116.00', facturamaPayload: p });
  assert.ok(result.pdf); if (previous?.status === 'COMPLETED') { assert.equal(result.uuid, previous.uuid, 'Provider retry must return the same stamp.'); assert.equal(result.providerReference, previous.provider_reference); }
  await writeFile(`${root}/facturama-sandbox.xml`, result.xml); await writeFile(`${root}/facturama-sandbox.pdf`, result.pdf);
  const { PDFDocument } = await import('pdf-lib'); const pdf = await PDFDocument.load(result.pdf); assert.ok(pdf.getPageCount() > 0);
  const data = { status: 'COMPLETED', payload: p, uuid: result.uuid, provider_reference: result.providerReference, xml_sha256: createHash('sha256').update(result.xml).digest('hex'), pdf_sha256: createHash('sha256').update(result.pdf).digest('hex'), pdf_pages: pdf.getPageCount(), idempotent_retry: Boolean(previous), environment: 'SANDBOX_NO_FISCAL_VALIDITY', production_writes: 'NONE' };
  await writeFile(manifest, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ sandbox_actual_xml_pdf: 'PASS', uuid_from_provider: true, pdf_pages: data.pdf_pages, idempotent_retry: data.idempotent_retry, production_writes: 'NONE', integrated_application_stamp: 'NOT_YET_VERIFIED' }));
}
main().catch((error) => { console.error(JSON.stringify({ sandbox_validation: 'FAIL', code: error.code || error.name, message: error.message, provider_reference: error.providerReference || null, validation_fields: error.validationFields || [] })); process.exitCode = 1; });
