# Dominio de cumplimiento de PRAVIA OS

## Alcance y principio de decisión

PRAVIA OS apoya la revisión operativa de UIF e ISR. El flujo canónico es:

`datos → RuleSet versionado → evaluación determinista → explicación asistida → confirmación humana`.

La salida del sistema no es un dictamen legal, fiscal, de licitud ni una constancia de presentación ante autoridad. PRAVIA IA no decide si una persona es PEP, no hace screening externo, no confirma cumplimiento y no modifica resultados sensibles sin una acción humana autorizada.

## Auditoría del estado previo a Fase 12

La auditoría revisó `schema.prisma`, migraciones, rutas, controladores, servicios, pruebas, permisos, jobs, documentos, asistente y trazabilidad.

Existían:

- `ComplianceRuleSet`: tipo, clave, versión, vigencia, fuente, parámetros y cuestionario versionados.
- `ComplianceReview`: revisión por expediente y tipo, respuestas, resultado y actor revisor.
- `ComplianceEvidence`: vínculo a un `Documento` existente; no duplica almacenamiento.
- `PersonaFisica.pep_estado`: declaración maestra `PENDIENTE | SI | NO` y relación PEP opcional.
- `ComparecienteDatoFuente`: procedencia a nivel campo, documento/página, valor detectado/confirmado y confirmador humano.
- permisos `cumplimiento.read`, `cumplimiento.write` y `cumplimiento.confirm`, más object scope por expediente.
- RuleSets semilla para UIF y preparación ISR y un motor determinista en `domain/compliance.ts`.

Brechas detectadas:

- la revisión sólo guardaba `rule_version_snapshot`; al evaluar volvía a leer `parametros` del RuleSet mutable;
- no existía snapshot de master data ni indicador verificable de cambios posteriores;
- la cola tenía límite fijo, no paginación server-side;
- la confirmación podía volver a escribir una revisión ya confirmada;
- no existía historial inmutable separado de decisiones humanas;
- no había pantalla funcional de Riesgos / UIF;
- no existe entidad maestra independiente de beneficiario controlador, propietario real, origen de fondos ni aviso presentado;
- una migración histórica agregó campos UIF contextuales a `expediente_comparecientes`, pero el `schema.prisma` vigente no los declara. Fase 12 no depende de esos campos huérfanos y deja registrada la deriva para reconciliación controlada.

No se encontraron jobs que recalculen cumplimiento en segundo plano. Esto es correcto: una revisión histórica no debe cambiar silenciosamente.

## Modelos después de Fase 12

### `ComplianceRuleSet`

Fuente versionada de reglas. Una versión incluye tipo, clave, versión, vigencia, estado, fuente, parámetros y cuestionario. La selección exige que la fecha de operación esté dentro de la vigencia y que la regla no esté retirada.

### `ComplianceReview`

Instancia histórica ligada a un expediente. Conserva:

- `rule_version_snapshot`: etiqueta corta de versión;
- `rule_snapshot`: copia completa del RuleSet utilizado;
- `master_snapshot`: datos del expediente y comparecientes usados, con procedencia disponible;
- `snapshot_captured_at`: fecha de captura;
- cuestionario y resultado persistidos;
- `supersedes_review_id`: linaje explícito cuando una reevaluación crea una revisión nueva.

Los snapshots no se actualizan cuando cambia el maestro. Una revisión confirmada es de sólo lectura.

### `ComplianceDecision`

Registro inmutable de la decisión humana. Guarda decisión, observaciones, resultado, regla y master data tal como estaban, actor y fecha. No sustituye `AuditLog`; lo complementa con evidencia de dominio.

### `ComplianceEvidence`

Referencia un `Documento` ya almacenado y accesible dentro del expediente. No guarda rutas, buckets ni URLs internas. Una revisión confirmada no acepta evidencia nueva.

## RuleSets, fuentes y vigencias

El RuleSet UIF semilla usa la LFPIORPI con última reforma publicada el 16 de julio de 2025 y la UMA 2026 de INEGI, vigente desde el 1 de febrero de 2026, con valor diario de $117.31 MXN. Fuentes oficiales:

- LFPIORPI: <https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf>
- historial de reformas: <https://www.diputados.gob.mx/LeyesBiblio/ref/lfpiorpi.htm>
- UMA 2026: <https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf>

El RuleSet ISR semilla referencia la LISR vigente en la fuente de Cámara de Diputados (última reforma publicada el 1 de abril de 2024): <https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf>.

Una referencia oficial no implica que el producto emita una opinión legal. Las reglas deben ser aprobadas y sustituidas mediante una versión nueva; no se editan retrospectivamente para cambiar una revisión histórica.

## Datos actuales y snapshot histórico

El maestro de Comparecientes representa la información actual. Al crear una revisión, PRAVIA captura el expediente, acto, importe, notaría, responsable y comparecientes con RFC/CURP, PEP declarado, identidad disponible, domicilios, representación y procedencia disponible. El formulario se prellena únicamente con datos conocidos; cada valor indica origen y fecha.

Cambiar un RFC, domicilio o PEP maestro después no modifica la revisión. El backend compara `updated_at` del maestro actual contra las versiones/fechas capturadas y expone `master_data_changed` para invitar a una reevaluación explícita.

## PEP

PEP proviene exclusivamente de `PersonaFisica.pep_estado` o de la respuesta confirmada dentro de la revisión. `PENDIENTE` no equivale a `NO`. No se infiere por nombre, profesión, cargo o IA. No existe integración externa de screening en esta fase.

## Beneficiario controlador / propietario real

No existe un registro maestro completo e independiente. El motor solicita la identificación o declaración correspondiente en el cuestionario UIF y conserva respuesta, evidencia y actor en el snapshot. La UI lo presenta como dato por confirmar, nunca como maestro inexistente.

