import dotenv from 'dotenv';
import mammoth from 'mammoth';
dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS PÚBLICOS
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedField {
  campo: string;
  valor: string;
  confianza: 'LECTURA_CLARA' | 'LECTURA_DUDOSA' | 'LECTURA_DEFICIENTE';
  pagina?: number;
  fragmento?: string;
  fuente?: string;
  documento_id?: string;
}

export interface DomicilioDetectado {
  tipo_sugerido: 'FISCAL' | 'COMPROBADO' | 'IDENTIFICACION';
  fuente: string;
  documento_id?: string;
  calle?: string;
  numero_exterior?: string;
  numero_interior?: string;
  colonia?: string;
  codigo_postal?: string;
  municipio?: string;
  ciudad?: string;
  localidad?: string;
  estado?: string;
  pais?: string;
}

export interface DocumentExtractionResult {
  proveedor: string;
  modelo: string;
  tipo_persona_detectado?: 'FISICA' | 'MORAL';
  campos: ExtractedField[];
  resumen_ejecutivo?: string;
  alertas: string[];
  domicilios_detectados?: DomicilioDetectado[];
  actividades_economicas?: Array<{ actividad: string; porcentaje?: string; tipo?: string }>;
  regimenes?: string[];
  uso?: AIUsageMetrics;
  usos?: AIUsageMetrics[];
}

export interface DocumentoParaExtraccion {
  buffer: Buffer;
  mimeType: string;
  tipoDocumento: string;
  documentoId: string;
  nombreOriginal: string;
}

export interface ProyectoObservation {
  nivel_riesgo: 'ALTO' | 'MEDIO' | 'INFORMATIVO';
  dato_proyecto: string;
  dato_fuente: string;
  documento_fuente: string;
  ubicacion: string;
  tipo_discrepancia: string;
  recomendacion: string;
}

export interface ProyectoAnalysisResult {
  proveedor: 'OpenAI';
  modelo: string;
  resumen_ejecutivo: string;
  observaciones: ProyectoObservation[];
  documentos_no_leidos: string[];
  uso?: AIUsageMetrics;
}

