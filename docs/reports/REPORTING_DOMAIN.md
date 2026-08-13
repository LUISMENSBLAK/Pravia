# Dominio canónico de Reportes — PRAVIA OS

Fecha de corte: 13 de agosto de 2026

## 1. Propósito y fuentes de verdad

Reportes es una capa de lectura operativa. No mantiene un segundo libro contable ni copia pagos, movimientos, firmas o importes de expedientes. Consume las fuentes canónicas siguientes:

- Finanzas: `HonorarioGenerado`, `MovimientoFinanciero` aplicado y `MovimientoDistribucion`.
- Operación: `Expediente`, `EventoAgenda` y sus fechas de negocio.
- Comercial: `Prospecto`, `Cotizacion`, `CotizacionVersion` y seguimientos.
- Organización: `User` y `Notaria`.
- Metas: `MetaHonorario`, registro histórico configurable; nunca se crea al renderizar un dashboard.

`Pago` es legacy y no se suma a `MovimientoFinanciero`. `Expediente.valor_operacion`, `Cotizacion.total_cliente` y costos de notaría no son honorarios.

## 2. Periodos y fechas

Los periodos admitidos son `ESTE_MES`, `MES_ANTERIOR`, `ESTE_TRIMESTRE`, `ESTE_ANO` y `PERSONALIZADO` (se conservan `TRIMESTRE` y `ANO` como alias de compatibilidad). Los límites son inclusivos y se calculan en la zona institucional. La semana operativa es lunes–domingo; los días laborables pueden destacarse sin excluir fines de semana.

Cada métrica usa su fecha de negocio:

| Métrica | Fecha usada |
| --- | --- |
| Honorario generado | `HonorarioGenerado.fecha_reconocimiento` |
| Cobro / ingreso / recurso de terceros / egreso | `MovimientoFinanciero.fecha_movimiento`, sólo aplicado |
| Expediente del año | `Expediente.fecha_apertura` |
| Firma programada | `Expediente.fecha_estimada_firma`; Agenda sólo aporta contexto |
| Firma realizada | `Expediente.fecha_real_firma` |
| Presupuesto solicitado | `Cotizacion.created_at`, evento de creación de solicitud |
| Cotización enviada | `Cotizacion.fecha_enviada_cliente` |
| Cotización aceptada | `Cotizacion.fecha_aceptacion_cliente` |
| Cliente generado | `Prospecto` convertido al existir una cotización aceptada/convertida; fecha de aceptación |
| Anticipo | fecha de un `MovimientoFinanciero` aplicado con `tipo_movimiento = ANTICIPO` |
| Último seguimiento | `created_at` del seguimiento comercial, sólo para esa actividad |

## 3. Definiciones financieras

- **Ingreso total:** suma de movimientos de ingreso aplicados en el periodo. Es efectivo recibido, no ganancia.
- **Honorarios generados:** suma de `HonorarioGenerado` reconocido/no cancelado en el periodo. Una cotización aceptada de $10,000 genera $10,000 aunque sólo se hayan cobrado $5,000.
- **Honorarios cobrados:** distribuciones de movimientos de ingreso aplicados cuya categoría económica es `DESPACHO`, en el periodo.
- **Honorarios por cobrar:** por cada reconocimiento, `max(0, generado - distribuciones DESPACHO aplicadas relacionadas)`. Sin ajustes extraordinarios, generado = cobrado + por cobrar.
- **Recursos de terceros:** distribuciones aplicadas de ingreso con naturaleza `TERCERO`. `OTRO` es un destino no propio separado; ingreso total reconcilia como despacho + terceros + otros destinos.
- **Egresos:** movimientos de egreso aplicados en el periodo. No reduce honorarios generados.
- **Cartera:** reconocimientos con saldo de honorarios positivo a la fecha de corte; puede agruparse por abogado responsable y notaría del reconocimiento/expediente.
- **Ingreso programado:** honorarios reconocidos de expedientes con `fecha_estimada_firma` desde ahora hasta el domingo de la semana actual y sin `fecha_real_firma`. Se reportan también firmas restantes. No usa valor de operación.
- **Valor programado:** honorarios reconocidos asociados a expedientes cuya fecha estimada de firma cae en el periodo indicado.
- **Valor de expedientes:** suma de honorarios reconocidos de esos expedientes, nunca valor del inmueble u operación.

## 4. Metas

- **Meta de honorarios:** objetivo histórico del despacho o de un abogado para un intervalo, moneda y métrica base configurados.
- La base se guarda explícitamente como `GENERADOS` o `COBRADOS`; no se infiere. La definición inicial preferida es `GENERADOS`, pero si no existe una meta configurada la UI muestra “Meta pendiente de configurar” y no inventa importe ni cumplimiento.
- **Cumplimiento:** numerador canónico de la base configurada / importe objetivo.
- **Pendiente para meta:** `max(0, meta - numerador)`.
- Una meta tiene vigencia e identidad única por alcance, periodo y base; no se sobreescribe la historia.

