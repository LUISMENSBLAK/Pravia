import 'dotenv/config';
import prisma from '../src/config/prisma';
import { classifyLegacyPayment } from '../src/domain/legacyFinanceMigration';

const rawUrl = String(process.env.DATABASE_URL || '').trim();
const actorId = String(process.env.PHASE15B_FINANCE_ACTOR_USER_ID || '').trim();
const parsed = new URL(rawUrl);

if (process.env.PRAVIA_ENV !== 'staging'
  || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55434'
  || parsed.pathname !== '/pravia_staging_future'
  || parsed.searchParams.get('schema') !== 'pravia_os') {
  throw new Error('REFUSED_PRODUCTION_WRITE: el backfill solo admite pravia_staging_future local de Fase 15B.');
}
if (!actorId) throw new Error('PHASE15B_FINANCE_ACTOR_USER_ID es obligatorio.');

async function main() {
  const actor = await prisma.user.findFirst({
    where: { id: actorId, activo: true, rol: { in: ['DIRECCION', 'ADMINISTRACION'] } },
    select: { id: true },
  });
  if (!actor) throw new Error('El actor debe ser una cuenta sintética activa de Dirección o Administración.');

  const [payments, before] = await Promise.all([
    prisma.pago.findMany({ orderBy: { fecha_registro: 'asc' } }),
    prisma.movimientoFinanciero.findMany({ orderBy: { fecha_movimiento: 'asc' } }),
  ]);
  const decisions = payments.map((payment) => ({
    payment,
    decision: classifyLegacyPayment(
      { ...payment, monto: Number(payment.monto) },
      before.map((movement) => ({ ...movement, monto: Number(movement.monto) })),
    ),
  }));
  const safe = decisions.filter((item) => item.decision.classification === 'MIGRACION_SEGURA' && item.decision.proposal);
  const created: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const item of safe) {
      const proposal = item.decision.proposal!;
      const existing = await tx.movimientoFinanciero.findUnique({ where: { idempotency_key: proposal.referencia } });
      if (existing) continue;
      const movement = await tx.movimientoFinanciero.create({ data: {
        ...proposal,
        idempotency_key: proposal.referencia,
        estatus: 'VALIDADO',
        capturado_por_id: actor.id,
        validado_por_id: actor.id,
        fecha_validacion: new Date(),
      } });
      created.push(movement.id);
    }
  });

  const after = await prisma.movimientoFinanciero.findMany({ orderBy: { fecha_movimiento: 'asc' } });
  const represented = payments.filter((payment) => after.some((movement) => movement.idempotency_key === `legacy:pago:${payment.id}`));
  const total = (values: Array<{ monto: unknown }>) => values.reduce((sum, row) => sum + Number(row.monto), 0);
  console.log(JSON.stringify({
    ok: true,
    target: 'local-isolated/pravia_staging_future',
    legacy: { count: payments.length, total: total(payments) },
    classifications: Object.fromEntries([...new Set(decisions.map((item) => item.decision.classification))]
      .map((classification) => [classification, decisions.filter((item) => item.decision.classification === classification).length])),
    before: { movements: before.length, total: total(before) },
    run: { safe: safe.length, created: created.length, created_ids: created },
    after: { movements: after.length, total: total(after), represented_legacy: represented.length },
  }, null, 2));
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
