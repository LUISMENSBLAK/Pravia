# Auditoría del dominio financiero de PRAVIA

Fecha de corte: 12 de agosto de 2026
Alcance: schema Prisma, migraciones, controladores, servicios, permisos, documentos, Cotizaciones, Expedientes, Agenda, auditoría e IA existentes.
Estado de este documento: decisión previa a cambios de schema; no representa una migración ejecutada.

## 1. Resumen ejecutivo

PRAVIA ya contiene una base financiera, pero no un libro de efectivo suficientemente normalizado para satisfacer las reglas del cliente. Existen dos representaciones de dinero: `Pago` (flujo comercial legacy, especialmente anticipos de cotización) y `MovimientoFinanciero` (motor operativo más reciente). El frontend nuevo no debe sumar ambas fuentes.

La decisión canónica es:

- `MovimientoFinanciero` será la única fuente de verdad de efectivo para operaciones nuevas.
- `Pago` se conserva temporalmente para compatibilidad con Cotizaciones y conversión de datos existentes, pero no se mezcla indiscriminadamente con el ledger.
- Todo `Pago` legacy deberá pasar por una clasificación idempotente en dry run antes de migrarse. Ya existe `legacyFinanceMigration.ts`, que se ampliará y seguirá sin ejecutar backfill real.
- Un movimiento nuevo no será efectivo contable hasta estar `APLICADO`; para aplicarlo deberá tener distribución cuadrada y comprobante interno trazable.
- Los archivos bancarios, tickets, PDF o imágenes serán evidencia externa. No reemplazan el comprobante interno de PRAVIA.
- Los honorarios generados se reconocerán una sola vez al aceptar una cotización con versión aprobada. La conversión posterior a expediente conserva el mismo reconocimiento; no crea otro. La cotización aceptada es el evento que prueba el compromiso económico del cliente en el flujo vigente.
- El valor de operación del expediente nunca participa en cálculos de honorarios, cobranza o efectivo.

## 2. Inventario del modelo existente

### `Cotizacion` y `CotizacionVersion`

`Cotizacion` conserva estado comercial, fechas de envío/aceptación/conversión y totales actuales (`total_notaria`, `honorarios_pravia`, `total_cliente`). `CotizacionVersion` conserva snapshots versionados del desglose y los importes; sólo una versión debería estar aprobada. El flujo vigente impide aceptar sin versión aprobada.

Hallazgo: los honorarios están presentes como presupuesto, pero no existe una entidad contable de reconocimiento. Los controladores financieros actuales los llaman “esperados” y sólo los llaman “generados” al firmarse el expediente. Esa definición contradice la regla del cliente: el monto comprometido debe existir aunque todavía no se haya cobrado.

### `Expediente`

Relaciona una cotización de forma uno a uno, congela un presupuesto operativo en `datos_operacion.presupuesto` durante la conversión y conserva `valor_operacion` por separado. La copia operativa contiene `total_notaria`, `honorarios_pravia`, `total_cliente` y el id de versión de cotización. La relación con abogado, notaría, comparecientes y fechas de firma permite agregación financiera posterior.

Hallazgo: el presupuesto JSON es una fuente operativa útil después de la conversión, pero no registra por sí solo el evento de reconocimiento ni vencimiento contractual de honorarios. `fecha_estimada_firma` no es una fecha de vencimiento de cobranza fiable.

### `MovimientoFinanciero`

Ya soporta ingreso/egreso, tipo, categoría libre, concepto, importe, fecha efectiva, forma de pago, cuenta en texto, referencia, URLs de comprobante/factura, estado, actor de captura/validación y relaciones de reverso. Tiene relación opcional con expediente y cotización, además de vínculos normalizados a `Documento`.

Fortalezas reutilizables:

- Es el candidato natural al ledger canónico.
- Conserva el actor y soporta reversos sin borrar historia.
- Ya existe validación básica de semántica y auditoría.
- Ya tiene vínculos documentales reutilizables para evidencia externa.

Carencias:

- No tiene folio propio ni fecha de registro explícita.
- No tiene cuenta normalizada, notaría/responsable/compareciente directos ni clave de idempotencia estable.
- `categoria` es texto y representa simultáneamente origen/destino económico.
- Un solo movimiento sólo admite una categoría; no permite distribuir un ingreso.
- `comprobante_url` confunde evidencia externa con comprobante interno.
- Los estados `RECIBIDO`/`VALIDADO` se usan como aplicados sin regla uniforme.
- El endpoint de Expedientes crea ingresos como `RECIBIDO` y egresos como `VALIDADO` inmediatamente, sin comprobante.
- La detección actual de duplicados usa una ventana de diez segundos y `fecha_validacion`; no es una idempotencia contractual.

### `Pago` (legacy)

Representa entradas asociadas a cotización/expediente mediante categorías (`HONORARIOS_ESPERADOS`, `HONORARIOS_RECIBIDOS`, `INGRESO_REAL_RECIBIDO`, `ANTICIPO_NOTARIA`, `PAGO_NOTARIA`). Se usa de forma activa para registrar y validar el anticipo que habilita la conversión de Cotización a Expediente.

Problemas:

- Mezcla expectativas económicas y efectivo en la misma tabla.
- No registra actor de creación como relación, cuenta ni distribución.
- `PAGO_NOTARIA` no determina si es recepción de fondos o salida a notaría.
- Puede representar el mismo dinero que `MovimientoFinanciero`.

El resumen financiero actual utiliza movimientos si existe al menos uno y, en caso contrario, traduce todos los pagos válidos como fallback. Evita algunas duplicaciones, pero puede ocultar pagos legacy cuando aparece un movimiento moderno parcial y no ofrece trazabilidad de migración.

### Presupuesto y honorarios

La función heredada `getOperationalBudget` prioriza `Expediente.datos_operacion.presupuesto` y cae a los totales de Cotización. Es una decisión compatible que debe conservarse para leer el compromiso económico congelado. `valor_operacion` no se usa en ese helper y las pruebas existentes exigen que no alimente avance financiero.

### Documentos y comprobantes

`Documento` proporciona storage seguro, metadatos y auditoría del archivo. `MovimientoDocumento` vincula documentos con movimientos e incluye tipo de vínculo y baja lógica. También permanecen campos legacy `comprobante_url`/`factura_url` y lógica de upload desde Expedientes.

No existe un comprobante financiero interno con folio, snapshot de datos, estado y anulación. Tampoco existe hoy motor de PDF de salida en las dependencias. Por ello se creará el comprobante interno como registro trazable y representación imprimible; la generación de PDF binario quedará separada hasta incorporar un motor/proveedor confirmado.

### Cuentas, banco y conciliación

No existe catálogo de cuentas bancarias/caja. Sólo `cuenta_receptora` como texto libre. No existen extractos bancarios, transacciones importadas, lotes de importación ni conciliaciones.

No hay integración bancaria ni formato de importación confirmado. Se construirá el motor desacoplado, con captura/importación preparada, pero se documenta explícitamente: **formato de importación bancaria pendiente de confirmar con el cliente**.

### Facturación

No existe PAC, SAT, CFDI, proveedor de timbrado, credenciales ni modelo fiscal canónico. Hay archivos `factura_url` y metadatos PDF/XML adjuntos a movimientos, que sólo acreditan documentos externos; no prueban emisión fiscal por PRAVIA.

La nueva interfaz mostrará gestión preparada y el estado “Integración de facturación pendiente de configuración”. No se ofrecerá timbrado ni se llamará “Factura emitida” a un registro preliminar.

### Auditoría, actores y permisos

`AuditLog` soporta actor, before/after, detalles y correlation id. Los movimientos existentes ya registran creación/reverso parcialmente. Debe extenderse a aplicar, cancelar, generar/anular comprobante, gestionar cuenta y conciliar.

Permisos actuales:

- `finanzas.read`, `finanzas.write`, `finanzas.validate` existen.
- Dirección tiene todos los permisos.
- Administración tiene los tres permisos financieros.
- Abogado, Recepción, Gestoría y Consulta no tienen acceso financiero global.

Problema: todas las rutas `/api/finanzas` sólo están protegidas globalmente con `finanzas.read`; si se añadieran POST/PATCH sin guardas específicas, un lector podría mutar. Cada acción nueva tendrá permiso explícito. `finanzas.validate` será necesario para aplicar, revertir/cancelar y conciliar. `finanzas.write` cubrirá borradores, comprobantes y cuentas según la matriz descrita en el servicio.

### Agenda y firmas

Agenda sólo programa o registra fechas de firma. No existe ningún flujo por el que una firma programada deba crear dinero. La fecha real de firma puede servir como información operativa, pero no es el evento elegido para reconocer honorarios ni para registrar cobro.

### IA

Ya existen tools financieras de sólo lectura con permiso doble (`ai.finanzas.read` y `finanzas.read`) y object scope por expediente. Actualmente calculan con el ledger simplificado. Se actualizarán para consumir agregados canónicos, indicar periodo y nunca inferir cifras desde texto o desde Agenda.

## 3. Fuentes de verdad actuales y decisión final

| Concepto | Fuente actual | Problema | Fuente canónica propuesta |
| --- | --- | --- | --- |
| Valor de operación | `Expediente.valor_operacion` | Puede confundirse con presupuesto | Se conserva aislado; nunca entra al ledger |
| Presupuesto aceptado | Cotización/versiones y snapshot del expediente | Doble representación compatible, sin reconocimiento | Versión aprobada + reconocimiento único |
| Honorarios generados | Calculados al firmar en `finanzas.controller` | Reconocimiento tardío y no persistido | `HonorarioGenerado` al aceptar cotización |
| Efectivo | `Pago` y `MovimientoFinanciero` | Dos fuentes potencialmente duplicadas | `MovimientoFinanciero` aplicado |
| Distribución económica | Categoría única en movimiento | No permite split | `MovimientoDistribucion` |
| Comprobante interno | No existe | URL externa no es folio interno | `ComprobanteFinanciero` |
| Evidencia externa | URL legacy y `MovimientoDocumento` | Dos representaciones | `MovimientoDocumento`; URL sólo compatibilidad |
| Cuenta | Texto libre | Sin catálogo ni privacidad | `CuentaFinanciera` |
| Conciliación | No existe | Sin comparación banco/PRAVIA | Transacción bancaria + conciliación |
| Facturación fiscal | Adjuntos PDF/XML | No prueban CFDI/timbrado | Integración pendiente, sin afirmaciones falsas |

## 4. Definiciones económicas canónicas

- **Ingresos recibidos:** suma del importe total de movimientos `INGRESO` en estado `APLICADO` dentro del periodo. No incluye borradores, pendientes, cancelados ni reversados.
- **Honorarios generados:** suma de reconocimientos únicos de honorarios derivados de una Cotización aceptada con versión aprobada. Si luego se convierte en Expediente, el reconocimiento se enlaza al expediente y conserva el mismo origen; no se duplica.
- **Honorarios cobrados:** suma de distribuciones aplicadas cuya categoría tiene naturaleza económica `DESPACHO`, limitada por sus relaciones a los reconocimientos/expedientes correspondientes. No es todo el ingreso recibido.
- **Honorarios por cobrar:** `max(0, honorarios generados - honorarios cobrados aplicados)`. Nunca usa `valor_operacion` ni `total_cliente` completo.
- **Fondos de terceros recibidos:** suma de distribuciones aplicadas con naturaleza `TERCERO`.
- **Otros destinos:** distribuciones aplicadas con naturaleza `OTRO`. Tampoco pertenecen al despacho, pero no se presentan silenciosamente como fondos de terceros. La reconciliación visible es `ingresos recibidos = honorarios cobrados + fondos de terceros + otros destinos`.
- **Egresos:** suma de movimientos `EGRESO` aplicados.
- **Pendiente de distribución/pago:** para clasificación, importe del borrador menos distribuciones; para recursos de terceros ya aplicados, fondos recibidos para terceros menos egresos aplicados asociados a esa naturaleza.
- **Anticipo:** tipo de un movimiento de ingreso; su efectivo se cuenta una sola vez y su distribución determina qué parte aplica a honorarios o terceros. La condición comercial de conversión se comprobará contra un anticipo canónico aplicado, con lectura legacy temporal durante la transición.

