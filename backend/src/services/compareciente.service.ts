import { Prisma, PrismaClient, TipoPersona, FormaComparecencia, TipoDocumentoCompareciente } from '@prisma/client';
import * as crypto from 'crypto';
import { validateCurp, validateOptionalDate, validateRfc } from '../domain/mexicanIdentity';
import { consolidateExtractedFields } from '../domain/documentExtraction';
import { extraerMultiplesDocumentos, type DocumentoParaExtraccion } from './openaiDocument.service';
import { recordAIFailure, recordAIUsages } from './aiUsage.service';
import { requireActorContext } from '../auth/actorContext';

type IdentityState = 'VERIFICADA' | 'PENDIENTE' | 'OBSERVACION';
type HealthState = 'COMPLETO' | 'PENDIENTE' | 'OBSERVACION' | 'NO_APLICA' | 'NO_CONFIGURADO';

const VERIFIED_IDENTIFICATION = {
  archived_at: null,
  validado_at: { not: null },
  estatus: { in: ['VIGENTE', 'POR_VENCER'] },
} as const;

const OBSERVED_IDENTIFICATION = {
  archived_at: null,
  estatus: { in: ['VENCIDO', 'RECHAZADO'] },
} as const;

function newestDate(values: Array<Date | string | null | undefined>, fallback: Date | string | null | undefined) {
  return values.reduce<Date>((latest, value) => {
    const candidate = value ? new Date(value) : latest;
    return candidate.getTime() > latest.getTime() ? candidate : latest;
  }, fallback ? new Date(fallback) : new Date(0));
}

function identityState(record: any): IdentityState {
  if (record.identificaciones?.some((item: any) => item.validado_at && ['VIGENTE', 'POR_VENCER'].includes(item.estatus))) return 'VERIFICADA';
  if (record.identificaciones?.some((item: any) => ['VENCIDO', 'RECHAZADO'].includes(item.estatus)) || record.datosFuente?.some((item: any) => item.estado === 'EN_CONFLICTO')) return 'OBSERVACION';
  return 'PENDIENTE';
}

function complianceState(record: any): HealthState {
  const reviews = (record.expedientes || []).flatMap((link: any) => link.expediente?.complianceReviews || []);
  if (!reviews.length) return 'NO_CONFIGURADO';
  if (reviews.some((review: any) => review.estatus === 'REQUIERE_AJUSTES')) return 'OBSERVACION';
  if (reviews.some((review: any) => review.estatus === 'CONFIRMADO')) return 'COMPLETO';
  return 'PENDIENTE';
}

function normalizedComparableValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('es-MX');
}

function submittedWorkspaceValue(dto: Record<string, any>, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(dto, field)) return dto[field];

  const addressMatch = field.match(/^dom_(particular|fiscal)_(.+)$/);
  if (addressMatch) {
    const [, kind, rawKey] = addressMatch;
    const keyAliases: Record<string, string> = {
      cp: 'codigo_postal',
      ciudad: 'localidad',
      numero_exterior: 'exterior',
      numero_interior: 'interior',
    };
    const key = keyAliases[rawKey] || rawKey;
    return dto[`domicilio_${kind}`]?.[key];
  }

  const identificationAliases: Record<string, string> = {
    folio_identificacion: 'numero',
    tipo_identificacion: 'tipo_identificacion',
    autoridad_emisora: 'autoridad_emisora',
    pais_emisor: 'pais_emisor',
    fecha_expedicion_identificacion: 'fecha_expedicion',
    fecha_vencimiento_identificacion: 'fecha_vencimiento',
  };
  const identificationKey = identificationAliases[field];
  return identificationKey ? dto.identificacion?.[identificationKey] : undefined;
}

