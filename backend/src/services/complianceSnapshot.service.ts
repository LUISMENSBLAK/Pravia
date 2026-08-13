import { Prisma } from '@prisma/client';

const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

export function snapshotRule(rule: any): Prisma.InputJsonObject {
  return {
    id: rule.id,
    tipo: rule.tipo,
    clave: rule.clave,
    version: rule.version,
    nombre: rule.nombre,
    estatus: rule.estatus,
    vigencia_desde: iso(rule.vigencia_desde),
    vigencia_hasta: iso(rule.vigencia_hasta),
    fuente_nombre: rule.fuente_nombre,
    fuente_url: rule.fuente_url,
    fuente_publicada_at: iso(rule.fuente_publicada_at),
    parametros: rule.parametros,
    cuestionario: rule.cuestionario,
    notas: rule.notas || null,
  } as Prisma.InputJsonObject;
}

export async function captureMasterSnapshot(db: any, expedienteId: string) {
  const expediente = await db.expediente.findUnique({
    where: { id: expedienteId },
    include: {
      tipo_acto: { select: { id: true, nombre: true } },
      notaria: { select: { id: true, numero_notaria: true, nombre: true } },
      abogado: { select: { id: true, nombre: true, apellido: true } },
      comparecientes: {
        where: { archived_at: null, estatus: 'ACTIVO' },
        include: {
          caracter: { select: { clave: true, nombre: true } },
          compareciente: {
            include: {
              personaFisica: true,
              personaMoral: true,
              domicilios: { where: { archived_at: null, vigente: true }, orderBy: [{ principal: 'desc' }, { updated_at: 'desc' }], take: 2 },
              contactos: { where: { archived_at: null, activo: true }, orderBy: [{ principal: 'desc' }, { updated_at: 'desc' }], take: 3 },
              identificaciones: { where: { archived_at: null }, orderBy: [{ principal: 'desc' }, { updated_at: 'desc' }], take: 3 },
              datosFuente: { where: { archived_at: null, estado: 'CONFIRMADO' }, orderBy: { updated_at: 'desc' }, take: 40, select: { campo: true, valor_confirmado: true, documento_id: true, pagina: true, fragmento_fuente: true, confirmado_at: true, updated_at: true } },
            },
          },
        },
        orderBy: { orden_comparecencia: 'asc' },
      },
    },
  });
  if (!expediente) return null;

  const parties = expediente.comparecientes.map((link: any) => {
    const party = link.compareciente;
    const profile = party.tipo_persona === 'FISICA' ? party.personaFisica : party.personaMoral;
    return {
      id: party.id,
      version: party.version,
      tipo_persona: party.tipo_persona,
      nombre: party.personaFisica?.nombre_completo_calculado || party.personaMoral?.razon_social || party.nombre_busqueda,
      rfc: profile?.rfc || null,
      curp: party.personaFisica?.curp || null,
      pep_estado: party.personaFisica?.pep_estado || 'NO_APLICA',
      relacion_pep: party.personaFisica?.relacion_pep || null,
      ocupacion: party.personaFisica?.ocupacion || null,
      actividad_economica: party.personaFisica?.actividad_economica || null,
      caracter: link.caracter,
      forma_comparecencia: link.forma_comparecencia,
      datos_validados: link.datos_validados,
      validado_at: iso(link.validado_at),
      domicilios: party.domicilios.map((item: any) => ({ ...item, created_at: iso(item.created_at), updated_at: iso(item.updated_at), fecha_inicio: iso(item.fecha_inicio), fecha_terminacion: iso(item.fecha_terminacion) })),
      contactos: party.contactos.map((item: any) => ({ tipo: item.tipo, valor: item.valor, principal: item.principal, validado: item.validado, fecha_validacion: iso(item.fecha_validacion), updated_at: iso(item.updated_at) })),
      identificaciones: party.identificaciones.map((item: any) => ({ tipo: item.tipo_identificacion, estatus: item.estatus, principal: item.principal, documento_id: item.documento_id, validado_at: iso(item.validado_at), updated_at: iso(item.updated_at) })),
      procedencia: party.datosFuente.map((item: any) => ({ ...item, confirmado_at: iso(item.confirmado_at), updated_at: iso(item.updated_at) })),
      master_updated_at: iso(party.updated_at),
    };
  });
  return {
    captured_at: new Date().toISOString(),
    expediente: {
      id: expediente.id,
      version: expediente.version,
      numero_pravia: expediente.numero_pravia,
      acto: expediente.tipo_acto,
      valor_operacion_mxn: expediente.valor_operacion == null ? null : Number(expediente.valor_operacion),
      datos_operacion: expediente.datos_operacion,
      notaria: expediente.notaria,
      responsable: expediente.abogado,
      updated_at: iso(expediente.updated_at),
    },
    comparecientes: parties,
    limitations: {
      beneficiario_controlador_master: false,
      origen_fondos_master: false,
      pep_screening_externo: false,
    },
  } as Prisma.InputJsonObject;
}

export function prefillFromSnapshot(type: string, snapshot: any) {
  const parties = Array.isArray(snapshot?.comparecientes) ? snapshot.comparecientes : [];
  const pepValues = parties.map((item: any) => item.pep_estado).filter((value: string) => value && value !== 'NO_APLICA');
  const pep = pepValues.includes('SI') ? 'SI' : pepValues.length && pepValues.every((value: string) => value === 'NO') ? 'NO' : 'PENDIENTE';
  const identityKnown = parties.length > 0 && parties.every((party: any) => party.datos_validados || party.identificaciones?.some((id: any) => id.estatus === 'VIGENTE' && id.validado_at));
  const first = parties[0];
  if (type === 'ISR') return { enajenante_rfc_curp: first?.rfc || first?.curp || '' };
  return {
    identidad_verificada: identityKnown || undefined,
    pep_declarada: pep,
    precio_pactado: snapshot?.expediente?.valor_operacion_mxn ?? undefined,
  };
}

export async function masterChangedSince(db: any, snapshot: any) {
  if (!snapshot?.expediente?.id || snapshot.legacy_backfill) return false;
  const current = await db.expediente.findUnique({
    where: { id: snapshot.expediente.id },
    select: { version: true, updated_at: true, comparecientes: { where: { archived_at: null, estatus: 'ACTIVO' }, select: { compareciente: { select: { id: true, version: true, updated_at: true } } } } },
  });
  if (!current) return false;
  if (Number(current.version) !== Number(snapshot.expediente.version)) return true;
  const previous = new Map((snapshot.comparecientes || []).map((item: any) => [item.id, Number(item.version)]));
  return current.comparecientes.some((link: any) => previous.get(link.compareciente.id) !== Number(link.compareciente.version));
}