export interface AIUsageMetrics {
  modelo: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  duracion_ms: number;
  documentos_enviados: number;
  costo_estimado_usd: number;
  precios_version: string;
  escalamiento_utilizado: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DETERMINÍSTICOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrae el folio de la INE desde la cadena MRZ.
 * Formato real: IDMEX{OCR}<<{FOLIO}
 * Ejemplo: IDMEX2930005777<<3065027154335 -> devuelve "3065027154335"
 *
 * Regla PRAVIA:
 * - Localizar línea que inicia con IDMEX
 * - Encontrar separador <<
 * - Tomar únicamente el bloque numérico posterior
 * - Detenerse antes de cualquier carácter no numérico
 */
export function extraerFolioIneMrz(texto: string): string | null {
  const normalizado = texto
    .toUpperCase()
    .replace(/\s+/g, '');

  const match = normalizado.match(/IDMEX[A-Z0-9]*<<([0-9]+)/);
  return match?.[1] ?? null;
}

/**
 * Deriva la fecha de nacimiento desde el CURP.
 * Formato: XXXX + YY + MM + DD + ...
 * Regla de siglo: si YY <= año actual (últimos 2 dígitos) -> 2000s; si no -> 1900s
 *
 * Ejemplo: GOMG760325HNTNRB04 -> "1976-03-25"
 */
export function curpToFechaNacimiento(
  curp: string,
  currentYear: number = new Date().getFullYear()
): string | null {
  const match = curp
    .toUpperCase()
    .match(/^[A-Z]{4}(\d{2})(\d{2})(\d{2})/);

  if (!match) return null;

  const yy = Number(match[1]);
  const mm = Number(match[2]);
  const dd = Number(match[3]);

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const currentYY = currentYear % 100;
  const century = yy <= currentYY ? 2000 : 1900;
  const year = century + yy;

  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  ) {
    return null;
  }

  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Determina la autoridad emisora según el tipo de documento.
 */
export function autoridadPorTipoDocumento(tipoDoc: string): string | null {
  const t = tipoDoc.toUpperCase();
  if (t.includes('INE') || t.includes('ELECTOR') || t.includes('IFE')) {
    return 'Instituto Nacional Electoral';
  }
  if (t.includes('PASAPORTE')) {
    return 'Secretaría de Relaciones Exteriores';
  }
  if (t.includes('CEDULA') || t.includes('PROFESIONAL')) {
    return 'Dirección General de Profesiones - SEP';
  }
  if (t.includes('MIGRATORIO') || t.includes('MIGRA')) {
    return 'Instituto Nacional de Migración';
  }
  return null;
}

/**
 * Retorna el modelo de OpenAI utilizado para análisis documental.
 */
export function getOpenAIModelName(): string {
  const configured = (process.env.OPENAI_DOCUMENT_MODEL || process.env.AI_DOCUMENT_MODEL || '').trim();
  return /^gpt-5\.4-nano(?:-|$)/.test(configured) ? configured : 'gpt-5.4-nano';
}

export function getOpenAIEscalationModelName(): string {
  const configured = (process.env.OPENAI_ESCALATION_MODEL || '').trim();
  return /^gpt-5\.4-mini(?:-|$)/.test(configured) ? configured : 'gpt-5.4-mini';
}

function getReasoningEffort(): 'none' | 'low' | 'medium' | 'high' | 'xhigh' {
  const configured = (process.env.OPENAI_REASONING_EFFORT || 'high').trim().toLowerCase();
  return ['none', 'low', 'medium', 'high', 'xhigh'].includes(configured)
    ? configured as 'none' | 'low' | 'medium' | 'high' | 'xhigh'
    : 'high';
}

const OPENAI_PRICING_USD_PER_MILLION: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.4-nano': { input: 0.20, cached: 0.02, output: 1.25 },
  'gpt-5.4-nano-2026-03-17': { input: 0.20, cached: 0.02, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.50 },
  'gpt-5.4-mini-2026-03-17': { input: 0.75, cached: 0.075, output: 4.50 },
};

