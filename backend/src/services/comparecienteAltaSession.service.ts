import crypto from 'crypto';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { uploadFile, deleteFile, downloadFile } from './supabase.service';
import {
  extraerMultiplesDocumentos,
  curpToFechaNacimiento,
  extraerFolioIneMrz,
  autoridadPorTipoDocumento,
  getOpenAIModelName,
  DocumentExtractionResult,
  DomicilioDetectado,
  DocumentoParaExtraccion
} from './openaiDocument.service';
import { validateCurp, validateOptionalDate, validateRfc } from '../domain/mexicanIdentity';
import { consolidateExtractedFields } from '../domain/documentExtraction';
import { recordAIFailure, recordAIUsages } from './aiUsage.service';

const EXPIRATION_HOURS = parseInt(process.env.COMPARECIENTE_ALTA_EXPIRATION_HOURS || '24', 10);

/**
 * Normaliza cualquier variante de sexo al valor exacto del enum Sexo de Prisma.
 * Acepta: H, HOMBRE, MASCULINO, M, MALE → MASCULINO
 *         M (sin ambigüedad por fallback), MUJER, FEMENINO, F, FEMALE → FEMENINO
 *         O, OTRO, OTHER, INDETERMINADO, NB, NO_BINARIO → OTRO
 * Si no se puede determinar, devuelve null (nunca envía un valor inválido a Prisma).
 */
function normalizarSexo(valor?: string | null): 'MASCULINO' | 'FEMENINO' | 'OTRO' | null {
  if (!valor) return null;
  const v = valor.trim().toUpperCase();

  // Masculino
  if (['MASCULINO', 'HOMBRE', 'MALE', 'H', 'M'].includes(v)) return 'MASCULINO';

  // Femenino — 'F' y 'MUJER' etc.
  if (['FEMENINO', 'MUJER', 'FEMALE', 'F'].includes(v)) return 'FEMENINO';

  // Otro
  if (['OTRO', 'OTHER', 'O', 'INDETERMINADO', 'NB', 'NO_BINARIO', 'NO BINARIO'].includes(v)) return 'OTRO';

  // No reconocido → null
  return null;
}

