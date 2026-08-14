import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../src/config/prisma';
import { reportFinancialTotals } from '../src/domain/reportingCore';
import type { CanonicalMovement, EconomicNature } from '../src/domain/financeCore';

const base = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
if (process.env.E2E_ALLOW_MUTATIONS !== 'isolated-database-confirmed' || !['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname)) {
  throw new Error('Reports E2E solo se permite contra localhost aislado.');
}
const suffix = randomUUID().slice(0, 8);
const email = `e2e-reports-${suffix}@example.invalid`;
const password = `Pravia!Reports-${suffix}-Q7`;

async function main() {
  await prisma.user.create({ data: { email, password_hash: await bcrypt.hash(password, 12), nombre: 'E2E Reportes', apellido: suffix, rol: 'DIRECCION', activo: true, requires_password_change: false, password_changed_at: new Date() } });
  const loginResponse = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const login: any = await loginResponse.json();
  if (loginResponse.status !== 200 || !login.access_token) throw new Error('Login de reportes falló.');
  const request = async (path: string) => {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${login.access_token}` } });
    const body: any = await response.json();
    if (response.status !== 200) throw new Error(`${path}: ${response.status} ${body.error || ''}`);
    return body.data;
  };

  const now = new Date();
  const from = new Date(now.getFullYear(), 0, 1);
  const to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  const [fees, movements, report, collections] = await Promise.all([
    prisma.honorarioGenerado.findMany({ where: { estado: { not: 'CANCELADO' }, fecha_reconocimiento: { gte: from, lte: to } }, select: { monto: true } }),
    prisma.movimientoFinanciero.findMany({ where: { estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] }, fecha_movimiento: { gte: from, lte: to } }, select: { naturaleza: true, monto: true, estatus: true, distribuciones: { select: { monto: true, categoria: { select: { naturaleza: true } } } } } }),
    request('/reportes/finanzas?periodo=ESTE_ANO'),
    request('/reportes/cobranza?periodo=ESTE_ANO'),
  ]);
  const canonical = reportFinancialTotals(
    fees.map((row) => Number(row.monto)),
    movements.map((row): CanonicalMovement => ({ nature: row.naturaleza, amount: Number(row.monto), status: row.estatus, allocations: row.distribuciones.map((item) => ({ nature: item.categoria.naturaleza as EconomicNature, amount: Number(item.monto) })) })),
  );
  const keys = ['honorarios_generados', 'honorarios_cobrados', 'honorarios_por_cobrar', 'egresos', 'fondos_terceros', 'fondos_terceros_pendientes', 'ingresos_recibidos'] as const;
  for (const key of keys) if (Number(report.financial?.[key]) !== Number(canonical[key])) throw new Error(`Descuadre ${key}: API=${report.financial?.[key]} SQL/domain=${canonical[key]}`);
  if (canonical.honorarios_generados !== canonical.honorarios_cobrados + canonical.honorarios_por_cobrar) throw new Error('Generado no reconcilia con cobrado + por cobrar.');
  if (canonical.ingresos_recibidos !== canonical.honorarios_cobrados + canonical.fondos_terceros + canonical.otros_destinos) throw new Error('Ingresos no reconcilian por destino.');
  const rowTotals = (collections.rows || []).reduce((acc: any, row: any) => ({ generated: acc.generated + Number(row.generated), collected: acc.collected + Number(row.collected), pending: acc.pending + Number(row.pending) }), { generated: 0, collected: 0, pending: 0 });
  for (const key of ['generated', 'collected', 'pending'] as const) if (rowTotals[key] !== Number(collections.totals[key])) throw new Error(`Cartera ${key} no reconcilia con sus filas.`);
  console.log(JSON.stringify({ ok: true, environment: 'local-staging-s2', period: 'ESTE_ANO', reconciled: keys, canonical, collections: collections.totals }, null, 2));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