function buildUsageMetrics(
  data: any,
  model: string,
  startedAt: number,
  documentCount: number,
  escalated = false
): AIUsageMetrics {
  const inputTokens = Number(data?.usage?.input_tokens || 0);
  const cachedInputTokens = Number(data?.usage?.input_tokens_details?.cached_tokens || 0);
  const outputTokens = Number(data?.usage?.output_tokens || 0);
  const reasoningTokens = Number(data?.usage?.output_tokens_details?.reasoning_tokens || 0);
  const totalTokens = Number(data?.usage?.total_tokens || inputTokens + outputTokens);
  const pricing = OPENAI_PRICING_USD_PER_MILLION[model];
  const regularInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const estimatedCost = pricing
    ? ((regularInputTokens * pricing.input) + (cachedInputTokens * pricing.cached) + (outputTokens * pricing.output)) / 1_000_000
    : 0;

  return {
    modelo: model,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    duracion_ms: Date.now() - startedAt,
    documentos_enviados: documentCount,
    costo_estimado_usd: Number(estimatedCost.toFixed(6)),
    precios_version: '2026-08-11',
    escalamiento_utilizado: escalated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACCIÓN PRINCIPAL (MÚLTIPLES DOCUMENTOS, UNA SOLA LLAMADA)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envía TODOS los documentos a OpenAI en un único request.
 * 
 * REGLA PRAVIA: Si OpenAI no está disponible o falla, se lanza un error.
 * NO existe fallback local. NO se rellenan campos con datos simulados.
 * Mensaje de error: "No fue posible ejecutar la extracción documental con IA.
 * Los campos permanecen sin cambios."
 */
async function executeDocumentExtraction(
  documentos: DocumentoParaExtraccion[],
  model: string,
  escalated = false
): Promise<DocumentExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('La clave de API de OpenAI no está configurada.');
  }

  if (!documentos || documentos.length === 0) {
    throw new Error('No hay documentos válidos para analizar.');
  }

  const listaDocumentos = documentos
    .map((d, i) => `Documento ${i + 1}: "${d.nombreOriginal}" (Tipo: ${d.tipoDocumento}, ID: ${d.documentoId})`)
    .join('\n');

  const prompt = `Eres un inspector documental notarial especializado en México.
Analiza TODOS los siguientes documentos simultáneamente y construye una propuesta unificada con trazabilidad de fuente por cada dato.

DOCUMENTOS RECIBIDOS:
${listaDocumentos}

PRIORIDAD DE FUENTES DE INFORMACIÓN:
1. Documento Word (Ficha de datos / Ficha notarial / Anexo): identidad (nombre, apellido_paterno, apellido_materno), estado_civil, ocupacion, lugar_nacimiento, pais_nacimiento, nacionalidad, fecha_nacimiento, curp, rfc, folio_identificacion.
2. INE: tipo_identificacion, folio_identificacion, autoridad_emisora, vigencia_ine, seccion_electoral.
3. Constancia de Situación Fiscal (CSF): rfc, actividad_economica, domicilio fiscal, regimenes.
4. Comprobante de domicilio (CFE/Agua): domicilio particular (comprobado).
5. CURP: CURP y respaldo para fecha de nacimiento.

REGLAS CRÍTICAS DE EXTRACCIÓN:
1. NO inventes ningún dato. Si un campo no está en los documentos, omítelo del JSON.
2. Extrae fielmente ocupacion (ej. "ARQUITECTO"), estado_civil (ej. "SOLTERO"), lugar_nacimiento (ej. "LA YESCA, NAYARIT"), pais_nacimiento (ej. "MÉXICO") y nacionalidad (ej. "MEXICANO") si están expresamente escritos en el documento Word o en otro documento.
3. No confundas actividad_economica (proviene de CSF), ocupacion (proviene del Word/declaración), y giro (deja VACÍO salvo que un documento lo especifique expresamente; NUNCA inventes "Servicios inmobiliarios" ni "Construcción y Arrendamiento").
4. Si el documento contiene "Lugar y país de nacimiento: LA YESCA, NAYARIT, MÉXICO", separa:
   - lugar_nacimiento = "LA YESCA, NAYARIT"
   - pais_nacimiento = "MÉXICO"
5. Para INE/reverso: el folio_identificacion es el número INMEDIATAMENTE DESPUÉS de "<<" en la línea MRZ que inicia con IDMEX.
6. Vigencia INE (ej. 2023-2033 o 2026-2036):
   - fecha_expedicion_identificacion = "01/01/AAAA_INICIAL"
   - fecha_vencimiento_identificacion = "31/12/AAAA_FINAL"
7. Domicilio FISCAL: extraer de CSF. Domicilio COMPROBADO: de CFE/Agua. Domicilio IDENTIFICACION: de la INE.

Responde EXCLUSIVAMENTE con este JSON estricto:
{
  "tipo_persona_detectado": "FISICA",
  "resumen_ejecutivo": "descripción breve del análisis",
  "alertas": ["observaciones o discrepancias detectadas"],
  "campos": [
    {
      "campo": "nombre_del_campo",
      "valor": "valor_exacto",
      "confianza": "LECTURA_CLARA",
      "fuente": "nombre del documento fuente",
      "documento_id": "id del documento fuente"
    }
  ],
  "domicilios_detectados": [
    {
      "tipo_sugerido": "FISCAL",
      "fuente": "nombre del documento fuente",
      "documento_id": "id del documento",
      "calle": "",
      "numero_exterior": "",
      "numero_interior": "",
      "colonia": "",
      "codigo_postal": "",
      "municipio": "",
      "ciudad": "",
      "localidad": "",
      "estado": "",
      "pais": "MÉXICO"
    }
  ],
  "actividades_economicas": [
    { "actividad": "", "porcentaje": "", "tipo": "PRINCIPAL" }
  ],
  "regimenes": []
}

Campos permitidos en "campos": nombre, apellido_paterno, apellido_materno, curp, rfc, sexo,
fecha_nacimiento, lugar_nacimiento, pais_nacimiento, nacionalidad, estado_civil, ocupacion,
folio_identificacion, fecha_expedicion_identificacion, fecha_vencimiento_identificacion,
seccion_electoral, vigencia_ine, actividad_economica, giro, razon_social, autoridad_emisora,
telefono, correo_electronico, correo, email, celular.
PROHIBIDOS: clave_elector, ocr, cic, escolaridad, tratamiento.

REGLAS DE FORMATO ESTRICTAS:
Responde EXCLUSIVAMENTE con un objeto JSON válido.
No escribas explicaciones.
No uses markdown.
No pongas \`\`\`json.
No agregues comentarios.
No agregues texto antes ni después del JSON.`;

  const content: any[] = [{ type: 'input_text', text: prompt }];

  for (const doc of documentos) {
    const filename = (doc.nombreOriginal || '').toLowerCase();
    const mime = (doc.mimeType || '').toLowerCase();
    const isDocx = mime.includes('officedocument.wordprocessingml') || filename.endsWith('.docx');
    const isDoc = mime.includes('msword') || filename.endsWith('.doc');

    if (isDocx || isDoc) {
      try {
        const extracted = await mammoth.extractRawText({ buffer: doc.buffer });
        const textVal = (extracted.value || '').trim();
        if (textVal.length > 0) {
          content.push({
            type: 'input_text',
            text: `[DOCUMENTO WORD "${doc.nombreOriginal}" (ID: ${doc.documentoId})]:\n${textVal}`
          });
        } else {
          content.push({
            type: 'input_text',
            text: `[DOCUMENTO WORD VACÍO "${doc.nombreOriginal}" (ID: ${doc.documentoId})]`
          });
        }
      } catch (mammothErr: any) {
        if (isDoc) {
          throw new Error(
            `El archivo "${doc.nombreOriginal}" tiene el formato antiguo .doc. Por favor guárdalo como .docx o PDF.`
          );
        } else {
          throw new Error(
            `No fue posible extraer el texto del documento Word "${doc.nombreOriginal}": ${mammothErr.message}`
          );
        }
      }
    } else {
      const base64Data = doc.buffer.toString('base64');
      const safeMime = mime.includes('pdf') ? 'application/pdf'
        : mime.includes('jpeg') || mime.includes('jpg') ? 'image/jpeg'
        : mime.includes('png') ? 'image/png'
        : 'application/octet-stream';

      if (safeMime === 'application/pdf') {
        content.push({
          type: 'input_file',
          filename: doc.nombreOriginal,
          file_data: `data:${safeMime};base64,${base64Data}`
        });
      } else if (safeMime.startsWith('image/')) {
        content.push({
          type: 'input_image',
          detail: 'high',
          image_url: `data:${safeMime};base64,${base64Data}`
        });
      } else {
        throw new Error(`El formato de "${doc.nombreOriginal}" no es compatible con el análisis documental.`);
      }
    }
  }

  const endpoint = 'https://api.openai.com/v1/responses';
  const startedAt = Date.now();
  const responseSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo_persona_detectado: { type: 'string', enum: ['FISICA', 'MORAL'] },
      resumen_ejecutivo: { type: 'string' },
      alertas: { type: 'array', items: { type: 'string' } },
      campos: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            campo: { type: 'string' },
            valor: { type: 'string' },
            confianza: { type: 'string', enum: ['LECTURA_CLARA', 'LECTURA_DUDOSA', 'LECTURA_DEFICIENTE'] },
            fuente: { type: 'string' },
            documento_id: { type: 'string' }
          },
          required: ['campo', 'valor', 'confianza', 'fuente', 'documento_id']
        }
      },
      domicilios_detectados: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tipo_sugerido: { type: 'string', enum: ['FISCAL', 'COMPROBADO', 'IDENTIFICACION'] },
            fuente: { type: 'string' },
            documento_id: { type: 'string' },
            calle: { type: 'string' },
            numero_exterior: { type: 'string' },
            numero_interior: { type: 'string' },
            colonia: { type: 'string' },
            codigo_postal: { type: 'string' },
            municipio: { type: 'string' },
            ciudad: { type: 'string' },
            localidad: { type: 'string' },
            estado: { type: 'string' },
            pais: { type: 'string' }
          },
          required: [
            'tipo_sugerido', 'fuente', 'documento_id', 'calle', 'numero_exterior',
            'numero_interior', 'colonia', 'codigo_postal', 'municipio', 'ciudad',
            'localidad', 'estado', 'pais'
          ]
        }
      },
      actividades_economicas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            actividad: { type: 'string' },
            porcentaje: { type: 'string' },
            tipo: { type: 'string' }
          },
          required: ['actividad', 'porcentaje', 'tipo']
        }
      },
      regimenes: { type: 'array', items: { type: 'string' } }
    },
    required: [
      'tipo_persona_detectado', 'resumen_ejecutivo', 'alertas', 'campos',
      'domicilios_detectados', 'actividades_economicas', 'regimenes'
    ]
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(Number(process.env.AI_DOCUMENT_TIMEOUT_MS || 120000)),
      body: JSON.stringify({
        model,
        store: false,
        input: [{ role: 'user', content }],
        reasoning: { effort: getReasoningEffort() },
        max_output_tokens: 8192,
        text: {
          format: {
            type: 'json_schema',
            name: 'extraccion_documental_notarial',
            strict: true,
            schema: responseSchema
          }
        }
      })
    });
  } catch (networkErr: any) {
    throw new Error(
      `No fue posible ejecutar la extracción documental con IA. ` +
      `Error de red: ${networkErr.message}. Los campos permanecen sin cambios.`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'sin detalle');
    throw new Error(
      `No fue posible ejecutar la extracción documental con IA. ` +
      `OpenAI respondió HTTP ${response.status}: ${errorBody.slice(0, 300)}. ` +
      `Los campos permanecen sin cambios.`
    );
  }

  const data: any = await response.json();
  if (data.status === 'incomplete') {
    throw new Error(
      `OpenAI no completó el análisis: ${data.incomplete_details?.reason || 'causa no especificada'}. ` +
      `Los campos permanecen sin cambios.`
    );
  }

  const outputContent = (data.output || []).flatMap((item: any) => item.content || []);
  const refusal = outputContent.find((item: any) => item.type === 'refusal')?.refusal;
  if (refusal) {
    throw new Error(`OpenAI rechazó el análisis documental: ${refusal}`);
  }

  const rawText = outputContent
    .filter((item: any) => item.type === 'output_text')
    .map((item: any) => item.text || '')
    .join('')
    .trim();

  if (!rawText) {
    throw new Error('OpenAI no devolvió datos analizables. Los campos permanecen sin cambios.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (error: any) {
    throw new Error(`OpenAI devolvió una respuesta no válida: ${error.message}`);
  }

  return {
    proveedor: 'OpenAI',
    modelo: model,
    tipo_persona_detectado: parsed.tipo_persona_detectado || 'FISICA',
    campos: parsed.campos || [],
    resumen_ejecutivo: parsed.resumen_ejecutivo || '',
    alertas: parsed.alertas || [],
    domicilios_detectados: parsed.domicilios_detectados || [],
    actividades_economicas: parsed.actividades_economicas || [],
    regimenes: parsed.regimenes || [],
    uso: buildUsageMetrics(data, model, startedAt, documentos.length, escalated),
  };
}