export class ComparecienteAltaSessionService {
  /**
   * Inicia o recupera una sesión de alta con idempotencia
   */
  static async iniciarOSentarseSesion(params: {
    usuario_id: string;
    tipo_persona?: 'FISICA' | 'MORAL';
    idempotency_key?: string;
    origen_expediente_id?: string;
    correlation_id?: string;
  }) {
    const { usuario_id, tipo_persona, idempotency_key, origen_expediente_id, correlation_id } = params;

    const userExists = await prisma.user.findUnique({ where: { id: usuario_id } });
    if (!userExists?.activo) throw new Error('La sesión no corresponde a un usuario activo.');
    const finalUsuarioId = usuario_id;

    if (idempotency_key) {
      const sesionExistente = await prisma.comparecienteAltaSession.findUnique({
        where: {
          usuario_id_idempotency_key: {
            usuario_id: finalUsuarioId,
            idempotency_key
          }
        },
        include: {
          cargasTemporales: {
            where: { archived_at: null }
          }
        }
      });

      if (sesionExistente) {
        if (sesionExistente.expires_at < new Date() || sesionExistente.estatus === 'EXPIRADO') {
          await prisma.comparecienteAltaSession.update({
            where: { id: sesionExistente.id },
            data: { estatus: 'EXPIRADO' }
          });
        } else {
          await prisma.comparecienteAltaSession.update({
            where: { id: sesionExistente.id },
            data: { ultima_actividad_at: new Date() }
          });
          return sesionExistente;
        }
      }
    }

    const expiresAt = new Date(Date.now() + EXPIRATION_HOURS * 60 * 60 * 1000);

    const nuevaSesion = await prisma.comparecienteAltaSession.create({
      data: {
        usuario_id: finalUsuarioId,
        tipo_persona: tipo_persona || 'FISICA',
        estatus: 'BORRADOR',
        origen_expediente_id: origen_expediente_id || null,
        idempotency_key: idempotency_key || null,
        correlation_id: correlation_id || `corr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        borrador_json: {
          tipo_persona: tipo_persona || 'FISICA',
          nacionalidad: 'Mexicana',
          pep_estado: 'PENDIENTE'
        },
        expires_at: expiresAt
      },
      include: {
        cargasTemporales: true
      }
    });

    return nuevaSesion;
  }

  /**
   * Obtiene la sesión activa y renueva el timestamp de actividad
   */
  static async obtenerSesion(sessionId: string) {
    const sesion = await prisma.comparecienteAltaSession.findUnique({
      where: { id: sessionId },
      include: {
        cargasTemporales: {
          where: { archived_at: null }
        }
      }
    });

    if (!sesion) throw new Error('Sesión de alta no encontrada');

    if (sesion.expires_at < new Date() || sesion.estatus === 'EXPIRADO') {
      await prisma.comparecienteAltaSession.update({
        where: { id: sessionId },
        data: { estatus: 'EXPIRADO' }
      });
      throw new Error('La sesión de alta ha expirado');
    }

    await prisma.comparecienteAltaSession.update({
      where: { id: sessionId },
      data: { ultima_actividad_at: new Date() }
    });

    return sesion;
  }

  /**
   * Actualiza el borrador incremental de la sesión
   */
  static async actualizarBorrador(sessionId: string, datosParciales: any) {
    const sesion = await this.obtenerSesion(sessionId);
    const borradorActual = (sesion.borrador_json as any) || {};

    const borradorActualizado = {
      ...borradorActual,
      ...datosParciales
    };

    return await prisma.comparecienteAltaSession.update({
      where: { id: sessionId },
      data: {
        borrador_json: borradorActualizado,
        tipo_persona: datosParciales.tipo_persona || sesion.tipo_persona,
        ultima_actividad_at: new Date()
      }
    });
  }

  /**
   * Carga de un documento temporal en Supabase Storage
   */
  static async subirDocumentoTemporal(params: {
    sessionId: string;
    usuarioId?: string;
    buffer: Buffer;
    nombreOriginal: string;
    mimeType: string;
    tipoDocumento: string;
  }) {
    const { sessionId, usuarioId, buffer, nombreOriginal, mimeType, tipoDocumento } = params;

    const sesion = await prisma.comparecienteAltaSession.findUnique({ where: { id: sessionId } });
    if (!sesion) throw new Error('Sesión de alta no encontrada');

    let finalUsuarioId = sesion.usuario_id;
    if (usuarioId) {
      const u = await prisma.user.findFirst({ where: { id: usuarioId, activo: true } });
      if (u) finalUsuarioId = u.id;
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const extension = path.extname(nombreOriginal) || '.pdf';
    const storageKey = `temporales/comparecientes/${sessionId}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}${extension}`;

    await uploadFile(buffer, storageKey, mimeType);

    try {
      const cargaTemporal = await prisma.cargaTemporalDocumento.create({
        data: {
          alta_session_id: sessionId,
          usuario_id: finalUsuarioId,
          tipo_documento: tipoDocumento || 'OTRO',
          nombre_original: nombreOriginal,
          storage_key_temporal: storageKey,
          mime_type: mimeType,
          tamano_bytes: buffer.length,
          sha256,
          estado: 'TEMPORAL',
          expires_at: sesion.expires_at
        }
      });
      return cargaTemporal;
    } catch (dbErr: any) {
      console.error('[subirDocumentoTemporal] Error registrando en DB. Rollback en Storage:', dbErr);
      try {
        await deleteFile(storageKey);
      } catch (storageErr) {
        console.warn('[subirDocumentoTemporal] Error en rollback Storage:', storageErr);
      }
      throw new Error(`Error de persistencia en base de datos: ${dbErr.message}`);
    }
  }

  /**
   * Elimina un documento temporal y crea Job de Compensación si falla
   */
  static async eliminarDocumentoTemporal(cargaId: string) {
    const carga = await prisma.cargaTemporalDocumento.findUnique({ where: { id: cargaId } });
    if (!carga) throw new Error('Documento temporal no encontrado');

    try {
      await deleteFile(carga.storage_key_temporal);
    } catch (err: any) {
      console.warn(`[Compensación] Error eliminando archivo de Storage: ${err.message}`);
      await prisma.storageCompensationJob.create({
        data: {
          carga_temporal_id: carga.id,
          storage_key: carga.storage_key_temporal,
          tipo_operacion: 'ELIMINAR_TEMPORAL',
          estatus: 'PENDIENTE',
          ultimo_error: err.message
        }
      });
    }

    return await prisma.cargaTemporalDocumento.update({
      where: { id: cargaId },
      data: {
        estado: 'DESCARTADO',
        archived_at: new Date()
      }
    });
  }

  /**
   * Clasifica individualmente un documento temporal
   */
  static async clasificarDocumentoTemporal(cargaId: string, tipoDocumento: string) {
    return await prisma.cargaTemporalDocumento.update({
      where: { id: cargaId },
      data: { tipo_documento: tipoDocumento }
    });
  }

  /**
   * Extrae datos de TODOS los documentos cargados mediante OpenAI (una sola llamada).
   *
   * REGLA PRAVIA: Si OpenAI no está disponible o falla, se lanza un error.
   * NO existe fallback local. NO se rellenan campos con datos simulados.
   */
  static async extraerDatosConIA(sessionId: string, documentoIds: string[], optionalBuffer?: Buffer) {
    const sesion = await prisma.comparecienteAltaSession.findUnique({ where: { id: sessionId } });
    if (!sesion) throw new Error('Sesión de alta no encontrada');

    const documentosSolicitados = Array.isArray(documentoIds) ? documentoIds : [];

    const cargasTemporales = await prisma.cargaTemporalDocumento.findMany({
      where: {
        alta_session_id: sessionId,
        id: documentosSolicitados.length > 0 ? { in: documentosSolicitados } : undefined,
        archived_at: null,
        estado: { in: ['TEMPORAL', 'PROCESADO'] }
      }
    });

    if (cargasTemporales.length === 0 && !optionalBuffer) {
      throw new Error('No hay documentos válidos en la sesión para analizar.');
    }

    await prisma.comparecienteAltaSession.update({
      where: { id: sessionId },
      data: { estatus: 'EN_EXTRACCION' }
    });

    // ── 1. DESCARGAR Y VALIDAR TODOS LOS ARCHIVOS REALES ──────────────────────
    const documentosParaIA: DocumentoParaExtraccion[] = [];
    const erroresCarga: any[] = [];

    for (const carga of cargasTemporales) {
      try {
        let buffer: Buffer | undefined;

        // Si se proporcionó un buffer externo y hay solo un doc, usarlo
        if (optionalBuffer && cargasTemporales.length === 1) {
          buffer = optionalBuffer;
        } else {
          buffer = await downloadFile(carga.storage_key_temporal);
        }

        // Validaciones básicas: no vacío, no fallback
        if (!buffer || buffer.length === 0) {
          throw new Error(`El archivo "${carga.nombre_original}" está vacío.`);
        }
        if (buffer.toString('utf8', 0, 16).includes('DOCUMENTO_FALLBACK')) {
          throw new Error(`El archivo "${carga.nombre_original}" contiene datos de prueba no válidos.`);
        }

        documentosParaIA.push({
          buffer,
          mimeType: carga.mime_type || 'application/pdf',
          tipoDocumento: carga.tipo_documento || 'OTRO',
          documentoId: carga.id,
          nombreOriginal: carga.nombre_original
        });
      } catch (loadErr: any) {
        console.error(`[extraerDatosConIA] No se pudo cargar "${carga.nombre_original}":`, loadErr.message);
        erroresCarga.push({
          documento_id: carga.id,
          nombre: carga.nombre_original,
          error: loadErr.message
        });
      }
    }

    if (documentosParaIA.length === 0) {
      throw new Error(
        'No fue posible ejecutar la extracción documental con IA. ' +
        'Ningún documento pudo descargarse correctamente. Los campos permanecen sin cambios.'
      );
    }

    // ── 2. LLAMADA ÚNICA A OPENAI CON TODOS LOS DOCUMENTOS ───────────────────
    // Si falla, el error se propaga sin fallback
    const aiStartedAt = Date.now();
    let resultadoIA: DocumentExtractionResult;
    try {
      resultadoIA = await extraerMultiplesDocumentos(documentosParaIA);
      await recordAIUsages(resultadoIA.usos || (resultadoIA.uso ? [resultadoIA.uso] : []), {
        operacion: 'EXTRACCION_COMPARECIENTE',
        usuarioId: sesion.usuario_id,
        expedienteId: sesion.origen_expediente_id,
        altaSessionId: sesion.id,
        escalamientoMotivo: 'Lectura dudosa o contradicción entre documentos',
        metadata: { documentos_solicitados: documentosParaIA.map((item) => item.documentoId) },
      }).catch((usageError) => console.error('[AI usage] No fue posible registrar el consumo:', usageError.message));
    } catch (error: any) {
      await recordAIFailure({
        operacion: 'EXTRACCION_COMPARECIENTE',
        modelo: getOpenAIModelName(),
        usuarioId: sesion.usuario_id,
        expedienteId: sesion.origen_expediente_id,
        altaSessionId: sesion.id,
        durationMs: Date.now() - aiStartedAt,
        errorCode: error.code || 'AI_EXTRACTION_FAILED',
      }).catch(() => undefined);
      await prisma.comparecienteAltaSession.update({ where: { id: sessionId }, data: { estatus: 'FALLIDO' } });
      throw error;
    }

    // ── 3. CONSOLIDAR CAMPOS CON TRAZABILIDAD ─────────────────────────────────
    const consolidacion = consolidateExtractedFields(resultadoIA.campos);
    const camposCombinados: Record<string, any> = { ...consolidacion.values };
    const propuestaRespuesta: Record<string, any> = { ...consolidacion.proposals };

    // ── 4. DERIVAR FECHA DE NACIMIENTO DESDE CURP si no viene del documento ──
    if (!camposCombinados.fecha_nacimiento && camposCombinados.curp) {
      const derivada = curpToFechaNacimiento(camposCombinados.curp);
      if (derivada) {
        camposCombinados.fecha_nacimiento = derivada;
        camposCombinados._fecha_nacimiento_fuente = 'Derivada de CURP';
        propuestaRespuesta.fecha_nacimiento = {
          valor: derivada,
          fuente: 'Derivada de CURP',
          confianza: 'LECTURA_CLARA',
          estado: 'DERIVADO',
          nota: 'Derivada de CURP'
        };
      }
    }

    // ── 4b. VIGENCIA INE: EXPEDICIÓN Y VENCIMIENTO (NORMALIZACIÓN PRAVIA) ─────
    if (camposCombinados.vigencia_ine) {
      const matchVig = camposCombinados.vigencia_ine.match(/(\d{4})\s*[-–]\s*(\d{4})/);
      if (matchVig) {
        const startYear = matchVig[1];
        const endYear = matchVig[2];
        if (!camposCombinados.fecha_expedicion_identificacion) {
          camposCombinados.fecha_expedicion_identificacion = `01/01/${startYear}`;
          propuestaRespuesta.fecha_expedicion_identificacion = {
            valor: `01/01/${startYear}`,
            fuente: 'Vigencia INE',
            confianza: 'LECTURA_CLARA',
            estado: 'DETECTADO'
          };
        }
        if (!camposCombinados.fecha_vencimiento_identificacion) {
          camposCombinados.fecha_vencimiento_identificacion = `31/12/${endYear}`;
          propuestaRespuesta.fecha_vencimiento_identificacion = {
            valor: `31/12/${endYear}`,
            fuente: 'Vigencia INE',
            confianza: 'LECTURA_CLARA',
            estado: 'DETECTADO'
          };
        }
      }
    }

    // ── 4c. DATOS DE CONTACTO (TELÉFONO Y CORREO ELECTRONICO) ─────────────────
    const telVal = camposCombinados.telefono || camposCombinados.celular || camposCombinados.telefono_1 || camposCombinados.numero_contacto;
    if (telVal) {
      camposCombinados.telefono = telVal;
    }
    const mailVal = camposCombinados.correo_electronico || camposCombinados.correo || camposCombinados.email || camposCombinados.correo_1;
    if (mailVal) {
      camposCombinados.correo = mailVal;
      camposCombinados.correo_electronico = mailVal;
    }

    // ── 5. AUTO-COMPLETAR AUTORIDAD EMISORA si no viene del documento ─────────
    const tipoIdCampo = camposCombinados.tipo_identificacion;
    if (!camposCombinados.autoridad_emisora) {
      const tieneINE = documentosParaIA.some(d =>
        d.tipoDocumento.toUpperCase().includes('INE') ||
        d.nombreOriginal.toUpperCase().includes('INE')
      );
      const tienePasaporte = documentosParaIA.some(d =>
        d.tipoDocumento.toUpperCase().includes('PASAPORTE')
      );

      if (tieneINE) {
        camposCombinados.autoridad_emisora = 'Instituto Nacional Electoral';
      } else if (tienePasaporte) {
        camposCombinados.autoridad_emisora = 'Secretaría de Relaciones Exteriores';
      }
    }

    // ── 6. SEPARAR DOMICILIOS POR TIPO (FISCAL / PARTICULAR / IDENTIFICACION) ─
    const domiciliosFiscales = (resultadoIA.domicilios_detectados || []).filter(
      d => d.tipo_sugerido === 'FISCAL'
    );
    const domiciliosParticulares = (resultadoIA.domicilios_detectados || []).filter(
      d => d.tipo_sugerido === 'COMPROBADO'
    );
    const domiciliosIdentificacion = (resultadoIA.domicilios_detectados || []).filter(
      d => d.tipo_sugerido === 'IDENTIFICACION'
    );

    // Colocar en el borrador domicilios separados con campos explícitos
    const domFiscal = domiciliosFiscales[0] || null;
    const domParticular = domiciliosParticulares[0] || null;
    const domIdent = domiciliosIdentificacion[0] || null;

    const borradorLimpio = { ...(sesion.borrador_json as any) || {} };
    for (const conflicto of consolidacion.conflicts) delete borradorLimpio[conflicto.campo];
    // Limpiar únicamente campos no acreditables documentalmente salvo que vengan de IA
    delete borradorLimpio.tratamiento;
    delete borradorLimpio.aliases;
    delete borradorLimpio.escolaridad;
    delete borradorLimpio.correo;
    delete borradorLimpio.telefono;
    delete borradorLimpio.regimen_matrimonial;

    // Asegurar que giro no retenga valores mock salvo acreditación documental
    if (!camposCombinados.giro) {
      camposCombinados.giro = '';
    }

    const borradorMejorado = {
      ...borradorLimpio,
      ...camposCombinados,
      tipo_persona: resultadoIA.tipo_persona_detectado || borradorLimpio.tipo_persona || sesion.tipo_persona || 'FISICA',
      pep_estado: 'PENDIENTE',

      // Domicilio PARTICULAR (de comprobante de domicilio)
      ...(domParticular ? {
        dom_particular_calle: domParticular.calle || '',
        dom_particular_exterior: domParticular.numero_exterior || '',
        dom_particular_interior: domParticular.numero_interior || '',
        dom_particular_colonia: domParticular.colonia || '',
        dom_particular_cp: domParticular.codigo_postal || '',
        dom_particular_municipio: domParticular.municipio || '',
        dom_particular_ciudad: domParticular.ciudad || domParticular.localidad || domParticular.municipio || '',
        dom_particular_estado: domParticular.estado || '',
        dom_particular_pais: domParticular.pais || 'México',
        dom_particular_fuente: domParticular.fuente || ''
      } : {}),

      // Domicilio FISCAL (de CSF)
      ...(domFiscal ? {
        dom_fiscal_calle: domFiscal.calle || '',
        dom_fiscal_exterior: domFiscal.numero_exterior || '',
        dom_fiscal_interior: domFiscal.numero_interior || '',
        dom_fiscal_colonia: domFiscal.colonia || '',
        dom_fiscal_cp: domFiscal.codigo_postal || '',
        dom_fiscal_municipio: domFiscal.municipio || '',
        dom_fiscal_ciudad: domFiscal.ciudad || domFiscal.localidad || domFiscal.municipio || '',
        dom_fiscal_estado: domFiscal.estado || '',
        dom_fiscal_pais: domFiscal.pais || 'México',
        dom_fiscal_fuente: domFiscal.fuente || ''
      } : {}),

      // Domicilio de IDENTIFICACION (de INE) — referencia únicamente
      ...(domIdent ? {
        dom_ident_calle: domIdent.calle || '',
        dom_ident_colonia: domIdent.colonia || '',
        dom_ident_cp: domIdent.codigo_postal || '',
        dom_ident_municipio: domIdent.municipio || '',
        dom_ident_estado: domIdent.estado || '',
        dom_ident_fuente: domIdent.fuente || ''
      } : {}),

      // Lista completa para el flujo de confirmación
      domicilios_detectados: resultadoIA.domicilios_detectados || [],
      actividades_economicas: resultadoIA.actividades_economicas || [],
      regimenes: resultadoIA.regimenes || [],
      _ia_resumen: resultadoIA.resumen_ejecutivo || `Extracción completada sobre ${documentosParaIA.length} documentos.`,
      _ia_alertas: resultadoIA.alertas || [],
      _ia_conflictos: consolidacion.conflicts,
      _ia_propuesta: propuestaRespuesta,
      _ia_proveedor: resultadoIA.proveedor,
      _ia_modelo: resultadoIA.modelo,
      _ia_uso: resultadoIA.uso || null,
      _ia_usos: resultadoIA.usos || (resultadoIA.uso ? [resultadoIA.uso] : []),
    };

    await prisma.comparecienteAltaSession.update({
      where: { id: sessionId },
      data: {
        estatus: 'PENDIENTE_CONFIRMACION',
        borrador_json: borradorMejorado,
        tipo_persona: resultadoIA.tipo_persona_detectado || sesion.tipo_persona
      }
    });

    // Marcar documentos como PROCESADO
    for (const doc of documentosParaIA) {
      await prisma.cargaTemporalDocumento.update({
        where: { id: doc.documentoId },
        data: { estado: 'PROCESADO' }
      });
    }

    return {
      success: true,
      procesados: documentosParaIA.length,
      errores: erroresCarga,
      sesion_id: sessionId,
      propuesta: propuestaRespuesta,
      conflictos: consolidacion.conflicts,
      domicilios_detectados: resultadoIA.domicilios_detectados || [],
      resultado: {
        proveedor: resultadoIA.proveedor,
        modelo: resultadoIA.modelo,
        tipo_persona_detectado: resultadoIA.tipo_persona_detectado || 'FISICA',
        resumen_ejecutivo: resultadoIA.resumen_ejecutivo || '',
        alertas: resultadoIA.alertas || [],
        campos: resultadoIA.campos,
        uso: resultadoIA.uso || null,
        usos: resultadoIA.usos || (resultadoIA.uso ? [resultadoIA.uso] : []),
      },
      borrador_actualizado: borradorMejorado
    };
  }


  /**
   * Confirma la sesión y registra el compareciente definitivo en PostgreSQL
   */
  static async confirmarAltaDefinitiva(params: {
    sessionId: string;
    usuarioId?: string;
    datosFormulario: any;
    documentosIntegrarIds: string[];
  }) {
    const { sessionId, usuarioId, datosFormulario, documentosIntegrarIds } = params;

    const sesion = await this.obtenerSesion(sessionId);
    let finalUsuarioId = sesion.usuario_id;

    if (usuarioId) {
      const u = await prisma.user.findUnique({ where: { id: usuarioId } });
      if (u) finalUsuarioId = u.id;
    }

    const {
      tipo_persona,
      tratamiento,
      nombre,
      apellido_paterno,
      apellido_materno,
      aliases,
      curp,
      rfc,
      sexo,
      fecha_nacimiento,
      lugar_nacimiento,
      pais_nacimiento,
      nacionalidad,
      estado_civil,
      regimen_matrimonial,
      escolaridad,
      ocupacion,
      actividad_economica,
      giro,
      pep_estado,
      relacion_pep,
      telefono,
      correo,

      // Identificación
      tipo_identificacion,
      folio_identificacion,
      autoridad_emisora,
      pais_emisor,
      fecha_expedicion_identificacion,
      fecha_vencimiento_identificacion,
      identificacion_principal,

      // Domicilio
      domicilio_pais,
      domicilio_estado,
      domicilio_municipio,
      domicilio_ciudad,
      domicilio_colonia,
      domicilio_calle,
      domicilio_exterior,
      domicilio_interior,
      domicilio_cp,
      domicilio_referencias,
      tipo_domicilio,
      documento_soporte_domicilio,
      observaciones,

      // Moral
      razon_social,
      nombre_comercial,
      tipo_societario,
      nacionalidad_moral,
      pais_constitucion,
      fecha_constitucion,
      duracion_moral,
      objeto_social_resumido,
      escritura_constitutiva,
      fecha_escritura,
      notario_nombre,
      numero_notaria,
      municipio_notaria,
      estado_notaria,
      folio_mercantil,
      fecha_inscripcion,
      domicilio_social_fiscal,
      representante_nombre,
      instrumento_representacion
    } = datosFormulario;

    const esFisica = tipo_persona === 'FISICA';
    const nombreCompleto = esFisica ? `${nombre || ''} ${apellido_paterno || ''} ${apellido_materno || ''}`.trim() : (razon_social || '');
    if (!nombreCompleto) throw new Error(esFisica ? 'El nombre de la persona física es obligatorio.' : 'La razón social es obligatoria.');
    const cleanCurp = esFisica ? validateCurp(curp) : null;
    const cleanRfc = validateRfc(rfc, esFisica ? 'FISICA' : 'MORAL');
    const birthDate = esFisica ? validateOptionalDate(fecha_nacimiento, 'La fecha de nacimiento') : null;
    const incorporationDate = !esFisica ? validateOptionalDate(fecha_constitucion, 'La fecha de constitución') : null;

    return await prisma.$transaction(async (tx) => {
      const identityKey = cleanCurp || cleanRfc || nombreCompleto.toUpperCase();
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:compareciente:${identityKey}`}))`);
      const duplicate = esFisica
        ? await tx.personaFisica.findFirst({
            where: {
              archived_at: null,
              OR: [
                ...(cleanCurp ? [{ curp: { equals: cleanCurp, mode: 'insensitive' as const } }] : []),
                ...(cleanRfc ? [{ rfc: { equals: cleanRfc, mode: 'insensitive' as const } }] : []),
              ],
            },
            select: { compareciente_id: true },
          })
        : cleanRfc
          ? await tx.personaMoral.findFirst({
              where: { archived_at: null, rfc: { equals: cleanRfc, mode: 'insensitive' } },
              select: { compareciente_id: true },
            })
          : null;
      if (duplicate) {
        throw new Error(`Ya existe un compareciente con el mismo identificador (${duplicate.compareciente_id}). Vincula el registro existente.`);
      }

      // 1. Crear Compareciente Maestro
      const compareciente = await tx.compareciente.create({
        data: {
          tipo_persona: tipo_persona || 'FISICA',
          nombre_busqueda: nombreCompleto.toUpperCase(),
          estatus: 'ACTIVO',
          creado_por_id: finalUsuarioId
        }
      });

      // 2. Si es Persona Física, crear perfil PersonaFisica
      if (esFisica) {
        // Normalizar sexo al enum exacto de Prisma (MASCULINO | FEMENINO | OTRO | null)
        const sexoNormalizado = normalizarSexo(sexo);
        await tx.personaFisica.create({
          data: {
            compareciente_id: compareciente.id,
            nombre,
            apellido_paterno: apellido_paterno || null,
            apellido_materno: apellido_materno || null,
            nombre_completo_calculado: nombreCompleto,
            sexo: sexoNormalizado,
            fecha_nacimiento: birthDate,
            lugar_nacimiento: lugar_nacimiento || null,
            pais_nacimiento: pais_nacimiento || null,
            nacionalidad: nacionalidad || 'Mexicana',
            curp: cleanCurp,
            rfc: cleanRfc,
            estado_civil: estado_civil || null,
            regimen_matrimonial: estado_civil === 'CASADO' ? regimen_matrimonial : null,
            escolaridad: escolaridad || null,
            ocupacion: ocupacion || null,
            actividad_economica: actividad_economica || null,
            giro: giro || null,
            pep: pep_estado === 'SI',
            pep_estado: pep_estado || 'PENDIENTE',
            relacion_pep: pep_estado === 'SI' ? relacion_pep : null
          }
        });
      } else {
        // 3. Si es Persona Moral, crear perfil PersonaMoral
        await tx.personaMoral.create({
          data: {
            compareciente_id: compareciente.id,
            razon_social,
            nombre_comercial: nombre_comercial || null,
            tipo_societario: tipo_societario || null,
            rfc: cleanRfc,
            nacionalidad: nacionalidad_moral || 'Mexicana',
            fecha_constitucion: incorporationDate,
            duracion: duracion_moral || 'Indefinida',
            objeto_social_resumido: objeto_social_resumido || null
          }
        });
      }

      for (const [index, alias] of (Array.isArray(aliases) ? aliases : []).map((value: unknown) => String(value).trim()).filter(Boolean).entries()) {
        await tx.comparecienteAlias.create({
          data: { compareciente_id: compareciente.id, alias, principal: index === 0 },
        });
      }

      const contactValues = [
        telefono ? { tipo: 'TELEFONO' as const, valor: String(telefono).trim() } : null,
        correo ? { tipo: 'CORREO' as const, valor: String(correo).trim().toLowerCase() } : null,
      ].filter((value): value is { tipo: 'TELEFONO' | 'CORREO'; valor: string } => Boolean(value?.valor));
      for (const [index, contact] of contactValues.entries()) {
        await tx.comparecienteContacto.create({
          data: {
            compareciente_id: compareciente.id,
            tipo: contact.tipo,
            valor: contact.valor,
            principal: index === 0,
            creado_por_id: finalUsuarioId,
          },
        });
      }

      // 4. Crear Domicilios (PARTICULAR y FISCAL) desde el formulario y/o borrador de IA
      const {
        dom_particular_calle, dom_particular_exterior, dom_particular_interior,
        dom_particular_colonia, dom_particular_cp, dom_particular_municipio,
        dom_particular_estado, dom_particular_pais, dom_particular_referencias,
        dom_particular_documento,

        dom_fiscal_calle, dom_fiscal_exterior, dom_fiscal_interior,
        dom_fiscal_colonia, dom_fiscal_cp, dom_fiscal_municipio,
        dom_fiscal_estado, dom_fiscal_pais, dom_fiscal_referencias,
        dom_fiscal_documento
      } = datosFormulario;

      // Fallback a los campos genéricos si no vienen prefijados
      const partCalle = dom_particular_calle || domicilio_calle;
      const partExterior = dom_particular_exterior || domicilio_exterior;
      const partInterior = dom_particular_interior || domicilio_interior;
      const partColonia = dom_particular_colonia || domicilio_colonia;
      const partCp = dom_particular_cp || domicilio_cp;
      const partMunicipio = dom_particular_municipio || domicilio_municipio;
      const partEstado = dom_particular_estado || domicilio_estado;
      const partPais = dom_particular_pais || domicilio_pais || 'México';
      const partRef = dom_particular_referencias || domicilio_referencias;
      const partDoc = dom_particular_documento || documento_soporte_domicilio;

      let creoParticular = false;
      if (partCalle || partColonia || partCp || partMunicipio) {
        await tx.comparecienteDomicilio.create({
          data: {
            compareciente_id: compareciente.id,
            tipo: 'PARTICULAR',
            calle: partCalle || null,
            exterior: partExterior || null,
            interior: partInterior || null,
            colonia: partColonia || null,
            codigo_postal: partCp || null,
            municipio: partMunicipio || null,
            estado: partEstado || null,
            pais: partPais || 'México',
            referencia: partRef || null,
            comprobado: Boolean(partDoc),
            principal: true,
            creado_por_id: finalUsuarioId
          }
        });
        creoParticular = true;
      }

      if (dom_fiscal_calle || dom_fiscal_colonia || dom_fiscal_cp || dom_fiscal_municipio) {
        await tx.comparecienteDomicilio.create({
          data: {
            compareciente_id: compareciente.id,
            tipo: 'FISCAL',
            calle: dom_fiscal_calle || null,
            exterior: dom_fiscal_exterior || null,
            interior: dom_fiscal_interior || null,
            colonia: dom_fiscal_colonia || null,
            codigo_postal: dom_fiscal_cp || null,
            municipio: dom_fiscal_municipio || null,
            estado: dom_fiscal_estado || null,
            pais: dom_fiscal_pais || 'México',
            referencia: dom_fiscal_referencias || null,
            comprobado: Boolean(dom_fiscal_documento),
            principal: !creoParticular,
            creado_por_id: finalUsuarioId
          }
        });
      }

      // Si no se creó ninguno desde los datos explícitos del formulario, revisar borradorJson.domicilios_detectados
      if (!creoParticular && !dom_fiscal_calle) {
        const borradorJson = (sesion.borrador_json as any) || {};
        const domiciliosDetectados: any[] = borradorJson.domicilios_detectados || [];
        const TIPO_MAP: Record<string, string> = {
          FISCAL: 'FISCAL',
          COMPROBADO: 'PARTICULAR',
          IDENTIFICACION: 'OTRO'
        };

        for (let i = 0; i < domiciliosDetectados.length; i++) {
          const d = domiciliosDetectados[i];
          const tipoDB = TIPO_MAP[d.tipo_sugerido] || 'PARTICULAR';
          await tx.comparecienteDomicilio.create({
            data: {
              compareciente_id: compareciente.id,
              tipo: tipoDB as any,
              calle: d.calle || null,
              exterior: d.numero_exterior || null,
              interior: d.numero_interior || null,
              colonia: d.colonia || null,
              codigo_postal: d.codigo_postal || null,
              municipio: d.municipio || null,
              estado: d.estado || null,
              pais: d.pais || 'México',
              comprobado: d.tipo_sugerido === 'COMPROBADO',
              principal: i === 0,
              creado_por_id: finalUsuarioId
            }
          });
        }
      }


      // 5. Crear Identificación Oficial si se proporcionó folio o tipo
      if (folio_identificacion) {
        await tx.comparecienteIdentificacion.create({
          data: {
            compareciente_id: compareciente.id,
            tipo_identificacion: tipo_identificacion || 'INE',
            numero: folio_identificacion,
            autoridad_emisora: autoridad_emisora || null,
            pais_emisor: pais_emisor || 'México',
            fecha_expedicion: fecha_expedicion_identificacion ? new Date(fecha_expedicion_identificacion) : null,
            fecha_vencimiento: fecha_vencimiento_identificacion ? new Date(fecha_vencimiento_identificacion) : null,
            principal: identificacion_principal !== false,
            creado_por_id: finalUsuarioId
          }
        });
      }

      // 6. Integrar documentos temporales seleccionados al Archivo Documental definitivo
      let docsIntegradosCount = 0;
      const documentosDefinitivos = new Map<string, string>();
      if (Array.isArray(documentosIntegrarIds) && documentosIntegrarIds.length > 0) {
        const temporalesIntegrar = await tx.cargaTemporalDocumento.findMany({
          where: {
            id: { in: documentosIntegrarIds },
            alta_session_id: sessionId,
            archived_at: null
          }
        });

        for (const tempDoc of temporalesIntegrar) {
          const docMaestro = await tx.documento.create({
            data: {
              nombre_original: tempDoc.nombre_original,
              nombre_interno: path.basename(tempDoc.storage_key_temporal),
              tipo: tempDoc.tipo_documento,
              categoria: 'PROYECTO',
              storage_key: tempDoc.storage_key_temporal,
              mime_type: tempDoc.mime_type,
              size_bytes: tempDoc.tamano_bytes,
              subido_por_id: finalUsuarioId
            }
          });

          await tx.comparecienteDocumento.create({
            data: {
              compareciente_id: compareciente.id,
              documento_id: docMaestro.id,
              categoria: 'IDENTIFICACION',
              creado_por_id: finalUsuarioId
            }
          });
          documentosDefinitivos.set(tempDoc.id, docMaestro.id);

          await tx.cargaTemporalDocumento.update({
            where: { id: tempDoc.id },
            data: { estado: 'CONFIRMADO' }
          });

          docsIntegradosCount++;
        }
      }

      // 7. Conservar la procedencia de cada propuesta, incluso si fue corregida o quedó en conflicto.
      const borradorIA = (sesion.borrador_json as any) || {};
      const propuestaIA = borradorIA._ia_propuesta && typeof borradorIA._ia_propuesta === 'object'
        ? borradorIA._ia_propuesta as Record<string, any>
        : {};
      const cargasSesion = new Set(sesion.cargasTemporales.map((item) => item.id));
      const normalizeSourceValue = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
      for (const [campo, propuesta] of Object.entries(propuestaIA)) {
        const alternatives = propuesta?.estado === 'EN_CONFLICTO' && Array.isArray(propuesta.alternativas)
          ? propuesta.alternativas
          : [propuesta];
        for (const alternative of alternatives) {
          const tempId = cargasSesion.has(alternative?.documento_id) ? alternative.documento_id : null;
          const detected = alternative?.valor === undefined ? null : String(alternative.valor);
          const confirmed = datosFormulario[campo] === undefined ? null : String(datosFormulario[campo]);
          const sourceState = propuesta?.estado === 'EN_CONFLICTO'
            ? confirmed === null || confirmed.trim() === ''
              ? 'EN_CONFLICTO'
              : normalizeSourceValue(confirmed) === normalizeSourceValue(detected)
                ? 'CONFIRMADO'
                : 'DESCARTADO'
            : confirmed === null || confirmed.trim() === ''
              ? 'DESCARTADO'
              : normalizeSourceValue(confirmed) === normalizeSourceValue(detected)
                ? 'CONFIRMADO'
                : 'EDITADO_MANUALMENTE';
          await tx.comparecienteDatoFuente.create({
            data: {
              compareciente_id: compareciente.id,
              campo,
              entidad_destino: esFisica ? 'PersonaFisica' : 'PersonaMoral',
              valor_detectado: detected,
              valor_confirmado: sourceState === 'EN_CONFLICTO' ? null : confirmed,
              documento_id: tempId ? documentosDefinitivos.get(tempId) || null : null,
              carga_temporal_id: tempId,
              proveedor_ia: borradorIA._ia_proveedor || 'OpenAI',
              modelo_ia: borradorIA._ia_modelo || null,
              confianza: alternative?.confianza || null,
              estado: sourceState as any,
              confirmado_por_id: sourceState === 'CONFIRMADO' || sourceState === 'EDITADO_MANUALMENTE' ? finalUsuarioId : null,
              confirmado_at: sourceState === 'CONFIRMADO' || sourceState === 'EDITADO_MANUALMENTE' ? new Date() : null,
              correlation_id: sesion.correlation_id,
            },
          });
        }
        const confirmedConflictValue = datosFormulario[campo] === undefined ? '' : String(datosFormulario[campo]).trim();
        const matchesAlternative = alternatives.some((alternative: any) => normalizeSourceValue(alternative?.valor) === normalizeSourceValue(confirmedConflictValue));
        if (propuesta?.estado === 'EN_CONFLICTO' && confirmedConflictValue && !matchesAlternative) {
          await tx.comparecienteDatoFuente.create({
            data: {
              compareciente_id: compareciente.id,
              campo,
              entidad_destino: esFisica ? 'PersonaFisica' : 'PersonaMoral',
              valor_confirmado: confirmedConflictValue,
              proveedor_ia: borradorIA._ia_proveedor || 'OpenAI',
              modelo_ia: borradorIA._ia_modelo || null,
              estado: 'EDITADO_MANUALMENTE',
              confirmado_por_id: finalUsuarioId,
              confirmado_at: new Date(),
              correlation_id: sesion.correlation_id,
            },
          });
        }
      }

      // 8. Marcar sesión como COMPLETADA
      await tx.comparecienteAltaSession.update({
        where: { id: sessionId },
        data: {
          estatus: 'COMPLETADO',
          confirmado_at: new Date()
        }
      });

      return {
        compareciente,
        docs_integrados_count: docsIntegradosCount
      };
    });
  }

  /**
   * Descarga un documento temporal desde Supabase y lo devuelve como Buffer
   * para servirlo en streaming al frontend (evita CORS y URL firmadas)
   */
  static async streamDocumentoTemporal(cargaId: string) {
    const carga = await prisma.cargaTemporalDocumento.findUnique({ where: { id: cargaId } });
    if (!carga) throw new Error('Documento temporal no encontrado');
    if (carga.archived_at) throw new Error('Este documento ha sido archivado y no está disponible');

    const buffer = await downloadFile(carga.storage_key_temporal);

    return {
      buffer,
      mimeType: carga.mime_type || 'application/pdf',
      fileName: carga.nombre_original,
      tamano: carga.tamano_bytes
    };
  }

  /**
   * Cancela la sesión de alta y encola limpieza de almacenamiento
   */
  static async cancelarSesion(sessionId: string) {
    const sesion = await prisma.comparecienteAltaSession.findUnique({
      where: { id: sessionId },
      include: { cargasTemporales: true }
    });

    if (!sesion) throw new Error('Sesión de alta no encontrada');

    for (const carga of sesion.cargasTemporales) {
      try {
        await deleteFile(carga.storage_key_temporal);
      } catch (err: any) {
        await prisma.storageCompensationJob.create({
          data: {
            carga_temporal_id: carga.id,
            storage_key: carga.storage_key_temporal,
            tipo_operacion: 'ELIMINAR_TEMPORAL',
            estatus: 'PENDIENTE',
            ultimo_error: err.message
          }
        });
      }
    }

    return await prisma.comparecienteAltaSession.update({
      where: { id: sessionId },
      data: {
        estatus: 'CANCELADO',
        cancelado_at: new Date()
      }
    });
  }
}