## 5. Evento de reconocimiento de honorarios

Se elige **Cotización ACEPTADA con una versión aprobada** como evento canónico porque el flujo actual exige propuesta aprobada antes de aceptación y la aceptación representa el compromiso económico del cliente. Esperar a la firma confunde devengo comercial con ejecución operativa; esperar al cobro viola la definición del cliente.

Reglas:

1. Al transicionar a `ACEPTADA`, se toma un snapshot de `honorarios_pravia` de la versión aprobada.
2. Se crea un único reconocimiento con clave de origen `COTIZACION:<id>`.
3. La conversión posterior sólo asigna `expediente_id` al mismo reconocimiento.
4. Reintentos son idempotentes mediante índice único de origen/cotización.
5. Cotizaciones históricas aceptadas/convertidas requieren dry run antes de backfill; mientras no se ejecute, el servicio puede exponerlas como “reconocimiento legacy derivado” sin escribir ni duplicar.
6. Modificar importes después de aceptación no sobreescribe el reconocimiento: requiere ajuste auditable.

## 6. Cambios de schema propuestos

### Ampliar `MovimientoFinanciero`

- `folio` único generado por backend.
- `fecha_registro` y `updated_at`.
- FKs opcionales: `cuenta_id`, `notaria_id`, `responsable_id`, `compareciente_id`.
- `descripcion`, `idempotency_key`, `aplicado_por_id`, `fecha_aplicacion`, `cancelado_por_id`, `fecha_cancelacion`, `motivo_cancelacion`.
- Nuevos estados compatibles: `BORRADOR`, `PENDIENTE_COMPROBANTE`, `LISTO_APLICAR`, `APLICADO`; se conservan estados legacy para lectura/migración.
- Índices por fecha/estado/naturaleza/cuenta/expediente/cotización/notaría/responsable y búsqueda por folio/referencia.

### `CategoriaFinanciera`

Catálogo administrable con clave, nombre, naturaleza económica (`DESPACHO`, `TERCERO`, `EGRESO_DESPACHO`, `TRANSFERENCIA_INTERNA`, `OTRO`), dirección permitida, activo y orden. Semillas mínimas: Honorarios, Notaría, Registro Público, Derechos, Impuestos, Gastos y Otros terceros. No se crean cuarenta categorías arbitrarias.

### `MovimientoDistribucion`

Detalle de movimiento/categoría/importe/observación y aplicación opcional al reconocimiento de honorarios. La suma debe ser exactamente igual al importe antes de aplicar. La validación se hará en transacción y se respaldará con constraints de importes positivos; la suma entre filas requiere lógica transaccional, no sólo frontend.

### `HonorarioGenerado`

Snapshot auditable del compromiso: cotización, versión, expediente opcional, importe original, saldo/fecha de vencimiento opcional, fecha y evento de reconocimiento, estado y clave de origen única. No representa efectivo.

### `ComprobanteFinanciero`

Un comprobante interno por movimiento con folio backend, tipo, fecha, importe, concepto, persona, expediente, forma de pago, cuenta, actor, observaciones, snapshot y estado. La evidencia externa seguirá en `MovimientoDocumento`. La anulación conserva historia.

### `CuentaFinanciera`

Banco/institución, alias, tipo, últimos cuatro, moneda, activa, predeterminada y saldo inicial calculable. No se requiere almacenar ni mostrar CLABE completa en esta fase. Una cuenta tipo Caja/Efectivo sólo estará disponible como categoría explícita si Administración la configura; no se simula una cuenta bancaria.

