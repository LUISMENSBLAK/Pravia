export type FinanceView = 'resumen' | 'movimientos' | 'cuentas' | 'conciliacion' | 'facturacion' | 'cartera';
export type FinancePeriodKey = 'ESTE_MES' | 'MES_ANTERIOR' | 'TRIMESTRE' | 'ANO' | 'PERSONALIZADO';

export type FinanceSummary = {
  period: { from: string; to: string; key: string; label: string };
  kpis: { ingresos_recibidos: number; honorarios_generados: number; honorarios_cobrados: number; honorarios_por_cobrar: number; fondos_terceros: number; otros_destinos: number; fondos_terceros_pendientes: number; egresos: number };
  cashFlow: Array<{ periodo: string; ingresos: number; honorarios: number; egresos: number }>;
  allocation: { despacho: number; terceros: number; otros: number };
};

export type FinanceCategory = { id: string; clave: string; nombre: string; naturaleza: 'DESPACHO'|'TERCERO'|'EGRESO_DESPACHO'|'TRANSFERENCIA_INTERNA'|'OTRO'; direccion: 'INGRESO'|'EGRESO'|'AMBAS' };
export type FinanceAccount = { id: string; institucion: string; alias: string; tipo: string; ultimos_cuatro?: string|null; moneda: string; activa?: boolean; predeterminada?: boolean; saldo_pravia?: number; saldo_tipo?: string; _count?: { movimientos: number; transaccionesBanco: number } };
export type FinanceCatalogs = {
  categories: FinanceCategory[]; accounts: FinanceAccount[];
  expedientes: Array<{id:string;numero_pravia:string;cliente_alias?:string|null;notaria_id?:string|null;abogado_id:string;cotizacion_id?:string|null}>;
  notarias: Array<{id:string;nombre:string;numero_notaria?:string|null}>;
  responsables: Array<{id:string;nombre:string;apellido:string;rol:string}>;
  permisos: { escribir:boolean; aplicar:boolean; conciliar:boolean; expedientesLeer:boolean; documentosLeer:boolean; documentosEscribir:boolean; documentosEliminar:boolean };
  invoiceIntegration: { configured:boolean;status:string;message:string };
  bankImport: { configured:boolean;message:string };
};

export type MovementAllocation = { id?: string; categoria_id: string; monto: number; categoria?: FinanceCategory };
export type FinanceDocument = { id:string;nombre_original:string;mime_type?:string|null;size_bytes?:number|null;fecha_carga?:string;estatus?:string };
export type FinanceDocumentLink = { id:string;tipo_vinculo:string;fecha_vinculo:string;documento:FinanceDocument };
export type FinanceMovement = {
  id:string;folio?:string|null;naturaleza:'INGRESO'|'EGRESO';tipo_movimiento:string;concepto:string;descripcion?:string|null;monto:number|string;
  fecha_movimiento:string;estatus:string;forma_pago?:string|null;referencia?:string|null;
  expediente?:{id:string;numero_pravia:string;cliente_alias?:string|null}|null;cuenta?:FinanceAccount|null;
  distribuciones:MovementAllocation[];comprobanteInterno?:{id:string;folio:string;estado:string}|null;movimientoDocumentos?:FinanceDocumentLink[];
};
export type Paginated<T> = { items:T[];meta:{page:number;pageSize:number;total:number;totalPages:number;agingAvailable?:boolean;totals?:{generated:number;collected:number;pending:number}} };
export type MovementDraft = { naturaleza:'INGRESO'|'EGRESO';monto:number;fecha_movimiento:string;cuenta_id:string;expediente_id?:string;notaria_id?:string;responsable_id?:string;tipo_movimiento:string;concepto:string;descripcion?:string;forma_pago:string;referencia?:string;distribuciones:Array<{categoria_id:string;monto:number}>;idempotency_key:string };
export type Receipt = { id:string;folio:string;tipo:'INGRESO'|'EGRESO';fecha:string;importe:number|string;concepto:string;persona?:string|null;estado:string;movimiento:FinanceMovement;registrado_por?:{nombre:string;apellido:string} };
export type Receivable = { id:string;cliente:string;expediente?:{id:string;numero_pravia:string}|null;cotizacion:{numero_cotizacion?:string|null};responsable:string;notaria:string;fecha_reconocimiento:string;fecha_vencimiento?:string|null;generated:number;collected:number;pending:number;bucket?:string|null;ultimo_pago?:string|null };
export type ReconciliationData = { summary:{conciliados:number;pendientes:number;sinCoincidencia:number};rows:Array<{transaction:{id:string;fecha:string;importe:number|string;descripcion:string;referencia?:string|null;estado:string;cuenta:FinanceAccount};current?:unknown;suggestion?:{score:number;algorithm:string;reasons:string[];movement:FinanceMovement}|null}>;unmatchedMovements:FinanceMovement[] };