function escalationCandidates(result: DocumentExtractionResult) {
  const byField = new Map<string, ExtractedField[]>();
  const documentIds = new Set<string>();
  const reasons: string[] = [];
  for (const field of result.campos) {
    const list = byField.get(field.campo) || [];
    list.push(field);
    byField.set(field.campo, list);
    if (field.confianza !== 'LECTURA_CLARA') {
      reasons.push(`lectura ${field.confianza.toLowerCase()} en ${field.campo}`);
      if (field.documento_id) documentIds.add(field.documento_id);
    }
  }
  for (const [fieldName, fields] of byField) {
    const values = new Set(fields.map((field) => field.valor.trim().toUpperCase()).filter(Boolean));
    if (values.size > 1) {
      reasons.push(`fuentes contradictorias para ${fieldName}`);
      for (const field of fields) if (field.documento_id) documentIds.add(field.documento_id);
    }
  }
  return { required: reasons.length > 0, reasons: [...new Set(reasons)], documentIds: [...documentIds] };
}

export async function extraerMultiplesDocumentos(
  documentos: DocumentoParaExtraccion[]
): Promise<DocumentExtractionResult> {
  const primary = await executeDocumentExtraction(documentos, getOpenAIModelName(), false);
  const escalation = escalationCandidates(primary);
  const escalationEnabled = String(process.env.AI_ESCALATION_ENABLED || 'true').toLowerCase() !== 'false';
  if (!escalation.required || !escalationEnabled) return { ...primary, usos: primary.uso ? [primary.uso] : [] };

  const selected = escalation.documentIds.length
    ? documentos.filter((document) => escalation.documentIds.includes(document.documentoId)).slice(0, 4)
    : documentos.slice(0, 4);
  const escalated = await executeDocumentExtraction(selected, getOpenAIEscalationModelName(), true);
  return {
    ...escalated,
    alertas: [
      ...primary.alertas,
      ...escalated.alertas,
      `Revisión escalada por: ${escalation.reasons.join('; ')}.`,
    ],
    usos: [primary.uso, escalated.uso].filter((usage): usage is AIUsageMetrics => Boolean(usage)),
  };
}

