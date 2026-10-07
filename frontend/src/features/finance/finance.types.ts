export type FinanceView = 'resumen' | 'proyeccion' | 'movimientos' | 'cuentas' | 'conciliacion' | 'facturacion' | 'cartera';
export type FinancePeriodKey = '7_DIAS' | '30_DIAS' | '3_MESES' | '6_MESES' | '1_ANO' | 'ESTE_MES' | 'MES_ANTERIOR' | 'TRIMESTRE' | 'ANO' | 'PERSONALIZADO';

export type FinanceSummary = {
  period: { from: string; to: string; key: string; label: string };
  kpis: { ingresos_recibidos: number; honorarios_generados: number; honorarios_cobrados: number; honorarios_por_cobrar: number; fondos_terceros: number; otros_destinos: number; fondos_terceros_pendientes: number; egresos: number };
  cashFlow: Array<{ periodo: string; ingresos: number; honorarios: number; egresos: number }>;
  allocation: { despacho: number; terceros: number; otros: number };
  series: Array<{ period: string; generated: number; collected: number; difference: number }>;
  byLawyer: Array<{ id: string|null; label: string; generated: number; collected: number }>;
  byAct: Array<{ label: string; generated: number; collected: number }>;
  collectionStatus: { collected: number; outstanding: number; overdue: number };
  projection: { months: Array<{period:string;fees:number;otherIncome:number;expenses:number}>; noDate:{fees:number;otherIncome:number;expenses:number} };
  collectionAlerts: Array<{id:string;expediente_id:string;folio:string;client?:string|null;signature_date:string;business_days:number;outstanding:number;source:string}>;
  recentMovements: Array<{id:string;date:string;concept:string;amount:number;nature:'INGRESO'|'EGRESO';origin:'EXPEDIENTE'|'EXTERNO';expediente?:{id:string;numero_pravia:string}|null;href:string}>;
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
  origin:'EXPEDIENTE'|'EXTERNO';source_href?:string|null;central_read_only?:boolean;
  distribuciones:MovementAllocation[];comprobanteInterno?:{id:string;folio:string;estado:string}|null;movimientoDocumentos?:FinanceDocumentLink[];
};
export type Paginated<T> = { items:T[];meta:{page:number;pageSize:number;total:number;totalPages:number;agingAvailable?:boolean;totals?:{generated:number;collected:number;pending:number}} };
export type MovementDraft = { naturaleza:'INGRESO'|'EGRESO';monto:number;fecha_movimiento:string;cuenta_id:string;expediente_id?:string;notaria_id?:string;responsable_id?:string;tipo_movimiento:string;concepto:string;descripcion?:string;forma_pago:string;referencia?:string;distribuciones:Array<{categoria_id:string;monto:number}>;idempotency_key:string };
export type Receipt = { id:string;folio:string;tipo:'INGRESO'|'EGRESO';fecha:string;importe:number|string;concepto:string;persona?:string|null;estado:string;movimiento:FinanceMovement;registrado_por?:{nombre:string;apellido:string} };
export type Receivable = { id:string;cliente:string;expediente?:{id:string;numero_pravia:string}|null;cotizacion:{numero_cotizacion?:string|null};responsable:string;fecha_reconocimiento:string;fecha_vencimiento?:string|null;generated:number;collected:number;pending:number;bucket?:string|null;ultimo_pago?:string|null };
export type ReconciliationData = { summary:{conciliados:number;pendientes:number;sinCoincidencia:number};rows:Array<{transaction:{id:string;fecha:string;importe:number|string;descripcion:string;referencia?:string|null;estado:string;cuenta:FinanceAccount};current?:unknown;suggestion?:{score:number;algorithm:string;reasons:string[];movement:FinanceMovement}|null}>;unmatchedMovements:FinanceMovement[] };
export type RecurringExpense = {id:string;concepto:string;monto:number|string;periodicidad:string;fecha_inicio:string;fecha_fin?:string|null;activo:boolean};
export type ExpedienteInvoice = {id:string;expediente_id:string;monto_reportado?:string|null;monto_validado?:string|null;factura_estado:'PENDIENTE'|'CARGADA';created_at:string;factura_completada_at?:string|null;expediente:{numero_pravia:string;cliente_alias?:string|null};facturarAVinculo?:{id:string;compareciente:{id:string;nombre_busqueda:string;tipo_persona:string}}|null;documentos:Array<{id:string;documento:{nombre_original:string;mime_type:string}}>};
export type FiscalProviderStatus = {configured:boolean;provider:string|null;cfdiEnabled:boolean;manualUploadEnabled:boolean;localDraftsEnabled:boolean;realStampingVerified:boolean;message:string};
export type FiscalEntity = {id:string;razon_social:string;rfc:string;regimen_fiscal:string;codigo_postal:string;serie?:string|null;activa:boolean;pac_secret_configured:boolean;csd_key_configured:boolean;csd_password_configured:boolean;cuentas?:Array<{id:string;predeterminada:boolean;cuenta?:FinanceAccount}>};
export type FiscalSupplier = {id:string;razon_social:string;rfc:string;codigo_postal?:string|null;regimenes_fiscales?:Array<{clave:string;descripcion?:string}>|null;correo?:string|null;telefono?:string|null;activo:boolean};
export type FiscalDocument = {id:string;direccion:'EMITIDO'|'RECIBIDO';tipo:string;estado:string;source:'LOCAL_DRAFT'|'MANUAL_XML'|'PAC';uuid_fiscal?:string|null;serie?:string|null;folio?:string|null;emisor_rfc:string;emisor_nombre:string;receptor_rfc:string;receptor_nombre:string;metodo_pago?:'PUE'|'PPD'|null;moneda:string;total:string|number;saldo:string|number;created_at:string;proveedor?:FiscalSupplier|null;expediente?:{id:string;numero_pravia:string;cliente_alias?:string|null}|null;xmlDocumento?:{id:string;nombre_original:string}|null;pdfDocumento?:{id:string;nombre_original:string}|null;cuentaPorCobrar?:{id:string;estado:string;saldo:string|number}|null;cuentaPorPagar?:{id:string;estado:string;saldo:string|number}|null;aplicacionesPago?:Array<{id:string;monto_aplicado:string|number;numero_parcialidad?:number|null}>};
export type FiscalAccounts = {receivables:Array<{id:string;concepto:string;monto_total:string|number;monto_cobrado:string|number;saldo:string|number;estado:string;cfdi?:FiscalDocument|null}>;payables:Array<{id:string;concepto:string;monto_total:string|number;monto_pagado:string|number;saldo:string|number;estado:string;proveedor?:FiscalSupplier|null;cfdi?:FiscalDocument|null}>;transfers:Array<{id:string;monto:string|number;referencia?:string|null;created_at:string;cuentaOrigen:FinanceAccount;cuentaDestino:FinanceAccount}>};