### Conciliación

- `TransaccionEstadoCuenta`: cuenta, fecha, importe con signo/naturaleza, descripción, referencia, fingerprint único, fuente y estado.
- `ConciliacionFinanciera`: movimiento, transacción bancaria, estado, método exacto/sugerido/manual, score informativo, actor, fecha y justificación.
- El matching sugerido usa el algoritmo determinista y versionado `PRAVIA_RECONCILIATION_V1`: importe exacto y misma cuenta son requisitos (65 puntos); misma fecha suma 20, fecha dentro de dos días suma 10 y referencia exacta/contenida suma 15. Sólo se sugiere desde 65 puntos, se devuelven los factores explicativos y nunca se aplica automática ni irreversiblemente.
- El origen de importación queda modular; no se inventa banco ni proveedor.

## 7. Compatibilidad y migración

1. La migración de schema será aditiva; no eliminará `Pago`, URLs ni estados legacy.
2. Movimientos existentes `RECIBIDO`/`VALIDADO` seguirán leyéndose como efectivos legacy, pero deberán marcarse como tales en agregados y no recibir distribuciones sintéticas silenciosas.
3. El ledger nuevo sólo crea movimientos con el flujo borrador → comprobante → listo → aplicado.
4. El endpoint antiguo de alta en Expedientes dejará de autoaplicar; delegará en el mismo servicio de dominio y mantendrá su ruta por compatibilidad.
5. `Pago` continuará habilitando temporalmente conversiones históricas. Para datos nuevos, el anticipo canónico aplicado será la fuente preferente.
6. `legacyFinanceMigration.ts` clasifica: migración segura, ya representado, duplicado probable, ambiguo o revisión. El script seguirá siendo dry run e idempotente; ningún backfill se ejecutará en producción en esta fase.
7. `HONORARIOS_ESPERADOS` nunca se migrará a efectivo. `PAGO_NOTARIA` seguirá siendo ambiguo hasta revisión humana.
8. Rollback conceptual: retirar rutas/lecturas nuevas y conservar columnas/tablas aditivas sin pérdida; no se borran movimientos, pagos ni adjuntos existentes.

## 8. Invariantes que aplicará backend

1. Un movimiento sin comprobante interno activo no puede aplicarse.
2. La suma de distribuciones debe igualar exactamente el importe del movimiento.
3. Sólo movimientos no aplicados pueden editar datos económicos/distribuciones.
4. Aplicar es idempotente y bloqueado transaccionalmente.
5. Un movimiento aplicado se corrige por reverso/cancelación auditable, no por edición destructiva.
6. Un pago legacy y un movimiento canónico no se suman si representan el mismo efectivo.
7. `valor_operacion` nunca alimenta honorarios ni cobranza.
8. Una firma programada y una cotización descargada no crean efectivo.
9. Fondos de terceros nunca se presentan como honorarios/utilidad.
10. Folios e importes finales se generan/revalidan en backend; la UI no es autoridad.

## 9. Riesgos conocidos y verificaciones pendientes

- No hay vencimiento contractual fiable para todos los honorarios. Aging sólo se mostrará cuando exista `fecha_vencimiento`; de lo contrario, la cartera mostrará pendiente sin inventar antigüedad.
- Debe confirmarse con el cliente el formato de importación bancaria.
- Debe elegirse proveedor/PAC y política fiscal antes de implementar CFDI.
- Las URLs legacy pueden apuntar a storage antiguo; no se considerarán comprobante interno.
- Cualquier backfill de pagos o reconocimientos requiere reporte dry run y aprobación separada.

## 10. Resultado objetivo de la fase

Al finalizar, PRAVIA tendrá un ledger canónico, distribuciones económicas, candado de comprobante, cuentas seguras, conciliación manual/sugerida desacoplada, cartera basada en honorarios —no valor de operación—, permisos explícitos, auditoría y agregados reutilizables por Reportes. Facturación quedará representada con honestidad como integración pendiente, sin simular CFDI.