La migración `20260726000000_expedientes_core_engine` contiene indicadores contextuales (`es_beneficiario_controlador`, `es_proveedor_recursos`, `observaciones_uif`), pero el esquema Prisma actual no los modela. Reconciliar esa deriva requiere una tarea de datos separada; Fase 12 no finge que ya es una fuente fiable.

## Origen de fondos

Se registra como declaración/evidencia contextual de la revisión. Un texto libre no se convierte en verdad legal. El resultado sólo distingue si la información requerida está documentada y deja la conclusión a revisión humana.

## UIF

`evaluateUif` selecciona el supuesto configurado, obtiene la base definida por regla, suma operaciones relacionadas del periodo configurado, compara el umbral de UMA o aplica `aviso_siempre`, y valida datos mínimos. Persiste importes, umbral, fundamento, faltantes y alertas explicables.

El resultado `REQUIERE_AVISO` significa que la regla configurada requiere acción/revisión. PRAVIA no tiene entidad ni integración de presentación de avisos; por tanto no muestra estados “presentado” o “aceptado” ni afirma envío a autoridad.

## ISR

ISR es un flujo separado. `assessIsrCompleteness` verifica insumos de la versión seleccionada y devuelve `INSUMOS_INCOMPLETOS` o `LISTO_PARA_REVISION_FISCAL`. Su `motor_estado` es `NO_CALCULADO`: PRAVIA no calcula ISR en esta versión.

## Alertas y explicabilidad

Las alertas son parte del resultado persistido de una revisión; no son notificaciones, tareas ni eventos de agenda. Cada alerta estructurada indica mensaje, regla, dato utilizado, fuente y acción sugerida. No se genera un puntaje Bajo/Medio/Alto porque no existe una metodología de scoring aprobada.

## Confirmación, reevaluación e historial

Sólo `cumplimiento.confirm` permite confirmar o solicitar ajustes. La decisión crea un `ComplianceDecision` inmutable con actor, fecha y snapshots. Una revisión confirmada no puede evaluarse, editarse ni recibir evidencia.

“Reevaluar” crea una revisión nueva con el RuleSet aplicable a la fecha solicitada, captura el master actual y enlaza `supersedes_review_id`; nunca pisa el historial. La comparación distingue cambio de datos, cambio de versión y cambio de resultado.

## Permisos y object scope

- `cumplimiento.read`: cola, revisión, snapshots y evidencia dentro del alcance.
- `cumplimiento.write`: crear/evaluar/reevaluar y agregar evidencia dentro del alcance.
- `cumplimiento.confirm`: decisión humana final, además de `write`.

El backend aplica `expedienteAccessWhere` en catálogo, cola y cada operación por id. Dirección/Administración/Consulta conservan el alcance definido por la política global; Consulta es sólo lectura porque no recibe permisos write/confirm. Abogado sólo recibe expedientes asignados o creados. La UI oculta acciones, pero el control decisivo permanece en backend.

## Auditoría y PRAVIA IA

Crear, evaluar, reevaluar, vincular evidencia y decidir generan `AuditLog`. La IA obtiene revisiones sólo tras comprobar `ai.cumplimiento.read`, `cumplimiento.read`, `expedientes.read` y object scope. Sus explicaciones deben citar revisión, regla/versión, dato y procedencia. Acciones sensibles siguen requiriendo permiso y confirmación humana.

## Afirmaciones prohibidas

PRAVIA no debe afirmar que:

- una operación es legal, ilegal o “cumple la ley” de forma autónoma;
- una persona es o no es PEP sin declaración/fuente registrada;
- existe beneficiario controlador maestro si sólo hay una respuesta contextual;
- el origen de fondos quedó legalmente acreditado por un texto libre;
- un aviso fue presentado o aceptado por la autoridad;
- ISR fue calculado o dictaminado;
- un resultado histórico refleja datos actuales si pertenece a un snapshot anterior.

## Pendientes fuera de Fase 12

- reconciliar formalmente la deriva de columnas históricas de `expediente_comparecientes`;
- diseñar, con negocio y migración propia, un maestro de beneficiario controlador si se aprueba;
- integrar screening PEP externo sólo con proveedor, autorización y trazabilidad definidos;
- implementar ciclo de vida de aviso UIF sólo cuando exista entidad, evidencia e integración real;
- aprobar con especialista fiscal una versión futura de cálculo ISR antes de habilitar cualquier importe calculado.

## Cierre técnico de frontend

La medición previa entregaba un único chunk inicial JavaScript de 674.58 kB y una hoja CSS de 330.64 kB. La causa era estructural: `App.tsx` importaba de forma estática todas las páginas operativas y el drawer completo de PRAVIA IA, aun cuando la ruta o el asistente no estuvieran abiertos.

Las páginas se cargan ahora por ruta y el drawer del asistente se descarga al abrirlo. El launcher y el contexto mínimo siguen disponibles globalmente. El build posterior deja el chunk inicial en 231.80 kB (76.08 kB gzip) y su CSS en 29.41 kB (6.59 kB gzip); los módulos mayores quedan en chunks de dominio, sin modificar el registro de la PWA.

La lentitud de Vitest tampoco provenía de requests reales, retries o Promises sin resolver. Cada archivo renderiza la aplicación integrada, y la ejecución con muchos workers transformaba simultáneamente los mismos módulos y CSS; los flujos con varios pasos agotaban entonces el límite local de cinco segundos. Se limitó la transformación a un worker, sin aumentar `testTimeout`, y se actualizaron únicamente dos aserciones del drawer para esperar su importación dinámica real. La suite normal queda en 108/108 pruebas, 16.96 segundos totales y 11.16 segundos de ejecución de tests.