export async function analizarProyectoNotarialConOpenAI(
  proyecto: DocumentoParaExtraccion,
  documentosSoporte: DocumentoParaExtraccion[]
): Promise<ProyectoAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getOpenAIEscalationModelName();
  const startedAt = Date.now();
  if (!apiKey) throw new Error('La clave de API de OpenAI no está configurada.');

  const content: any[] = [{
    type: 'input_text',
    text: `Actúa como revisor jurídico-notarial mexicano. Compara el PROYECTO DE ESCRITURA con todos los DOCUMENTOS FUENTE. Detecta únicamente discrepancias comprobables, datos faltantes, contradicciones y riesgos. No inventes datos ni uses ejemplos. Cada observación debe indicar el dato exacto del proyecto, el dato exacto de la fuente, el documento fuente y una recomendación concreta. Si no hay discrepancias, devuelve observaciones vacías. Este análisis asiste al abogado y no sustituye su revisión profesional.`
  }];
  const documentosNoLeidos: string[] = [];

  const appendDocument = async (doc: DocumentoParaExtraccion, etiqueta: string) => {
    const filename = doc.nombreOriginal || etiqueta;
    const lowerName = filename.toLowerCase();
    const mime = (doc.mimeType || '').toLowerCase();
    const isDocx = mime.includes('officedocument.wordprocessingml') || lowerName.endsWith('.docx');

    if (isDocx) {
      try {
        const extracted = await mammoth.extractRawText({ buffer: doc.buffer });
        content.push({
          type: 'input_text',
          text: `[${etiqueta}: "${filename}"; ID: ${doc.documentoId}]\n${(extracted.value || '').trim()}`
        });
      } catch {
        documentosNoLeidos.push(filename);
      }
      return;
    }

    const base64 = doc.buffer.toString('base64');
    if (mime.includes('pdf') || lowerName.endsWith('.pdf')) {
      content.push({
        type: 'input_file',
        filename,
        file_data: `data:application/pdf;base64,${base64}`
      });
      return;
    }
    if (mime.includes('png') || lowerName.endsWith('.png')) {
      content.push({ type: 'input_image', detail: 'high', image_url: `data:image/png;base64,${base64}` });
      return;
    }
    if (mime.includes('jpeg') || mime.includes('jpg') || /\.jpe?g$/.test(lowerName)) {
      content.push({ type: 'input_image', detail: 'high', image_url: `data:image/jpeg;base64,${base64}` });
      return;
    }
    documentosNoLeidos.push(filename);
  };

  await appendDocument(proyecto, 'PROYECTO DE ESCRITURA');
  for (const documento of documentosSoporte) {
    await appendDocument(documento, 'DOCUMENTO FUENTE');
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      resumen_ejecutivo: { type: 'string' },
      observaciones: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            nivel_riesgo: { type: 'string', enum: ['ALTO', 'MEDIO', 'INFORMATIVO'] },
            dato_proyecto: { type: 'string' },
            dato_fuente: { type: 'string' },
            documento_fuente: { type: 'string' },
            ubicacion: { type: 'string' },
            tipo_discrepancia: { type: 'string' },
            recomendacion: { type: 'string' }
          },
          required: [
            'nivel_riesgo', 'dato_proyecto', 'dato_fuente', 'documento_fuente',
            'ubicacion', 'tipo_discrepancia', 'recomendacion'
          ]
        }
      }
    },
    required: ['resumen_ejecutivo', 'observaciones']
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(Number(process.env.AI_DOCUMENT_TIMEOUT_MS || 120000)),
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: 'user', content }],
      reasoning: { effort: getReasoningEffort() },
      max_output_tokens: 8192,
      text: {
        format: {
          type: 'json_schema',
          name: 'revision_proyecto_notarial',
          strict: true,
          schema
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => 'sin detalle');
    throw new Error(`OpenAI respondió HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data: any = await response.json();
  if (data.status === 'incomplete') {
    throw new Error(`OpenAI no completó la revisión: ${data.incomplete_details?.reason || 'causa no especificada'}`);
  }
  const output = (data.output || []).flatMap((item: any) => item.content || []);
  const refusal = output.find((item: any) => item.type === 'refusal')?.refusal;
  if (refusal) throw new Error(`OpenAI rechazó la revisión: ${refusal}`);
  const rawText = output
    .filter((item: any) => item.type === 'output_text')
    .map((item: any) => item.text || '')
    .join('')
    .trim();
  if (!rawText) throw new Error('OpenAI no devolvió resultados para la revisión.');

  const parsed = JSON.parse(rawText);
  return {
    proveedor: 'OpenAI',
    modelo: model,
    resumen_ejecutivo: parsed.resumen_ejecutivo || '',
    observaciones: Array.isArray(parsed.observaciones) ? parsed.observaciones : [],
    documentos_no_leidos: documentosNoLeidos,
    uso: buildUsageMetrics(data, model, startedAt, 1 + documentosSoporte.length, true),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPATIBILIDAD: extracción de documento único
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Usar extraerMultiplesDocumentos.
 * Mantiene la firma pública para compatibilidad hacia atrás.
 */
export async function extraermedianteIA(
  buffer: Buffer,
  mimeType: string,
  tipoDocumentoHint: string
): Promise<DocumentExtractionResult> {
  return extraerMultiplesDocumentos([{
    buffer,
    mimeType,
    tipoDocumento: tipoDocumentoHint,
    documentoId: 'single',
    nombreOriginal: tipoDocumentoHint
  }]);
}
