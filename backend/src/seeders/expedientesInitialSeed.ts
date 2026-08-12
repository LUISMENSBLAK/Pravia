import prisma from '../config/prisma';

export async function seedExpedientesConfig() {
  console.log('🌱 Inicializando seeders idempotentes para el Motor de Expedientes...');

  // Usuario creador por defecto (Administración / Dirección)
  const defaultAdmin = await prisma.user.findFirst({
    where: { rol: { in: ['DIRECCION', 'ADMINISTRACION'] } }
  });

  if (!defaultAdmin) {
    console.error('❌ No se encontró ningún usuario administrador en la base de datos para asignar las versiones del motor.');
    return;
  }

  const tiposActoDefinidos = [
    { nombre: 'Compraventa Inmobiliaria', descripcion: 'Transmisión de dominio de inmuebles urbanos o rústicos' },
    { nombre: 'Donación de Inmueble', descripcion: 'Transmisión a título gratuito entre vivos' },
    { nombre: 'Poder Notarial', descripcion: 'Otorgamiento de facultades de representación (General / Especial)' },
    { nombre: 'Constitución de Sociedad', descripcion: 'Creación y estatutos de SA de CV, S de RL, AC, etc.' },
    { nombre: 'Fideicomiso', descripcion: 'Contrato fiduciario patrimonial o de garantía' },
    { nombre: 'Testamento / Sucesión', descripcion: 'Disposición testamentaria e intestados' }
  ];

  for (const item of tiposActoDefinidos) {
    let tipoActo = await prisma.tipoActo.findFirst({
      where: { nombre: item.nombre }
    });

    if (!tipoActo) {
      tipoActo = await prisma.tipoActo.create({
        data: {
          nombre: item.nombre,
          descripcion: item.descripcion
        }
      });
      console.log(`  + TipoActo creado: ${tipoActo.nombre}`);
    }

    // 1. Crear / Asegurar FormularioVersion V1
    await prisma.formularioVersion.upsert({
      where: {
        tipo_acto_id_version: {
          tipo_acto_id: tipoActo.id,
          version: 1
        }
      },
      update: {},
      create: {
        tipo_acto_id: tipoActo.id,
        version: 1,
        creado_por_id: defaultAdmin.id,
        secciones_json: [
          { clave: 'DATOS_GENERALES', titulo: 'Datos Generales del Acto', orden: 1 },
          { clave: 'DATOS_INMUEBLE', titulo: 'Datos del Inmueble / Objeto', orden: 2 },
          { clave: 'CONDICIONES_PAGO', titulo: 'Condiciones Financieras y Forma de Pago', orden: 3 }
        ],
        campos_json: [
          { clave_tecnica: 'valor_operacion', etiqueta: 'Valor de la Operación ($)', tipo_dato: 'DECIMAL', obligatorio: true, seccion: 'DATOS_GENERALES' },
          { clave_tecnica: 'ubicacion_inmueble', etiqueta: 'Dirección Completa del Inmueble', tipo_dato: 'TEXTAREA', obligatorio: true, seccion: 'DATOS_INMUEBLE' },
          { clave_tecnica: 'cuenta_predial', etiqueta: 'Número de Cuenta Predial', tipo_dato: 'TEXT', obligatorio: false, seccion: 'DATOS_INMUEBLE' },
          { clave_tecnica: 'clave_catastral', etiqueta: 'Clave Catastral', tipo_dato: 'TEXT', obligatorio: false, seccion: 'DATOS_INMUEBLE' },
          { clave_tecnica: 'forma_pago_uif', etiqueta: 'Forma de Pago Principal (UIF)', tipo_dato: 'SELECT', obligatorio: true, opciones: ['TRANSFERENCIA', 'CHEQUE_CERTIFICADO', 'CREDITO_HIPOTECARIO', 'EFECTIVO_PERMITIDO'], seccion: 'CONDICIONES_PAGO' }
        ]
      }
    });

    // 2. Crear / Asegurar FlujoVersion V1 con Etapas Operativas Estándar
    const etapasEstandar = [
      { clave: 'APERTURA_EXPEDIENTE', nombre: 'Apertura de Expediente', orden: 1, duracion: 1, estado: 'ABIERTO' },
      { clave: 'RECEPCION_DOCUMENTOS', nombre: 'Recepción y Revisión Documental', orden: 2, duracion: 3, estado: 'EN_INTEGRACION' },
      { clave: 'DICTAMEN_JURIDICO', nombre: 'Dictamen Jurídico y Titulación', orden: 3, duracion: 2, estado: 'EN_PROCESO' },
      { clave: 'SOLICITUD_SOLVENCIAS', nombre: 'Gestión de Certificados de Solvencia (RPPyC/Catastro)', orden: 4, duracion: 5, estado: 'PENDIENTE_NOTARIA' },
      { clave: 'REDACCION_PROYECTO', nombre: 'Redacción del Proyecto de Escritura', orden: 5, duracion: 2, estado: 'EN_PROCESO' },
      { clave: 'REVISION_CLIENTE', nombre: 'Revisión y Aprobación del Cliente', orden: 6, duracion: 2, estado: 'PENDIENTE_CLIENTE' },
      { clave: 'PROGRAMACION_FIRMA', nombre: 'Programación y Confirmación de Firma', orden: 7, duracion: 1, estado: 'FIRMA_PROGRAMADA' },
      { clave: 'FIRMA_ESCRITURA', nombre: 'Firma de Comparecientes y Notario', orden: 8, duracion: 1, estado: 'FIRMADO' },
      { clave: 'EXPEDICION_TESTIMONIO', nombre: 'Expedición de Testimonio y Copias Certificadas', orden: 9, duracion: 2, estado: 'POST_FIRMA' },
      { clave: 'PAGO_IMPUESTOS', nombre: 'Cálculo y Entero de Impuestos (ISAI/ISR)', orden: 10, duracion: 3, estado: 'POST_FIRMA' },
      { clave: 'INSCRIPCION_RPPYC', nombre: 'Trámite e Inscripción en Registro Público', orden: 11, duracion: 15, estado: 'POST_FIRMA' },
      { clave: 'ENTREGA_TESTIMONIO', nombre: 'Testimonio Inscrito Listo para Entrega', orden: 12, duracion: 1, estado: 'LISTO_ENTREGA' },
      { clave: 'ENTREGADO_CLIENTE', nombre: 'Entrega Formal al Cliente y Cierre de Expediente', orden: 13, duracion: 1, estado: 'ENTREGADO' }
    ];

    await prisma.flujoVersion.upsert({
      where: {
        tipo_acto_id_version: {
          tipo_acto_id: tipoActo.id,
          version: 1
        }
      },
      update: {},
      create: {
        tipo_acto_id: tipoActo.id,
        version: 1,
        creado_por_id: defaultAdmin.id,
        ponderaciones_json: { operativo: 0.40, documental: 0.40, financiero: 0.20 },
        etapas_json: etapasEstandar
      }
    });

    // 3. Crear Plantillas de FlujoEtapa en BD
    for (const etapa of etapasEstandar) {
      await prisma.flujoEtapa.upsert({
        where: {
          tipo_acto_id_clave: {
            tipo_acto_id: tipoActo.id,
            clave: etapa.clave
          }
        },
        update: {
          nombre: etapa.nombre,
          orden: etapa.orden,
          duracion_esperada_dias: etapa.duracion,
          estado_general_relacionado: etapa.estado
        },
        create: {
          tipo_acto_id: tipoActo.id,
          clave: etapa.clave,
          nombre: etapa.nombre,
          orden: etapa.orden,
          duracion_esperada_dias: etapa.duracion,
          estado_general_relacionado: etapa.estado
        }
      });
    }

    // 4. Crear PlantillaDocumentalVersion V1
    const existingTemplate = await prisma.plantillaDocumentalVersion.findFirst({
      where: { tipo_acto_id: tipoActo.id, notaria_id: null, version: 1 },
      select: { id: true },
    });
    if (!existingTemplate) {
      await prisma.plantillaDocumentalVersion.create({ data: {
        tipo_acto_id: tipoActo.id,
        version: 1,
        creado_por_id: defaultAdmin.id,
        requisitos_json: [
          { nombre: 'Identificación Oficial Vigente (INE/Pasaporte)', categoria: 'FIRMA', obligatorio: true },
          { nombre: 'CURP y Constancia de Situación Fiscal (RFC)', categoria: 'FIRMA', obligatorio: true },
          { nombre: 'Comprobante de Domicilio Reciente', categoria: 'FIRMA', obligatorio: true },
          { nombre: 'Título de Propiedad / Antecedente Notarial', categoria: 'PROYECTO', obligatorio: true },
          { nombre: 'Boleta de Impuesto Predial al Corriente', categoria: 'CATASTRO', obligatorio: true },
          { nombre: 'Boleta de Agua / Constancia de No Adeudo', categoria: 'CATASTRO', obligatorio: true },
          { nombre: 'Certificado de Libertad de Gravamen', categoria: 'REGISTRO', obligatorio: true },
          { nombre: 'Formulario de Identificación UIF', categoria: 'UIF', obligatorio: true }
        ]
      } });
    }
  }

  console.log('✅ Seeders iniciales del Motor de Expedientes ejecutados con éxito.');
}

if (require.main === module) {
  seedExpedientesConfig()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
