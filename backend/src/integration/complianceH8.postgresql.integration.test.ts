import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ComplianceH8Service, parseH8PanelQuery } from '../services/complianceH8.service';

function isolatedTarget() {
  const raw = process.env.DATABASE_URL || '';
  const url = new URL(raw);
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.H8_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_H8_POSTGRESQL'
    || raw !== process.env.DIRECT_URL
    || url.hostname !== '127.0.0.1'
    || url.port !== '55468'
    || url.pathname !== '/pravia_h8_read_model'
  ) throw new Error('H8 PostgreSQL requires the explicit isolated local read-model target.');
  return raw;
}

const target = isolatedTarget();
const db = new PrismaClient({ datasources: { db: { url: target } } });

describe('H8 PostgreSQL read model', () => {
  afterAll(async () => db.$disconnect());

  it('executes the physical aggregate and returns only the actor tenant/object scope', async () => {
    const ids = {
      organization: randomUUID(), otherOrganization: randomUUID(),
      actor: randomUUID(), colleague: randomUUID(), outsider: randomUUID(),
      actorMembership: randomUUID(), colleagueMembership: randomUUID(), outsiderMembership: randomUUID(),
      visibleCase: randomUUID(), inaccessibleCase: randomUUID(), crossTenantCase: randomUUID(),
      visibleReview: randomUUID(), inaccessibleReview: randomUUID(), crossTenantReview: randomUUID(),
      visibleState: randomUUID(), inaccessibleState: randomUUID(), crossTenantState: randomUUID(),
    };
    await db.$transaction([
      db.$executeRawUnsafe(`INSERT INTO pravia_os.organizations (id,name,updated_at) VALUES ('${ids.organization}','H8 local tenant',now()),('${ids.otherOrganization}','H8 other tenant',now())`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.users (id,email,password_hash,nombre,apellido,updated_at) VALUES
        ('${ids.actor}','${ids.actor}@example.invalid','synthetic','Ana','Actora',now()),
        ('${ids.colleague}','${ids.colleague}@example.invalid','synthetic','Colega','Local',now()),
        ('${ids.outsider}','${ids.outsider}@example.invalid','synthetic','Otra','Persona',now())`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.organization_memberships (id,organization_id,user_id,rol,updated_at) VALUES
        ('${ids.actorMembership}','${ids.organization}','${ids.actor}','ABOGADO',now()),
        ('${ids.colleagueMembership}','${ids.organization}','${ids.colleague}','ABOGADO',now()),
        ('${ids.outsiderMembership}','${ids.otherOrganization}','${ids.outsider}','ABOGADO',now())`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.expedientes (id,organization_id,numero_pravia,abogado_id,creador_id,estatus) VALUES
        ('${ids.visibleCase}','${ids.organization}','EXP-H8-VISIBLE-${ids.visibleCase.slice(0, 8)}','${ids.actor}','${ids.actor}','ENTREGADO'),
        ('${ids.inaccessibleCase}','${ids.organization}','EXP-H8-HIDDEN-${ids.inaccessibleCase.slice(0, 8)}','${ids.colleague}','${ids.colleague}','EN_PROCESO'),
        ('${ids.crossTenantCase}','${ids.otherOrganization}','EXP-H8-CROSS-${ids.crossTenantCase.slice(0, 8)}','${ids.outsider}','${ids.outsider}','EN_PROCESO')`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.compliance_reviews (id,organization_id,expediente_id,tipo,rule_version_snapshot,cuestionario_json,creado_por_id,rule_snapshot,master_snapshot) VALUES
        ('${ids.visibleReview}','${ids.organization}','${ids.visibleCase}','H8_SYNTHETIC','h8','{}','${ids.actor}','{}','{}'),
        ('${ids.inaccessibleReview}','${ids.organization}','${ids.inaccessibleCase}','H8_SYNTHETIC','h8','{}','${ids.colleague}','{}','{}'),
        ('${ids.crossTenantReview}','${ids.otherOrganization}','${ids.crossTenantCase}','H8_SYNTHETIC','h8','{}','${ids.outsider}','{}','{}')`),
      db.$executeRawUnsafe(`INSERT INTO pravia_os.expediente_compliance_states (id,organization_id,expediente_id,current_review_id,state,pending_count,updated_by_id) VALUES
        ('${ids.visibleState}','${ids.organization}','${ids.visibleCase}','${ids.visibleReview}','PENDIENTE',2,'${ids.actor}'),
        ('${ids.inaccessibleState}','${ids.organization}','${ids.inaccessibleCase}','${ids.inaccessibleReview}','PENDIENTE',1,'${ids.colleague}'),
        ('${ids.crossTenantState}','${ids.otherOrganization}','${ids.crossTenantCase}','${ids.crossTenantReview}','VENCIDO',4,'${ids.outsider}')`),
    ]);

    const actor: any = { id: ids.actor, organizationId: ids.organization, rol: 'ABOGADO', permissions: ['compliance.read'] };
    const result = await new ComplianceH8Service(db).panel(actor, parseH8PanelQuery({}), new Date('2026-09-05T18:00:00.000Z'));
    expect(result.meta.total).toBe(1);
    expect(result.metrics).toEqual({ pendientes: 1, avisos_pendientes: 0, por_vencer: 0, vencidos: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ expediente_id: ids.visibleCase, operational_status: 'ENTREGADO', vulnerable: false });
  });
});