## 5. Definiciones comerciales y operativas

- **Presupuesto solicitado:** cotización creada en el periodo. Cantidad e importe cotizado usan la versión actual/campos canónicos, sin sumar versiones.
- **Cliente generado:** prospecto cuya cotización alcanzó aceptación o conversión. No equivale a mero prospecto ni a expediente duplicado.
- **Expediente por abogado:** expediente no archivado cuyo `abogado_id` corresponde al responsable. “Del año” significa abierto en el año seleccionado.
- **Firma programada:** expediente con `fecha_estimada_firma` en el intervalo y sin cancelación/archivo; no implica realización.
- **Firma realizada:** expediente con `fecha_real_firma` en el intervalo. Nunca se deduce sólo del estatus ni de una cita futura.
- **Monto firmado:** honorarios reconocidos asociados a expedientes con firma real en el periodo; no implica cobro.
- **Anticipo:** movimiento canónico aplicado de tipo `ANTICIPO`, relacionado con cotización o expediente. Una cotización no es un anticipo.
- **Reporte 80/20:** nombre operacional para expedientes/cotizaciones con al menos un anticipo canónico aplicado. Orden principal: honorarios generados descendentes. No representa una regla Pareto.
- **Cliente potencial:** cotización existente sin ningún movimiento canónico aplicado de tipo `ANTICIPO` relacionado. Es un reporte comercial, no otra tabla de prospectos.

## 6. Firmas y semanas

- Semana anterior y actual usan lunes 00:00 a domingo 23:59:59.999.
- Semana actual separa realizadas, pendientes programadas y total programado para evitar doble conteo.
- “Firmas acumuladas” se etiqueta de forma inequívoca como “Firmas realizadas este mes”.
- **Firmas defectuosas:** no existe actualmente un evento/estado canónico de defecto, fallo o incidencia. Cancelación y reprogramación no son equivalentes. La capacidad queda “Pendiente de definir con operación”; no se publica un KPI de cero.

## 7. Scope y privacidad

- Dirección y Administración pueden consultar agregados globales y financieros.
- Abogado, cuando tenga acceso a Reportes, recibe exclusivamente operación de expedientes donde es responsable/creador; el backend impone el filtro y no envía el conjunto global.
- Consulta puede recibir únicamente indicadores operativos autorizados. No recibe importes, cartera, metas económicas ni rendimiento financiero.
- Recepción y Gestoría no obtienen Reportes salvo permiso explícito futuro.
- `abogado_id` sólo es seleccionable para usuarios con alcance global. En scope propio se ignora/rechaza cualquier intento de ampliar alcance.

## 8. Endpoints y reconciliación

Los agregados se dividen por propósito: resumen, finanzas, cobranza, abogados, firmas, 80/20 y clientes potenciales. Los controllers sólo validan HTTP; las consultas y reglas viven en servicios. Cada respuesta incluye periodo, scope, definiciones y enlaces de drill-down.

Pruebas obligatorias:

1. generado = cobrado + por cobrar cuando no hay ajustes/reversiones;
2. ingresos = honorarios cobrados + terceros + otros destinos;
3. una cotización/expediente/reconocimiento se cuenta una sola vez;
4. firma programada no se cuenta como realizada;
5. semana y mes respetan límites;
6. permisos y scope se aplican antes de consultar/agregar.

## 9. Auditoría del módulo heredado

El antiguo `GET /api/reportes/resumen` no es fuente válida para la nueva UI porque:

- lee honorarios desde presupuesto/JSON del expediente;
- calcula saldos con el ledger legacy y mezcla semánticas;
- usa `created_at`/`fecha_apertura` como filtro común;
- carga expedientes completos y agrega en memoria;
- no aplica `expedienteAccessWhere` ni privacidad financiera diferenciada;
- entrega un único payload grande sin fallos parciales ni drill-down.

Se retira su consumo frontend. La ruta se sustituye conservando compatibilidad HTTP sólo donde la respuesta nueva sea inequívoca. Las consultas especializadas reutilizan `resolveFinancePeriod`, las naturalezas económicas y el scope de objetos. No se crean snapshots ni materializaciones en esta fase; primero se medirán índices y tiempos. Cache, si se incorpora después, deberá ser corto y nunca de horas para cifras financieras.

## 10. IA y trazabilidad

PRAVIA IA debe consumir los mismos servicios y permisos. Toda cifra responde con periodo, definición y fuente. Las sugerencias permitidas (`META_REZAGADA`, `CARTERA_ALTA`, `CLIENTE_SIN_ANTICIPO`, `EXPEDIENTE_80_20_SIN_FIRMA`, `FIRMA_PROXIMA_CON_SALDO`, `PRESUPUESTOS_SIN_SEGUIMIENTO`) se emiten sólo si el hecho canónico existe. No se evalúa subjetivamente a una persona ni se inventan metas o recomendaciones.
