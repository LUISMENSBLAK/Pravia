import { standardConcepts } from '../services/configurationCatalogV2.service';

export type ActProcessDefault = {
  code: string;
  name: string;
  stage: 'Prefirma' | 'Firma' | 'Postfirma' | 'Registro' | 'Cierre';
  duration: number;
  dayType: 'HABILES' | 'NATURALES';
  nature: string;
};

const processStages: Record<string, ActProcessDefault['stage']> = {
  REVISION_INICIAL: 'Prefirma', SOLICITUD_CLG: 'Prefirma', OBTENCION_CLG: 'Prefirma',
  SOLICITUD_AVALUO: 'Prefirma', OBTENCION_AVALUO: 'Prefirma', PROYECCION_INSTRUMENTO: 'Prefirma',
  SRE_SOLICITUD: 'Prefirma', SRE_OBTENCION: 'Prefirma', REVISION_BANCO: 'Prefirma',
  VOBO_BANCO: 'Prefirma', FIRMA: 'Firma', SOLVENCIA_INGRESO: 'Postfirma',
  SOLVENCIA_OBTENCION: 'Postfirma', RPP_INGRESO: 'Registro', RPP_OBTENCION: 'Registro',
  ARMADO_TESTIMONIO: 'Cierre', ARCHIVO: 'Cierre', ENTREGA_CLIENTE: 'Cierre',
};

const codesByGroup = {
  REGISTRABLE: ['REVISION_INICIAL', 'SOLICITUD_CLG', 'OBTENCION_CLG', 'SOLICITUD_AVALUO', 'OBTENCION_AVALUO', 'PROYECCION_INSTRUMENTO', 'FIRMA', 'SOLVENCIA_INGRESO', 'SOLVENCIA_OBTENCION', 'RPP_INGRESO', 'RPP_OBTENCION', 'ARMADO_TESTIMONIO', 'ARCHIVO', 'ENTREGA_CLIENTE'],
  NO_REGISTRABLE: ['REVISION_INICIAL', 'PROYECCION_INSTRUMENTO', 'FIRMA', 'ARMADO_TESTIMONIO', 'ARCHIVO', 'ENTREGA_CLIENTE'],
  ESPECIAL: ['REVISION_INICIAL', 'SRE_SOLICITUD', 'SRE_OBTENCION', 'REVISION_BANCO', 'VOBO_BANCO', 'PROYECCION_INSTRUMENTO', 'FIRMA', 'ARMADO_TESTIMONIO', 'ARCHIVO'],
} as const;

const byCode = new Map(standardConcepts.map((concept) => [concept.code, concept]));

export const actProcessDefaults = Object.fromEntries(Object.entries(codesByGroup).map(([group, codes]) => [
  group,
  codes.map((code): ActProcessDefault => {
    const concept = byCode.get(code);
    const stage = processStages[code];
    if (!concept || !stage) throw new Error(`El proceso default ${code} no está definido en CFG-001.`);
    return {
      code,
      name: concept.name,
      stage,
      duration: concept.duration,
      dayType: concept.dayType || 'HABILES',
      nature: concept.nature || 'INTERNA',
    };
  }),
])) as Record<keyof typeof codesByGroup, ActProcessDefault[]>;

export const actProcessDefaultByCode = new Map(
  Object.values(actProcessDefaults).flat().map((process) => [process.code, process]),
);