export class ComparecienteService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Helper para normalizar cadenas de búsqueda
   */
  private normalizeSearchString(text: string): string {
    return text
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private uppercase(value?: unknown): string | null {
    const normalized = String(value ?? '').trim().toLocaleUpperCase('es-MX');
    return normalized || null;
  }

  /**
   * Búsqueda general y duplicados
   */
  public async buscarDuplicados(query: { rfc?: string; curp?: string; nombre?: string; correo?: string; telefono?: string; accessWhere?: Record<string, unknown> }) {
    const cleanRfc = query.rfc?.trim().toUpperCase();
    const cleanCurp = query.curp?.trim().toUpperCase();
    const cleanNombre = query.nombre?.trim() ? this.normalizeSearchString(query.nombre) : '';
    const cleanCorreo = query.correo?.trim().toLowerCase();
    const telefonoOriginal = query.telefono?.trim();
    const cleanTelefono = telefonoOriginal?.replace(/\D/g, '');
    const matchers: any[] = [];
    if (cleanCurp) matchers.push({ personaFisica: { curp: { equals: cleanCurp, mode: 'insensitive' } } });
    if (cleanRfc) matchers.push({ OR: [{ personaFisica: { rfc: { equals: cleanRfc, mode: 'insensitive' } } }, { personaMoral: { rfc: { equals: cleanRfc, mode: 'insensitive' } } }] });
    if (cleanNombre) matchers.push({ nombre_busqueda: { contains: cleanNombre, mode: 'insensitive' } });
    if (cleanCorreo) matchers.push({ contactos: { some: { archived_at: null, activo: true, tipo: 'CORREO', valor: { equals: cleanCorreo, mode: 'insensitive' } } } });
    if (cleanTelefono) matchers.push({ contactos: { some: { archived_at: null, activo: true, tipo: { in: ['TELEFONO', 'WHATSAPP', 'ALTERNO'] }, valor: { contains: telefonoOriginal } } } });
    if (!matchers.length) return [];

    const candidates = await this.prisma.compareciente.findMany({
      where: {
        archived_at: null,
        AND: [
          ...(query.accessWhere && Object.keys(query.accessWhere).length ? [query.accessWhere] : []),
          { OR: matchers },
        ],
      },
      select: {
        id: true, tipo_persona: true, nombre_busqueda: true, updated_at: true,
        personaFisica: { select: { nombre_completo_calculado: true, rfc: true, curp: true } },
        personaMoral: { select: { razon_social: true, rfc: true } },
        contactos: { where: { archived_at: null, activo: true }, select: { tipo: true, valor: true } },
      },
      orderBy: { updated_at: 'desc' },
      take: 10,
    });

    return candidates.map((candidate) => {
      const reasons: string[] = [];
      if (cleanCurp && candidate.personaFisica?.curp?.toUpperCase() === cleanCurp) reasons.push('CURP_EXACTA');
      const candidateRfc = candidate.personaFisica?.rfc || candidate.personaMoral?.rfc;
      if (cleanRfc && candidateRfc?.toUpperCase() === cleanRfc) reasons.push('RFC_EXACTO');
      if (cleanCorreo && candidate.contactos.some((contact) => contact.tipo === 'CORREO' && contact.valor.toLowerCase() === cleanCorreo)) reasons.push('CORREO_EXACTO');
      if (cleanTelefono && candidate.contactos.some((contact) => contact.valor.replace(/\D/g, '').includes(cleanTelefono))) reasons.push('TELEFONO_COINCIDENTE');
      if (cleanNombre && candidate.nombre_busqueda.includes(cleanNombre)) reasons.push('NOMBRE_SIMILAR');
      const blocking = reasons.some((reason) => ['CURP_EXACTA', 'RFC_EXACTO'].includes(reason));
      return {
        id: candidate.id,
        tipo_persona: candidate.tipo_persona,
        nombre: candidate.personaFisica?.nombre_completo_calculado || candidate.personaMoral?.razon_social || candidate.nombre_busqueda,
        rfc: candidateRfc || null,
        curp: candidate.personaFisica?.curp || null,
        razones: reasons,
        bloqueo_alta: blocking,
        updated_at: candidate.updated_at,
      };
    });
  }

  /**
   * Listado maestro con filtros y paginación
   */
  public async listarMaster(params: {
    tipo_persona?: TipoPersona;
    search?: string;
    page?: number;
    limit?: number;
    actualizacion?: 'HOY' | '7_DIAS' | '30_DIAS';
    sort?: string;
    accessWhere?: Record<string, unknown>;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const skip = (page - 1) * limit;

    const whereClause: any = {
      archived_at: null,
      ...(params.accessWhere && Object.keys(params.accessWhere).length ? { AND: [params.accessWhere] } : {}),
    };

    if (params.tipo_persona) {
      whereClause.tipo_persona = params.tipo_persona;
    }

    if (params.search && params.search.trim().length > 0) {
      const cleanSearch = this.normalizeSearchString(params.search);
      whereClause.OR = [
        { nombre_busqueda: { contains: cleanSearch, mode: 'insensitive' } },
        { personaFisica: { curp: { contains: cleanSearch, mode: 'insensitive' } } },
        { personaFisica: { rfc: { contains: cleanSearch, mode: 'insensitive' } } },
        { personaMoral: { rfc: { contains: cleanSearch, mode: 'insensitive' } } },
        { contactos: { some: { archived_at: null, activo: true, valor: { contains: params.search.trim(), mode: 'insensitive' } } } }
      ];
    }

    if (params.actualizacion) {
      const days = params.actualizacion === 'HOY' ? 1 : params.actualizacion === '7_DIAS' ? 7 : 30;
      whereClause.updated_at = { gte: new Date(Date.now() - days * 86_400_000) };
    }

    const baseWhere: any = { archived_at: null, ...(params.accessWhere && Object.keys(params.accessWhere).length ? { AND: [params.accessWhere] } : {}) };
    const [total, data, totalScoped, physical, legal] = await Promise.all([
      this.prisma.compareciente.count({ where: whereClause }),
      this.prisma.compareciente.findMany({
        where: whereClause,
        select: {
          id: true, tipo_persona: true, nombre_busqueda: true, estatus: true, created_at: true, updated_at: true,
          personaFisica: { select: { nombre_completo_calculado: true, rfc: true, curp: true, updated_at: true, pep_estado: true } },
          personaMoral: { select: { razon_social: true, nombre_comercial: true, rfc: true, updated_at: true } },
          identificaciones: { where: { archived_at: null }, select: { estatus: true, validado_at: true, updated_at: true } },
          datosFuente: { where: { archived_at: null, estado: 'EN_CONFLICTO' }, select: { estado: true, updated_at: true } },
          documentos: { where: { archived_at: null, estatus: 'ACTIVO' }, select: { updated_at: true, documento: { select: { fecha_carga: true, estatus: true } } } },
          expedientes: { where: { archived_at: null, estatus: 'ACTIVO' }, select: { updated_at: true, expediente: { select: { complianceReviews: { orderBy: { updated_at: 'desc' }, take: 1, select: { estatus: true, updated_at: true } } } } } },
        },
        orderBy: params.sort?.startsWith('nombre')
          ? { nombre_busqueda: params.sort.endsWith(':desc') ? 'desc' : 'asc' }
          : { updated_at: params.sort?.endsWith(':asc') ? 'asc' : 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.compareciente.count({ where: baseWhere }),
      this.prisma.compareciente.count({ where: { ...baseWhere, tipo_persona: 'FISICA' } }),
      this.prisma.compareciente.count({ where: { ...baseWhere, tipo_persona: 'MORAL' } }),
    ]);

    const rows = data.map((record: any) => {
      const lastMaterialUpdate = newestDate([
        record.updated_at, record.personaFisica?.updated_at, record.personaMoral?.updated_at,
        ...record.identificaciones.map((item: any) => item.updated_at),
        ...record.datosFuente.map((item: any) => item.updated_at),
        ...record.documentos.flatMap((item: any) => [item.updated_at, item.documento.fecha_carga]),
        ...record.expedientes.map((item: any) => item.updated_at),
      ], record.updated_at || record.created_at);
      return {
        id: record.id,
        tipo_persona: record.tipo_persona,
        nombre: record.personaFisica?.nombre_completo_calculado || record.personaMoral?.razon_social || record.nombre_busqueda,
        rfc: record.personaFisica?.rfc || record.personaMoral?.rfc || null,
        curp: record.personaFisica?.curp || null,
        expedientes_vinculados: record.expedientes.length,
        documentos: { total: record.documentos.length },
        updated_at: lastMaterialUpdate.toISOString(),
      };
    });

    return {
      data: rows,
      metrics: { total: totalScoped, physical, legal },
      meta: {
        total,
        page,
        limit,
        pageSize: limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasPreviousPage: page > 1,
        hasNextPage: page * limit < total,
      },
      definitions: { documents: 'Documentos activos vinculados al compareciente.', materialUpdate: 'Última modificación material disponible.' },
    };
  }

  /**
   * Obtener detalle completo de Compareciente Maestra
   */
  public async obtenerPorId(id: string) {
    const compareciente = await this.prisma.compareciente.findUnique({
      where: { id },
      include: {
        creado_por: { select: { id: true, nombre: true, apellido: true } },
        personaFisica: {
          include: {
            matrimoniosComoPersona1: {
              where: { vigente: true, archived_at: null },
              include: { persona2: { include: { compareciente: true } } }
            },
            matrimoniosComoPersona2: {
              where: { vigente: true, archived_at: null },
              include: { persona1: { include: { compareciente: true } } }
            }
          }
        },
        personaMoral: {
          include: {
            instrumentos: { where: { archived_at: null }, include: { documentoSoporte: { select: { id: true, nombre_original: true, estatus: true } }, validado_por: { select: { id: true, nombre: true, apellido: true } } } },
            representantes: {
              where: { vigente: true, archived_at: null },
              include: {
                representantePersonaFisica: { include: { compareciente: true } },
                caracterRepresentacion: true,
                instrumento: true
              }
            }
          }
        },
        domicilios: { where: { archived_at: null }, include: { documentoComprobante: { select: { id: true, nombre_original: true, estatus: true } } } },
        contactos: { where: { archived_at: null } },
        identificaciones: { where: { archived_at: null }, include: { documento: { select: { id: true, nombre_original: true, estatus: true } }, validado_por: { select: { id: true, nombre: true, apellido: true } } } },
        aliases: { where: { activo: true, archived_at: null }, orderBy: [{ principal: 'desc' }, { created_at: 'asc' }] },
        actividadesEconomicas: {
          where: { vigente: true },
          include: { actividad: true },
          orderBy: [{ principal: 'desc' }, { created_at: 'asc' }],
        },
        documentos: {
          where: { archived_at: null, estatus: 'ACTIVO' },
          include: {
            documento: { select: { id: true, nombre_original: true, tipo: true, categoria: true, mime_type: true, size_bytes: true, fecha_carga: true, fecha_emision: true, fecha_vigencia: true, observaciones: true, estatus: true, subido_por: { select: { nombre: true, apellido: true } } } },
            validado_por: { select: { id: true, nombre: true, apellido: true } },
          }
        },
        datosFuente: {
          where: { archived_at: null },
          include: { documento: { select: { id: true, nombre_original: true, tipo: true, estatus: true } }, confirmado_por: { select: { id: true, nombre: true, apellido: true } } },
          orderBy: { updated_at: 'desc' },
        },
        expedientes: {
          where: { archived_at: null, estatus: 'ACTIVO' },
          include: {
            expediente: {
              select: {
                id: true, numero_pravia: true, numero_notaria: true, cliente_alias: true, estatus: true, etapa_actual_nombre: true, updated_at: true,
                tipo_acto: { select: { id: true, nombre: true } },
                notaria: { select: { id: true, nombre: true, numero_notaria: true } },
                abogado: { select: { id: true, nombre: true, apellido: true } },
                complianceReviews: {
                  orderBy: { updated_at: 'desc' },
                  take: 1,
                  select: { id: true, tipo: true, estatus: true, resultado_json: true, explicacion: true, rule_version_snapshot: true, revisado_at: true, updated_at: true },
                },
              },
            },
            caracter: true
          }
        },
        representacionesComoRepresentante: { include: { expediente: { select: { id: true, numero_pravia: true, estatus: true } }, representado: { select: { id: true, nombre_busqueda: true } }, caracterRepresentacion: true, instrumento: true } },
        representacionesComoRepresentado: { include: { expediente: { select: { id: true, numero_pravia: true, estatus: true } }, representante: { select: { id: true, nombre_busqueda: true } }, caracterRepresentacion: true, instrumento: true } },
      }
    });

    if (!compareciente || compareciente.archived_at) {
      throw new Error(`Compareciente con ID '${id}' no fue encontrado o está archivado.`);
    }

    const audit = await this.prisma.auditLog.findMany({
      where: { entidad_id: id },
      include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    const currentIdentity = identityState(compareciente);
    const currentCompliance = complianceState(compareciente);
    const activeAddresses = compareciente.domicilios.filter((item) => item.vigente);
    const addressConflict = compareciente.datosFuente.some((item) => item.estado === 'EN_CONFLICTO' && /DOMICILIO|CALLE|COLONIA|CODIGO_POSTAL|MUNICIPIO|ESTADO/i.test(item.campo));
    const currentRepresentatives = compareciente.personaMoral?.representantes || [];
    const representationState: HealthState = compareciente.tipo_persona === 'FISICA'
      ? 'NO_APLICA'
      : !currentRepresentatives.length
        ? 'PENDIENTE'
        : currentRepresentatives.some((item) => item.fecha_fin && item.fecha_fin < new Date())
          ? 'OBSERVACION'
          : currentRepresentatives.every((item) => item.instrumento_id || item.documento_soporte_id)
            ? 'COMPLETO'
            : 'PENDIENTE';
    const activeDocuments = compareciente.documentos;
    const documentState: HealthState = activeDocuments.some((item) => ['VENCIDO', 'RECHAZADO'].includes(item.documento.estatus))
      ? 'OBSERVACION'
      : activeDocuments.length
        ? 'COMPLETO'
        : 'PENDIENTE';
    const rfc = compareciente.personaFisica?.rfc || compareciente.personaMoral?.rfc;
    const lastMaterialUpdate = newestDate([
      compareciente.updated_at,
      compareciente.personaFisica?.updated_at,
      compareciente.personaMoral?.updated_at,
      ...compareciente.domicilios.map((item) => item.updated_at),
      ...compareciente.contactos.map((item) => item.updated_at),
      ...compareciente.identificaciones.map((item) => item.updated_at),
      ...compareciente.documentos.flatMap((item) => [item.updated_at, item.documento.fecha_carga]),
      ...compareciente.datosFuente.map((item) => item.updated_at),
      ...compareciente.expedientes.map((item) => item.updated_at),
    ], compareciente.updated_at || compareciente.created_at);

    return {
      ...compareciente,
      nombre: compareciente.personaFisica?.nombre_completo_calculado || compareciente.personaMoral?.razon_social || compareciente.nombre_busqueda,
      rfc: rfc || null,
      curp: compareciente.personaFisica?.curp || null,
      identidad: currentIdentity,
      cumplimiento: currentCompliance,
      updated_at_material: lastMaterialUpdate.toISOString(),
      health: [
        { key: 'IDENTIDAD', label: 'Identidad', state: currentIdentity === 'VERIFICADA' ? 'COMPLETO' : currentIdentity },
        { key: 'FISCAL', label: 'Fiscal', state: rfc ? 'COMPLETO' : 'PENDIENTE' },
        { key: 'DOMICILIO', label: 'Domicilio', state: addressConflict ? 'OBSERVACION' : activeAddresses.some((item) => item.comprobado) ? 'COMPLETO' : 'PENDIENTE' },
        { key: 'REPRESENTACION', label: 'Representación', state: representationState },
        { key: 'CUMPLIMIENTO', label: 'Cumplimiento', state: currentCompliance },
        { key: 'DOCUMENTOS', label: 'Documentos', state: documentState },
      ],
      complianceSnapshots: compareciente.expedientes.flatMap((link) => link.expediente.complianceReviews.map((review) => ({ ...review, expediente: { id: link.expediente.id, numero_pravia: link.expediente.numero_pravia } }))),
      actividad: audit,
      capabilities: {
        canUploadDocuments: true,
        canArchive: compareciente.estatus === 'ACTIVO',
        allowsSoftDuplicateOverride: true,
        blocksExactIdentityDuplicate: true,
      },
    };
  }

  /**
   * Crear Persona Física en transacción inmutable
   */
  public async crearPersonaFisica(dto: {
    nombre: string;
    apellido_paterno?: string;
    apellido_materno?: string;
    sexo?: any;
    fecha_nacimiento?: string;
    lugar_nacimiento?: string;
    pais_nacimiento?: string;
    nacionalidad?: string;
    curp?: string;
    rfc?: string;
    estado_civil?: any;
    regimen_matrimonial?: any;
    ocupacion?: string;
    escolaridad?: string;
    actividad_economica?: string;
    giro?: string;
    pep_estado?: 'PENDIENTE' | 'SI' | 'NO';
    relacion_pep?: string;
    aliases?: string[];
    domicilio_principal?: any;
    contacto_principal?: any;
    identificacion_principal?: any;
    domicilio_fiscal?: any;
    telefono?: string;
    correo?: string;
    observaciones?: string;
    creado_por_id: string;
  }) {
    const cleanName = this.uppercase(dto.nombre) || '';
    const cleanFirstSurname = this.uppercase(dto.apellido_paterno);
    const cleanSecondSurname = this.uppercase(dto.apellido_materno);
    const nombreCompleto = [cleanName, cleanFirstSurname, cleanSecondSurname]
      .filter(Boolean)
      .join(' ')
      .trim();

    const nombreBusqueda = this.normalizeSearchString(nombreCompleto);
    if (!nombreBusqueda) throw new Error('El nombre de la persona física es obligatorio.');
    const cleanCurp = validateCurp(dto.curp);
    const cleanRfc = validateRfc(dto.rfc, 'FISICA');
    const birthDate = validateOptionalDate(dto.fecha_nacimiento, 'La fecha de nacimiento');

    return await this.prisma.$transaction(async (tx) => {
      const identityKey = cleanCurp || cleanRfc || nombreBusqueda;
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:compareciente:${identityKey}`}))`);
      const duplicate = await tx.personaFisica.findFirst({
        where: {
          archived_at: null,
          OR: [
            ...(cleanCurp ? [{ curp: { equals: cleanCurp, mode: 'insensitive' as const } }] : []),
            ...(cleanRfc ? [{ rfc: { equals: cleanRfc, mode: 'insensitive' as const } }] : []),
          ],
        },
        select: { compareciente_id: true },
      });
      if (duplicate) {
        throw new Error(`Ya existe una persona física con la misma ${cleanCurp ? 'CURP' : 'RFC'} (${duplicate.compareciente_id}).`);
      }

      // 1. Crear cabecera compareciente
      const compareciente = await tx.compareciente.create({
        data: {
          tipo_persona: TipoPersona.FISICA,
          nombre_busqueda: nombreBusqueda,
          observaciones: dto.observaciones?.trim() || null,
          creado_por_id: dto.creado_por_id
        }
      });

      // 2. Crear subperfil persona_fisica
      const personaFisica = await tx.personaFisica.create({
        data: {
          compareciente_id: compareciente.id,
          nombre: cleanName,
          apellido_paterno: cleanFirstSurname,
          apellido_materno: cleanSecondSurname,
          nombre_completo_calculado: nombreCompleto,
          sexo: dto.sexo,
          fecha_nacimiento: birthDate,
          lugar_nacimiento: dto.lugar_nacimiento,
          pais_nacimiento: dto.pais_nacimiento,
          nacionalidad: dto.nacionalidad || 'Mexicana',
          curp: cleanCurp,
          rfc: cleanRfc,
          estado_civil: dto.estado_civil,
          regimen_matrimonial: dto.regimen_matrimonial,
          ocupacion: dto.ocupacion,
          escolaridad: dto.escolaridad,
          actividad_economica: dto.actividad_economica,
          giro: dto.giro,
          pep: dto.pep_estado === 'SI',
          pep_estado: dto.pep_estado || 'PENDIENTE',
          relacion_pep: dto.pep_estado === 'SI' ? dto.relacion_pep : null,
        }
      });

      for (const [index, alias] of (dto.aliases || []).map((value) => value.trim()).filter(Boolean).entries()) {
        await tx.comparecienteAlias.create({
          data: { compareciente_id: compareciente.id, alias, principal: index === 0 },
        });
      }

      // 3. Crear Domicilio principal si se proporciona
      if (dto.domicilio_principal) {
        await tx.comparecienteDomicilio.create({
          data: {
            compareciente_id: compareciente.id,
            tipo: dto.domicilio_principal.tipo || 'PARTICULAR',
            calle: dto.domicilio_principal.calle,
            exterior: dto.domicilio_principal.exterior,
            interior: dto.domicilio_principal.interior,
            colonia: dto.domicilio_principal.colonia,
            municipio: dto.domicilio_principal.municipio,
            localidad: dto.domicilio_principal.localidad || null,
            estado: dto.domicilio_principal.estado,
            codigo_postal: dto.domicilio_principal.codigo_postal,
            pais: dto.domicilio_principal.pais || 'México',
            comprobado: Boolean(dto.domicilio_principal.comprobado),
            documento_comprobante_id: dto.domicilio_principal.documento_comprobante_id || null,
            principal: true,
            creado_por_id: dto.creado_por_id
          }
        });
      }

      if (dto.domicilio_fiscal) {
        await tx.comparecienteDomicilio.create({ data: {
          compareciente_id: compareciente.id, tipo: 'FISCAL', principal: false,
          calle: dto.domicilio_fiscal.calle || null, exterior: dto.domicilio_fiscal.exterior || null,
          interior: dto.domicilio_fiscal.interior || null, colonia: dto.domicilio_fiscal.colonia || null,
          municipio: dto.domicilio_fiscal.municipio || null, localidad: dto.domicilio_fiscal.localidad || null,
          estado: dto.domicilio_fiscal.estado || null, codigo_postal: dto.domicilio_fiscal.codigo_postal || null,
          pais: dto.domicilio_fiscal.pais || 'México', creado_por_id: dto.creado_por_id,
        } });
      }

      // 4. Crear Contacto principal si se proporciona
      if (dto.contacto_principal) {
        await tx.comparecienteContacto.create({
          data: {
            compareciente_id: compareciente.id,
            tipo: dto.contacto_principal.tipo || 'TELEFONO',
            valor: dto.contacto_principal.valor,
            principal: true,
            creado_por_id: dto.creado_por_id
          }
        });
      }
      for (const contact of [
        dto.telefono ? { tipo: 'TELEFONO' as const, valor: dto.telefono.trim() } : null,
        dto.correo ? { tipo: 'CORREO' as const, valor: dto.correo.trim().toLowerCase() } : null,
      ].filter((item): item is { tipo: 'TELEFONO' | 'CORREO'; valor: string } => Boolean(item?.valor))) {
        if (!dto.contacto_principal || dto.contacto_principal.tipo !== contact.tipo) {
          await tx.comparecienteContacto.create({ data: { compareciente_id: compareciente.id, tipo: contact.tipo, valor: contact.valor, principal: !dto.contacto_principal, creado_por_id: dto.creado_por_id } });
        }
      }

      // 5. La identificación existe como registro pendiente hasta que una persona la valide.
      if (dto.identificacion_principal?.numero || dto.identificacion_principal?.tipo_identificacion) {
        await tx.comparecienteIdentificacion.create({
          data: {
            compareciente_id: compareciente.id,
            tipo_identificacion: dto.identificacion_principal.tipo_identificacion || 'INE',
            numero: dto.identificacion_principal.numero || null,
            autoridad_emisora: dto.identificacion_principal.autoridad_emisora || null,
            pais_emisor: dto.identificacion_principal.pais_emisor || 'México',
            fecha_expedicion: validateOptionalDate(dto.identificacion_principal.fecha_expedicion, 'La fecha de expedición'),
            fecha_vencimiento: validateOptionalDate(dto.identificacion_principal.fecha_vencimiento, 'La fecha de vencimiento'),
            principal: true,
            creado_por_id: dto.creado_por_id,
          },
        });
      }

      // 6. Registrar Evento de Auditoría y Outbox
      const correlationId = crypto.randomUUID();
      await tx.auditLog.create({
        data: {
          user_id: dto.creado_por_id,
          accion: 'CREAR_PERSONA_FISICA',
          entidad: 'Compareciente',
          entidad_id: compareciente.id,
          valores_nuevos: JSON.parse(JSON.stringify({ compareciente, personaFisica })),
          detalles: { modulo: 'COMPARECIENTES' },
          correlation_id: correlationId
        }
      });

      await tx.domainEventOutbox.create({
        data: {
          event_type: 'ComparecienteCreado',
          aggregate_type: 'Compareciente',
          aggregate_id: compareciente.id,
          payload: {
            compareciente_id: compareciente.id,
            tipo_persona: 'FISICA',
            nombre_completo: nombreCompleto,
            actor_user_id: dto.creado_por_id
          },
          correlation_id: correlationId
        }
      });

      return { compareciente, personaFisica };
    });
  }

  /**
   * Crear Persona Moral en transacción inmutable
   */
  public async crearPersonaMoral(dto: {
    razon_social: string;
    nombre_comercial?: string;
    tipo_societario?: string;
    nacionalidad?: string;
    rfc?: string;
    fecha_constitucion?: string;
    folio_mercantil?: string;
    objeto_social_resumido?: string;
    domicilio_principal?: any;
    domicilio_fiscal?: any;
    contacto_principal?: any;
    telefono?: string;
    correo?: string;
    duracion?: string;
    fecha_inscripcion_mercantil?: string;
    estatus_societario?: string;
    observaciones?: string;
    creado_por_id: string;
  }) {
    const cleanLegalName = this.uppercase(dto.razon_social) || '';
    const nombreBusqueda = this.normalizeSearchString(cleanLegalName);
    if (!nombreBusqueda) throw new Error('La razón social es obligatoria.');
    const cleanRfc = validateRfc(dto.rfc, 'MORAL');
    const incorporationDate = validateOptionalDate(dto.fecha_constitucion, 'La fecha de constitución');

    return await this.prisma.$transaction(async (tx) => {
      const identityKey = cleanRfc || nombreBusqueda;
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:compareciente:${identityKey}`}))`);
      if (cleanRfc) {
        const duplicate = await tx.personaMoral.findFirst({
          where: { archived_at: null, rfc: { equals: cleanRfc, mode: 'insensitive' } },
          select: { compareciente_id: true },
        });
        if (duplicate) throw new Error(`Ya existe una persona moral con el mismo RFC (${duplicate.compareciente_id}).`);
      }

      // 1. Crear cabecera compareciente
      const compareciente = await tx.compareciente.create({
        data: {
          tipo_persona: TipoPersona.MORAL,
          nombre_busqueda: nombreBusqueda,
          observaciones: dto.observaciones?.trim() || null,
          creado_por_id: dto.creado_por_id
        }
      });

      // 2. Crear subperfil persona_moral
      const personaMoral = await tx.personaMoral.create({
        data: {
          compareciente_id: compareciente.id,
          razon_social: cleanLegalName,
          nombre_comercial: this.uppercase(dto.nombre_comercial),
          tipo_societario: dto.tipo_societario,
          nacionalidad: dto.nacionalidad || 'Mexicana',
          rfc: cleanRfc,
          fecha_constitucion: incorporationDate,
          duracion: dto.duracion?.trim() || 'Indefinida',
          folio_mercantil: dto.folio_mercantil,
          objeto_social_resumido: dto.objeto_social_resumido,
          fecha_inscripcion_mercantil: validateOptionalDate(dto.fecha_inscripcion_mercantil, 'La fecha de inscripción mercantil'),
          estatus_societario: dto.estatus_societario?.trim() || 'ACTIVA',
        }
      });

      if (dto.domicilio_principal) {
        await tx.comparecienteDomicilio.create({
          data: {
            compareciente_id: compareciente.id,
            tipo: dto.domicilio_principal.tipo || 'FISCAL',
            pais: dto.domicilio_principal.pais || 'México',
            estado: dto.domicilio_principal.estado || null,
            municipio: dto.domicilio_principal.municipio || null,
            localidad: dto.domicilio_principal.localidad || null,
            colonia: dto.domicilio_principal.colonia || null,
            calle: dto.domicilio_principal.calle || null,
            exterior: dto.domicilio_principal.exterior || null,
            interior: dto.domicilio_principal.interior || null,
            codigo_postal: dto.domicilio_principal.codigo_postal || null,
            principal: true,
            creado_por_id: dto.creado_por_id,
          },
        });
      }
      if (dto.domicilio_fiscal) {
        await tx.comparecienteDomicilio.create({ data: {
          compareciente_id: compareciente.id, tipo: 'FISCAL', principal: true,
          pais: dto.domicilio_fiscal.pais || 'México', estado: dto.domicilio_fiscal.estado || null,
          municipio: dto.domicilio_fiscal.municipio || null, localidad: dto.domicilio_fiscal.localidad || null,
          colonia: dto.domicilio_fiscal.colonia || null, calle: dto.domicilio_fiscal.calle || null,
          exterior: dto.domicilio_fiscal.exterior || null, interior: dto.domicilio_fiscal.interior || null,
          codigo_postal: dto.domicilio_fiscal.codigo_postal || null, creado_por_id: dto.creado_por_id,
        } });
      }
      if (dto.contacto_principal?.valor) {
        await tx.comparecienteContacto.create({
          data: {
            compareciente_id: compareciente.id,
            tipo: dto.contacto_principal.tipo || 'CORREO',
            valor: String(dto.contacto_principal.valor).trim(),
            principal: true,
            creado_por_id: dto.creado_por_id,
          },
        });
      }
      for (const contact of [
        dto.telefono ? { tipo: 'TELEFONO' as const, valor: dto.telefono.trim() } : null,
        dto.correo ? { tipo: 'CORREO' as const, valor: dto.correo.trim().toLowerCase() } : null,
      ].filter((item): item is { tipo: 'TELEFONO' | 'CORREO'; valor: string } => Boolean(item?.valor))) {
        if (!dto.contacto_principal || dto.contacto_principal.tipo !== contact.tipo) await tx.comparecienteContacto.create({ data: { compareciente_id: compareciente.id, tipo: contact.tipo, valor: contact.valor, principal: !dto.contacto_principal, creado_por_id: dto.creado_por_id } });
      }

      // 3. Registrar Evento de Auditoría y Outbox
      const correlationId = crypto.randomUUID();
      await tx.auditLog.create({
        data: {
          user_id: dto.creado_por_id,
          accion: 'CREAR_PERSONA_MORAL',
          entidad: 'Compareciente',
          entidad_id: compareciente.id,
          valores_nuevos: JSON.parse(JSON.stringify({ compareciente, personaMoral })),
          detalles: { modulo: 'COMPARECIENTES' },
          correlation_id: correlationId
        }
      });

      await tx.domainEventOutbox.create({
        data: {
          event_type: 'ComparecienteCreado',
          aggregate_type: 'Compareciente',
          aggregate_id: compareciente.id,
          payload: {
            compareciente_id: compareciente.id,
            tipo_persona: 'MORAL',
            razon_social: dto.razon_social,
            actor_user_id: dto.creado_por_id
          },
          correlation_id: correlationId
        }
      });

      return { compareciente, personaMoral };
    });
  }

  /** Edición explícita del dato maestro. No altera snapshots de cumplimiento ni relaciones históricas. */
  public async actualizarMaster(id: string, dto: Record<string, any>, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.compareciente.findFirst({ where: { id, archived_at: null }, include: {
        personaFisica: true, personaMoral: true,
        domicilios: { where: { archived_at: null, vigente: true } },
        contactos: { where: { archived_at: null, activo: true } },
        identificaciones: { where: { archived_at: null, principal: true }, take: 1 },
        aliases: { where: { archived_at: null, activo: true } },
        datosFuente: { where: { archived_at: null, estado: { in: ['PENDIENTE_CONFIRMACION', 'EN_CONFLICTO'] } } },
      } });
      if (!current) throw new Error('Compareciente no encontrado.');
      let nombreBusqueda = current.nombre_busqueda;
      if (current.tipo_persona === 'FISICA' && current.personaFisica) {
        const nombre = this.uppercase(dto.nombre ?? current.personaFisica.nombre) || '';
        const apellidoPaterno = dto.apellido_paterno === undefined ? current.personaFisica.apellido_paterno : this.uppercase(dto.apellido_paterno);
        const apellidoMaterno = dto.apellido_materno === undefined ? current.personaFisica.apellido_materno : this.uppercase(dto.apellido_materno);
        if (!nombre) throw new Error('El nombre es obligatorio.');
        const completo = [nombre, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' ');
        nombreBusqueda = this.normalizeSearchString(completo);
        await tx.personaFisica.update({ where: { compareciente_id: id }, data: {
          nombre, apellido_paterno: apellidoPaterno, apellido_materno: apellidoMaterno, nombre_completo_calculado: completo,
          rfc: dto.rfc === undefined ? current.personaFisica.rfc : validateRfc(dto.rfc, 'FISICA'),
          curp: dto.curp === undefined ? current.personaFisica.curp : validateCurp(dto.curp),
          sexo: dto.sexo === undefined ? current.personaFisica.sexo : dto.sexo || null,
          fecha_nacimiento: dto.fecha_nacimiento === undefined ? current.personaFisica.fecha_nacimiento : validateOptionalDate(dto.fecha_nacimiento, 'La fecha de nacimiento'),
          lugar_nacimiento: dto.lugar_nacimiento === undefined ? current.personaFisica.lugar_nacimiento : String(dto.lugar_nacimiento || '').trim() || null,
          pais_nacimiento: dto.pais_nacimiento === undefined ? current.personaFisica.pais_nacimiento : String(dto.pais_nacimiento || '').trim() || null,
          nacionalidad: dto.nacionalidad === undefined ? current.personaFisica.nacionalidad : String(dto.nacionalidad || 'Mexicana').trim(),
          estado_civil: dto.estado_civil === undefined ? current.personaFisica.estado_civil : dto.estado_civil || null,
          regimen_matrimonial: dto.regimen_matrimonial === undefined ? current.personaFisica.regimen_matrimonial : dto.regimen_matrimonial || null,
          ocupacion: dto.ocupacion === undefined ? current.personaFisica.ocupacion : String(dto.ocupacion || '').trim() || null,
          escolaridad: dto.escolaridad === undefined ? current.personaFisica.escolaridad : String(dto.escolaridad || '').trim() || null,
          actividad_economica: dto.actividad_economica === undefined ? current.personaFisica.actividad_economica : String(dto.actividad_economica || '').trim() || null,
          giro: dto.giro === undefined ? current.personaFisica.giro : String(dto.giro || '').trim() || null,
          pep_estado: dto.pep_estado === undefined ? current.personaFisica.pep_estado : dto.pep_estado,
          pep: dto.pep_estado === undefined ? current.personaFisica.pep : dto.pep_estado === 'SI',
          relacion_pep: dto.relacion_pep === undefined ? current.personaFisica.relacion_pep : dto.pep_estado === 'SI' ? String(dto.relacion_pep || '').trim() || null : null,
        } });
      }
      if (current.tipo_persona === 'MORAL' && current.personaMoral) {
        const razonSocial = this.uppercase(dto.razon_social ?? current.personaMoral.razon_social) || '';
        if (!razonSocial) throw new Error('La razón social es obligatoria.');
        nombreBusqueda = this.normalizeSearchString(razonSocial);
        await tx.personaMoral.update({ where: { compareciente_id: id }, data: {
          razon_social: razonSocial,
          nombre_comercial: dto.nombre_comercial === undefined ? current.personaMoral.nombre_comercial : this.uppercase(dto.nombre_comercial),
          tipo_societario: dto.tipo_societario === undefined ? current.personaMoral.tipo_societario : String(dto.tipo_societario || '').trim() || null,
          rfc: dto.rfc === undefined ? current.personaMoral.rfc : validateRfc(dto.rfc, 'MORAL'),
          nacionalidad: dto.nacionalidad === undefined ? current.personaMoral.nacionalidad : String(dto.nacionalidad || 'Mexicana').trim(),
          fecha_constitucion: dto.fecha_constitucion === undefined ? current.personaMoral.fecha_constitucion : validateOptionalDate(dto.fecha_constitucion, 'La fecha de constitución'),
          duracion: dto.duracion === undefined ? current.personaMoral.duracion : String(dto.duracion || '').trim() || null,
          folio_mercantil: dto.folio_mercantil === undefined ? current.personaMoral.folio_mercantil : String(dto.folio_mercantil || '').trim() || null,
          objeto_social_resumido: dto.objeto_social_resumido === undefined ? current.personaMoral.objeto_social_resumido : String(dto.objeto_social_resumido || '').trim() || null,
          fecha_inscripcion_mercantil: dto.fecha_inscripcion_mercantil === undefined ? current.personaMoral.fecha_inscripcion_mercantil : validateOptionalDate(dto.fecha_inscripcion_mercantil, 'La fecha de inscripción mercantil'),
          estatus_societario: dto.estatus_societario === undefined ? current.personaMoral.estatus_societario : String(dto.estatus_societario || '').trim() || null,
        } });
      }

      if (Array.isArray(dto.aliases)) {
        await tx.comparecienteAlias.updateMany({ where: { compareciente_id: id, archived_at: null }, data: { activo: false, archived_at: new Date() } });
        for (const [index, alias] of dto.aliases.map((value: unknown) => this.uppercase(value)).filter(Boolean).entries()) {
          await tx.comparecienteAlias.create({ data: { compareciente_id: id, alias: alias!, principal: index === 0 } });
        }
      }

      for (const [type, field] of [['TELEFONO', 'telefono'], ['CORREO', 'correo']] as const) {
        if (dto[field] === undefined) continue;
        const value = String(dto[field] || '').trim();
        const existing = current.contactos.find((item) => item.tipo === type);
        if (!value && existing) await tx.comparecienteContacto.update({ where: { id: existing.id }, data: { activo: false, archived_at: new Date() } });
        if (value && existing) await tx.comparecienteContacto.update({ where: { id: existing.id }, data: { valor: type === 'CORREO' ? value.toLowerCase() : value } });
        if (value && !existing) await tx.comparecienteContacto.create({ data: { compareciente_id: id, tipo: type, valor: type === 'CORREO' ? value.toLowerCase() : value, principal: true, creado_por_id: actorUserId } });
      }

      for (const [type, field] of [['PARTICULAR', 'domicilio_particular'], ['FISCAL', 'domicilio_fiscal']] as const) {
        if (dto[field] === undefined) continue;
        const address = dto[field] || {};
        const existing = current.domicilios.find((item) => item.tipo === type);
        const data = {
          pais: String(address.pais || 'México').trim(), estado: String(address.estado || '').trim() || null,
          municipio: String(address.municipio || '').trim() || null, localidad: String(address.localidad || '').trim() || null,
          colonia: String(address.colonia || '').trim() || null, calle: String(address.calle || '').trim() || null,
          exterior: String(address.exterior || '').trim() || null, interior: String(address.interior || '').trim() || null,
          codigo_postal: String(address.codigo_postal || '').trim() || null, referencia: String(address.referencia || '').trim() || null,
        };
        if (existing) await tx.comparecienteDomicilio.update({ where: { id: existing.id }, data });
        else if (Object.values(data).some((value) => value && value !== 'México')) await tx.comparecienteDomicilio.create({ data: { ...data, compareciente_id: id, tipo: type, principal: type === 'PARTICULAR', creado_por_id: actorUserId } });
      }

      if (dto.identificacion !== undefined) {
        const identification = dto.identificacion || {};
        const existing = current.identificaciones[0];
        const data = {
          tipo_identificacion: identification.tipo_identificacion || 'INE', numero: String(identification.numero || '').trim() || null,
          autoridad_emisora: String(identification.autoridad_emisora || '').trim() || null, pais_emisor: String(identification.pais_emisor || 'México').trim(),
          fecha_expedicion: validateOptionalDate(identification.fecha_expedicion, 'La fecha de expedición'),
          fecha_vencimiento: validateOptionalDate(identification.fecha_vencimiento, 'La fecha de vencimiento'),
        };
        if (existing) await tx.comparecienteIdentificacion.update({ where: { id: existing.id }, data });
        else if (data.numero) await tx.comparecienteIdentificacion.create({ data: { ...data, compareciente_id: id, principal: true, creado_por_id: actorUserId } });
      }

      const header = await tx.compareciente.update({ where: { id }, data: {
        nombre_busqueda: nombreBusqueda,
        observaciones: dto.observaciones === undefined ? current.observaciones : String(dto.observaciones || '').trim() || null,
        version: { increment: 1 },
      } });

      for (const source of current.datosFuente) {
        const submittedValue = submittedWorkspaceValue(dto, source.campo);
        if (submittedValue === undefined) continue;
        const confirmedValue = String(submittedValue ?? '').trim() || null;
        const matchesProposal = normalizedComparableValue(confirmedValue) === normalizedComparableValue(source.valor_detectado);
        await tx.comparecienteDatoFuente.update({
          where: { id: source.id },
          data: {
            estado: matchesProposal ? 'CONFIRMADO' : 'EDITADO_MANUALMENTE',
            valor_confirmado: confirmedValue,
            confirmado_por_id: actorUserId,
            confirmado_at: new Date(),
          },
        });
      }
      await tx.auditLog.create({ data: { user_id: actorUserId, accion: 'EDITAR_COMPARECIENTE', entidad: 'Compareciente', entidad_id: id, valores_anteriores: { version: current.version }, valores_nuevos: { version: header.version, campos: Object.keys(dto) }, detalles: { modulo: 'COMPARECIENTES' }, correlation_id: crypto.randomUUID() } });
      return header;
    });
  }

  /** Resuelve de forma auditable un conflicto documental de RFC/CURP. */
  public async resolverConflictoDato(comparecienteId: string, sourceId: string, action: 'CONSERVAR_ACTUAL' | 'ACTUALIZAR', actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.comparecienteDatoFuente.findFirst({ where: { id: sourceId, compareciente_id: comparecienteId, archived_at: null, estado: 'EN_CONFLICTO' }, include: { compareciente: { include: { personaFisica: true, personaMoral: true } } } });
      if (!source) throw new Error('El conflicto ya no está disponible.');
      const field = source.campo.toLowerCase();
      if (!['rfc', 'curp'].includes(field)) throw new Error('Este dato requiere revisión desde la edición de ficha.');
      const detected = String(source.valor_detectado || '').trim();
      const currentValue = field === 'curp' ? source.compareciente.personaFisica?.curp : source.compareciente.personaFisica?.rfc || source.compareciente.personaMoral?.rfc;
      if (action === 'ACTUALIZAR') {
        if (field === 'curp' && source.compareciente.personaFisica) await tx.personaFisica.update({ where: { compareciente_id: comparecienteId }, data: { curp: validateCurp(detected) } });
        if (field === 'rfc' && source.compareciente.personaFisica) await tx.personaFisica.update({ where: { compareciente_id: comparecienteId }, data: { rfc: validateRfc(detected, 'FISICA') } });
        if (field === 'rfc' && source.compareciente.personaMoral) await tx.personaMoral.update({ where: { compareciente_id: comparecienteId }, data: { rfc: validateRfc(detected, 'MORAL') } });
        await tx.compareciente.update({ where: { id: comparecienteId }, data: { version: { increment: 1 } } });
      }
      const updated = await tx.comparecienteDatoFuente.update({ where: { id: source.id }, data: { estado: action === 'ACTUALIZAR' ? 'CONFIRMADO' : 'DESCARTADO', valor_confirmado: action === 'ACTUALIZAR' ? detected : currentValue || null, confirmado_por_id: actorUserId, confirmado_at: new Date() } });
      await tx.auditLog.create({ data: { user_id: actorUserId, accion: action === 'ACTUALIZAR' ? 'ACTUALIZAR_DATO_DESDE_DOCUMENTO' : 'CONSERVAR_DATO_MAESTRO', entidad: 'Compareciente', entidad_id: comparecienteId, valores_anteriores: { campo: source.campo, actual: currentValue, detectado: detected }, valores_nuevos: { campo: source.campo, valor: updated.valor_confirmado, estado: updated.estado }, detalles: { modulo: 'COMPARECIENTES', fuente_id: source.id }, correlation_id: crypto.randomUUID() } });
      return updated;
    });
  }

  /** Archiva de forma reversible. Los comparecientes maestros nunca se eliminan físicamente. */
  public async archivarCompareciente(dto: {
    id: string;
    usuario_id: string;
    motivo?: string;
  }) {
    const comp = await this.prisma.compareciente.findUnique({
      where: { id: dto.id },
      include: {
        _count: {
          select: {
            expedientes: { where: { estatus: 'ACTIVO', archived_at: null } }
          }
        }
      }
    });

    if (!comp) throw new Error(`Compareciente con ID '${dto.id}' no encontrado.`);
    if (comp.archived_at) throw new Error('Este compareciente ya está archivado.');

    const tieneExpedientesActivos = comp._count.expedientes > 0;

    // Siempre archivar; conservar identidad, documentos, relaciones y trazabilidad.
    const correlationId = crypto.randomUUID();
    const archivado = await this.prisma.compareciente.update({
      where: { id: dto.id },
      data: { archived_at: new Date(), estatus: 'ARCHIVADO' as any }
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: dto.usuario_id,
        accion: 'ARCHIVAR_COMPARECIENTE',
        entidad: 'Compareciente',
        entidad_id: dto.id,
        valores_nuevos: { archivado: true, motivo: dto.motivo || 'Sin motivo especificado' },
        detalles: {
          modulo: 'COMPARECIENTES',
          modo: 'ARCHIVADO',
          tenia_expedientes_activos: tieneExpedientesActivos,
          modo_solicitado: 'ARCHIVAR'
        },
        correlation_id: correlationId
      }
    });

    return { accion: 'ARCHIVADO', id: dto.id, archivado_at: archivado.archived_at };
  }

  /**
   * Vinculación contextual con Expediente
   */
  public async vincularAExpediente(dto: {
    expediente_id: string;
    compareciente_id: string;
    caracter_id: string;
    forma_comparecencia?: FormaComparecencia;
    observaciones?: string;
    creado_por_id: string;
  }) {
    if (!dto.expediente_id || !dto.compareciente_id || !dto.caracter_id) {
      throw new Error('expediente_id, compareciente_id y caracter_id son obligatorios para crear el vínculo.');
    }
    return await this.prisma.$transaction(async (tx) => {
      const existente = await tx.expedienteCompareciente.findFirst({
        where: {
          expediente_id: dto.expediente_id,
          compareciente_id: dto.compareciente_id,
          caracter_id: dto.caracter_id,
          archived_at: null
        }
      });

      if (existente) {
        if (existente.estatus === 'INACTIVO') {
          return await tx.expedienteCompareciente.update({
            where: { id: existente.id },
            data: {
              estatus: 'ACTIVO',
              forma_comparecencia: dto.forma_comparecencia || 'PROPIO_DERECHO',
              observaciones: dto.observaciones
            }
          });
        }
        return existente;
      }

      const vinculo = await tx.expedienteCompareciente.create({
        data: {
          expediente_id: dto.expediente_id,
          compareciente_id: dto.compareciente_id,
          caracter_id: dto.caracter_id,
          forma_comparecencia: dto.forma_comparecencia || 'PROPIO_DERECHO',
          observaciones: dto.observaciones,
          creado_por_id: dto.creado_por_id
        }
      });

      const correlationId = crypto.randomUUID();
      await tx.auditLog.create({
        data: {
          user_id: dto.creado_por_id,
          accion: 'VINCULAR_A_EXPEDIENTE',
          entidad: 'ExpedienteCompareciente',
          entidad_id: vinculo.id,
          valores_nuevos: JSON.parse(JSON.stringify(vinculo)),
          detalles: { modulo: 'COMPARECIENTES' },
          correlation_id: correlationId
        }
      });

      await tx.domainEventOutbox.create({
        data: {
          event_type: 'ComparecienteVinculadoAExpediente',
          aggregate_type: 'Expediente',
          aggregate_id: dto.expediente_id,
          payload: {
            expediente_id: dto.expediente_id,
            compareciente_id: dto.compareciente_id,
            caracter_id: dto.caracter_id,
            actor_user_id: dto.creado_por_id
          },
          correlation_id: correlationId
        }
      });

      return vinculo;
    });
  }

  /**
   * Retiro lógico del vínculo con el expediente sin eliminar la ficha maestra
   */
  public async desvincularDeExpediente(vinculoId: string, actorUserId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const vinculo = await tx.expedienteCompareciente.findUnique({
        where: { id: vinculoId }
      });

      if (!vinculo) {
        throw new Error(`El vínculo con ID '${vinculoId}' no existe.`);
      }

      const actualizado = await tx.expedienteCompareciente.update({
        where: { id: vinculoId },
        data: {
          estatus: 'INACTIVO',
          archived_at: new Date()
        }
      });

      const correlationId = crypto.randomUUID();
      await tx.auditLog.create({
        data: {
          user_id: actorUserId,
          accion: 'DESVINCULAR_DE_EXPEDIENTE',
          entidad: 'ExpedienteCompareciente',
          entidad_id: vinculoId,
          valores_anteriores: JSON.parse(JSON.stringify(vinculo)),
          valores_nuevos: JSON.parse(JSON.stringify(actualizado)),
          detalles: { modulo: 'COMPARECIENTES' },
          correlation_id: correlationId
        }
      });

      await tx.domainEventOutbox.create({
        data: {
          event_type: 'VinculoComparecienteRetirado',
          aggregate_type: 'Expediente',
          aggregate_id: vinculo.expediente_id,
          payload: {
            expediente_id: vinculo.expediente_id,
            compareciente_id: vinculo.compareciente_id,
            actor_user_id: actorUserId
          },
          correlation_id: correlationId
        }
      });

      return actualizado;
    });
  }

  /**
   * Confirmación humana contextual. La validación pertenece al vínculo con el
   * expediente y nunca convierte automáticamente propuestas de IA en datos definitivos.
   */
  public async validarVinculoExpediente(vinculoId: string, actorUserId: string, datosValidados: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const vinculo = await tx.expedienteCompareciente.findFirst({
        where: { id: vinculoId, archived_at: null, estatus: 'ACTIVO' },
      });
      if (!vinculo) throw new Error(`El vínculo con ID '${vinculoId}' no existe o no está activo.`);

      const actualizado = await tx.expedienteCompareciente.update({
        where: { id: vinculoId },
        data: {
          datos_validados: datosValidados,
          validado_por_id: datosValidados ? actorUserId : null,
          validado_at: datosValidados ? new Date() : null,
        },
      });
      const correlationId = crypto.randomUUID();
      await tx.auditLog.create({
        data: {
          user_id: actorUserId,
          accion: datosValidados ? 'VALIDAR_DATOS_COMPARECIENTE' : 'REABRIR_VALIDACION_COMPARECIENTE',
          entidad: 'ExpedienteCompareciente',
          entidad_id: vinculoId,
          valores_anteriores: { datos_validados: vinculo.datos_validados, validado_por_id: vinculo.validado_por_id },
          valores_nuevos: { datos_validados: actualizado.datos_validados, validado_por_id: actualizado.validado_por_id },
          detalles: { modulo: 'COMPARECIENTES', expediente_id: vinculo.expediente_id },
          correlation_id: correlationId,
        },
      });
      await tx.domainEventOutbox.create({
        data: {
          event_type: datosValidados ? 'DatosComparecienteValidados' : 'ValidacionComparecienteReabierta',
          aggregate_type: 'Expediente',
          aggregate_id: vinculo.expediente_id,
          actor_user_id: actorUserId,
          payload: { expediente_id: vinculo.expediente_id, compareciente_id: vinculo.compareciente_id, vinculo_id: vinculoId },
          correlation_id: correlationId,
        },
      });
      return actualizado;
    });
  }

  /**
   * Obtiene el Archivo Documental del Compareciente con URLs firmadas y agrupado por carpetas
   */
  public async obtenerArchivoDocumental(comparecienteId: string) {
    const compareciente = await this.prisma.compareciente.findUnique({
      where: { id: comparecienteId },
      include: {
        documentos: {
          where: { archived_at: null },
          include: {
            documento: true
          }
        },
        personaFisica: true,
        personaMoral: true
      }
    });

    if (!compareciente) throw new Error('Compareciente no encontrado');

    const isMoral = compareciente.tipo_persona === 'MORAL';
    const carpetasBase = isMoral
      ? ['Constitución', 'Fiscal', 'Domicilio', 'Representación', 'Registro Mercantil', 'Identificaciones', 'Otros']
      : ['Identificación', 'Fiscal', 'Domicilio', 'Estado Civil', 'Migratorio', 'Poderes', 'Otros'];

    const items: any[] = [];
    for (const link of compareciente.documentos) {
      const doc = link.documento;
      items.push({
        id: doc.id,
        link_id: link.id,
        nombre: doc.nombre_original,
        filename: doc.nombre_original,
        categoria: link.categoria,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        fecha_carga: doc.fecha_carga,
        estatus: doc.estatus,
        principal: link.principal,
        download_path: `/comparecientes/${comparecienteId}/documentos/${doc.id}/descargar`,
      });
    }

    return {
      compareciente_id: comparecienteId,
      tipo_persona: compareciente.tipo_persona,
      carpetas_sugeridas: carpetasBase,
      documentos: items
    };
  }

  /** Descarga autenticada: nunca expone storage_key ni URL interna al cliente. */
  public async descargarDocumento(comparecienteId: string, documentoId: string) {
    const link = await this.prisma.comparecienteDocumento.findFirst({
      where: { compareciente_id: comparecienteId, documento_id: documentoId, archived_at: null, estatus: 'ACTIVO' },
      include: { documento: true },
    });
    if (!link) throw new Error('El documento no está disponible para este compareciente.');
    const { downloadFile } = await import('./supabase.service');
    const buffer = await downloadFile(link.documento.storage_key);
    return { buffer, mimeType: link.documento.mime_type, fileName: link.documento.nombre_original };
  }

  /**
   * Sube y vincula un nuevo documento directamente al Archivo Documental del Compareciente
   */
  public async agregarDocumentoMaster(params: {
    comparecienteId: string;
    userId: string;
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    categoria?: string;
    fechaEmision?: string;
    fechaVencimiento?: string;
    observaciones?: string;
  }) {
    const { comparecienteId, userId, buffer, fileName, mimeType } = params;
    const categoria = params.categoria || 'OTROS';
    const allowedMimeTypes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/bmp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (!allowedMimeTypes.has(mimeType)) {
      throw new Error('Tipo de archivo no permitido. Usa PDF, JPG/JPEG, PNG, BMP, DOC o DOCX.');
    }
    if (!Object.values(TipoDocumentoCompareciente).includes(categoria as TipoDocumentoCompareciente)) {
      throw new Error('La categoría documental seleccionada no es válida.');
    }
    const [compareciente, actor] = await Promise.all([
      this.prisma.compareciente.findFirst({ where: { id: comparecienteId, archived_at: null }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { id: userId, activo: true }, select: { id: true } }),
    ]);
    if (!compareciente) throw new Error('Compareciente no encontrado o archivado.');
    if (!actor) throw new Error('Usuario activo requerido para cargar documentos.');

    const fechaEmision = validateOptionalDate(params.fechaEmision, 'La fecha de emisión');
    const fechaVencimiento = validateOptionalDate(params.fechaVencimiento, 'La fecha de vencimiento');
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'documento';
    const storageKey = `organizations/${requireActorContext().organizationId}/documentos/comparecientes/${comparecienteId}/${Date.now()}_${crypto.randomUUID()}_${safeFileName}`;
    const { uploadFile, deleteFile } = await import('./supabase.service');
    await uploadFile(buffer, storageKey, mimeType);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const docMaster = await tx.documento.create({
          data: {
            nombre_original: fileName,
            nombre_interno: storageKey,
            tipo: categoria,
            categoria: 'OTROS',
            mime_type: mimeType,
            size_bytes: buffer.length,
            storage_key: storageKey,
            fecha_emision: fechaEmision,
            fecha_vigencia: fechaVencimiento,
            observaciones: params.observaciones,
            estatus: 'PENDIENTE',
            subido_por_id: actor.id,
            compareciente_id: comparecienteId,
          },
        });

        const vinculo = await tx.comparecienteDocumento.create({
          data: {
            compareciente_id: comparecienteId,
            documento_id: docMaster.id,
            categoria: categoria as TipoDocumentoCompareciente,
            fecha_documento: fechaEmision,
            fecha_vencimiento: fechaVencimiento,
            observaciones: params.observaciones,
            creado_por_id: actor.id,
          },
        });
        await tx.auditLog.create({ data: {
          user_id: actor.id, accion: 'CARGAR_DOCUMENTO_COMPARECIENTE', entidad: 'ComparecienteDocumento', entidad_id: vinculo.id,
          valores_nuevos: { documento_id: docMaster.id, nombre: fileName, categoria },
          detalles: { modulo: 'COMPARECIENTES', compareciente_id: comparecienteId }, correlation_id: crypto.randomUUID(),
        } });
        return { docMaster, vinculo };
      });
    } catch (error) {
      try {
        await deleteFile(storageKey);
      } catch (cleanupError) {
        console.error('[COMPARECIENTE_DOCUMENT_STORAGE_CLEANUP_FAILED]', cleanupError);
      }
      throw error;
    }
  }

  /** Retiro lógico auditable: conserva el archivo maestro y su trazabilidad. */
  public async eliminarDocumentoMaster(comparecienteId: string, documentoId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.comparecienteDocumento.findFirst({
        where: { compareciente_id: comparecienteId, documento_id: documentoId, archived_at: null, estatus: 'ACTIVO' },
        include: { documento: { select: { nombre_original: true } } },
      });
      if (!link) throw new Error('El documento ya no está vinculado a este compareciente.');
      const archived = await tx.comparecienteDocumento.update({ where: { id: link.id }, data: { estatus: 'INACTIVO', archived_at: new Date() } });
      await tx.auditLog.create({ data: {
        user_id: actorUserId, accion: 'ELIMINAR_DOCUMENTO_COMPARECIENTE', entidad: 'ComparecienteDocumento', entidad_id: link.id,
        valores_anteriores: { documento_id: documentoId, nombre: link.documento.nombre_original, estatus: link.estatus },
        valores_nuevos: { estatus: 'INACTIVO', archivado: true },
        detalles: { modulo: 'COMPARECIENTES', compareciente_id: comparecienteId, eliminacion: 'LOGICA' }, correlation_id: crypto.randomUUID(),
      } });
      return archived;
    });
  }

  /**
   * Analiza todos los documentos activos de una ficha. Devuelve un borrador;
   * nunca modifica los datos maestros hasta que una persona guarda el formulario.
   */
  public async extraerDocumentosExistentesConIA(comparecienteId: string, actorUserId: string) {
    const links = await this.prisma.comparecienteDocumento.findMany({
      where: { compareciente_id: comparecienteId, archived_at: null, estatus: 'ACTIVO' },
      include: { documento: true },
    });
    if (!links.length) throw new Error('Carga al menos un documento antes de extraer información.');
    const { downloadFile } = await import('./supabase.service');
    const readable: DocumentoParaExtraccion[] = [];
    const skipped: string[] = [];
    for (const link of links) {
      try {
        const buffer = await downloadFile(link.documento.storage_key);
        if (!buffer.length) throw new Error('Archivo vacío');
        readable.push({ buffer, mimeType: link.documento.mime_type || 'application/octet-stream', tipoDocumento: String(link.categoria || link.documento.tipo || 'OTRO'), documentoId: link.documento.id, nombreOriginal: link.documento.nombre_original });
      } catch {
        skipped.push(link.documento.nombre_original);
      }
    }
    if (!readable.length) throw new Error('No fue posible leer los documentos disponibles.');
    const started = Date.now();
    try {
      const extraction = await extraerMultiplesDocumentos(readable);
      const consolidated = consolidateExtractedFields(extraction.campos || []);
      await recordAIUsages(extraction.usos || (extraction.uso ? [extraction.uso] : []), {
        operacion: 'COMPARECIENTE_DOCUMENT_EXTRACTION', usuarioId: actorUserId,
        metadata: { compareciente_id: comparecienteId, documentos: readable.length, omitidos: skipped.length },
      });
      await this.prisma.$transaction(async (tx) => {
        for (const [field, proposal] of Object.entries(consolidated.proposals)) {
          const alternatives = proposal.estado === 'EN_CONFLICTO' ? proposal.alternativas : [proposal];
          for (const alternative of alternatives) {
            await tx.comparecienteDatoFuente.create({ data: {
              compareciente_id: comparecienteId, campo: field, entidad_destino: 'ComparecienteWorkspace',
              valor_detectado: alternative.valor || null, documento_id: alternative.documento_id || null,
              proveedor_ia: extraction.proveedor, modelo_ia: extraction.modelo, confianza: alternative.confianza || null,
              estado: proposal.estado === 'EN_CONFLICTO' ? 'EN_CONFLICTO' : 'PENDIENTE_CONFIRMACION', correlation_id: crypto.randomUUID(),
            } });
          }
        }
        await tx.auditLog.create({ data: {
          user_id: actorUserId, accion: 'EXTRAER_DATOS_COMPARECIENTE_IA', entidad: 'Compareciente', entidad_id: comparecienteId,
          valores_nuevos: { campos_propuestos: Object.keys(consolidated.proposals), conflictos: consolidated.conflicts.length, documentos: readable.length },
          detalles: { modulo: 'COMPARECIENTES', persistencia_maestra: false }, correlation_id: crypto.randomUUID(),
        } });
      });
      return {
        values: consolidated.values, proposals: consolidated.proposals, conflicts: consolidated.conflicts,
        domicilios_detectados: extraction.domicilios_detectados || [], documentos_omitidos: skipped,
      };
    } catch (error) {
      await recordAIFailure({ operacion: 'COMPARECIENTE_DOCUMENT_EXTRACTION', usuarioId: actorUserId, modelo: process.env.OPENAI_DOCUMENT_MODEL || 'configured-document-model', durationMs: Date.now() - started, metadata: { compareciente_id: comparecienteId } });
      throw error;
    }
  }
}
