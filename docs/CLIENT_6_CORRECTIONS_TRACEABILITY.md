# Seis correcciones del cliente — trazabilidad de implementación local

Estado: **EN CURSO / NO-GO**. Este registro distingue código inspeccionado, pruebas ejecutadas y pruebas pendientes; la presencia de una función no equivale a certificación E2E.

Fuentes: prompt maestro del 20-10-2026 y sus seis DOCX. Ningún dato de producción se ha modificado en esta intervención. Las pruebas de migración se ejecutaron exclusivamente sobre la copia PostgreSQL local `pravia_six_corr_qa`.

| Corrección | Canon existente / dependencia | Trabajo comprobado hasta ahora | Pendiente para cerrar |
|---|---|---|---|
| Una notaría por tenant | `Organization` es el tenant; `Notaria`, `Expediente.notaria_id` y propietario `NOTARIA` de CFG-002 siguen siendo relaciones históricas. | Configuración → Organización, redirecciones frontend, menú/búsqueda sin entidad interna, ruta CRUD `/api/notarias` desmontada, permiso nuevo no otorgado, filtros visibles retirados en Reportes/Cumplimiento/Expedientes y nuevo movimiento financiero sin `notaria_id`. Migración expand/backfill idempotente ensayada en copia local. | CFG-001/002 aún depende de propietario `NOTARIA`; diseñar y probar cutover de artefactos/carpetas/plantillas sin perder asignaciones, auditar otros endpoints y ejecutar TN01–TN18 con dos tenants en Chrome. No borrar FK/tabla legacy antes. |
| Carga universal | `StorageProvider`, subida documental canónica, compensación, límites y rutas de Archivo/CFDI/EXP ya existen. | En Chrome local, retry tras corte de red creó un único blob nuevo de 102400 bytes; DB y Storage local coinciden por SHA-256. Otra prueba Chrome cargó exactamente 50 MiB (52428800 bytes), persistió tras reload y el SHA-256 físico coincide con la DB. Se detectó y corrigió sólo en la copia QA la falta de seis migraciones que impedía la carga física nueva. | Ejecutar el resto de UP01–UP31: sobrelímite, 10 cargas sucesivas, preview/descarga, otros módulos y fallos inducidos; verificar coherencia de límites en el hosting. Los 26 blobs históricos no localizados siguen fuera de esta intervención. |
| Expediente, comparecientes, predios, explorador | Modelos y servicios de actos, partes, predios, documentos y proyecto existen. | Inventario de rutas/modelos en curso. | EXD01–EXD27, en particular porcentaje por carácter configurado, importación ZIP/RAR sin traversal, carpetas y versión documental. |
| Biblioteca jurídica y motor de cotizaciones | CFG-001/002, biblioteca, presupuesto y Cotización ya tienen servicios canónicos. | Inventario en curso; no se han inventado tasas ni fundamentos. | BJ01–BJ35 y cálculo real por jurisdicción/vigencia, revisión humana y Word sin apéndice de cotización duplicado. |
| CFDI / CSF / fiscal | Finanzas fiscal y entidades/proveedores ya existen; PAC real no está certificado. | Sin timbrado ni escritura fiscal externa. | CF01–CF40, CSF/preview/persistencia y pruebas PAC sandbox cuando exista credencial aprobada. No declarar CFDI real emitido. |
| Integración final | Matriz mínima de 226 casos en `CLIENT_6_CORRECTIONS_CERTIFICATION.md`. | Backend global y pruebas focalizadas ejecutadas; validar conteos al finalizar los procesos en curso. | E2E transversal, regresión PostgreSQL/Storage y navegador, RBAC/tenant, revisión independiente. Backup externo/restauración y 26 objetos no localizados mantienen NO-GO para release. |

## Clasificación de `notaria_id`

- **Configuración actual a migrar:** propietario `NOTARIA` en `CatalogoCarpeta`/`CatalogoArtefacto`, bootstrap CFG-002 y asignación de machotes. Cambiarlo sin backfill rompería resolución legal; no se ha tocado aún.
- **Distribución medida sólo en la copia QA:** una organización conserva 1 Notaría legacy, 10 artefactos y 3 asignaciones de machote; otra conserva 2 Notarías legacy y ningún artefacto. Una conversión indiscriminada de `NOTARIA` a propietario organizacional no debe fusionar identificadores, versiones ni reglas de selección sin matriz previa por tenant.
- **Histórico a preservar:** `Notaria`, contactos, `Expediente.notaria_id`, `Cotizacion.notaria_id`, registros anteriores y relaciones auditables.
- **Selector/filtro obsoleto retirado en el trabajo actual:** navegación `/notarias`, búsqueda global, vistas nuevas de Finanzas/Reportes/Expedientes/Cumplimiento y cabecera editable de Expediente.
- **Lecturas legacy a seguir auditando:** `finanzas.controller.ts` y lectores de reportes antiguos. No autorizar nuevas escrituras condicionadas a un ID de Notaría suministrado por cliente.

## Criterio de evidencia

`PASS` sólo tras ejecución del caso con resultado reproducible. `NOT VERIFIED` incluye todo caso pendiente de Chrome, PostgreSQL físico o Storage real local. Tests verdes de módulos no sustituyen la matriz contractual.

Evidencia física local del 20-10-2026: `frontend/e2e/upload-network-retry-local.spec.ts` pasó en Chrome para archivo único tras retry y para archivo de 50 MiB; ambos blobs fueron cotejados contra `pravia_os.documentos` por tamaño y SHA-256 en `/tmp/pravia-six-corr-storage.KrmHl8`. El PNG de 100 KiB además abrió en la vista previa protegida tras reload y Chrome confirmó la imagen decodificada (ancho natural de 1 px). El primer intento de carga física falló con HTTP 500 porque la copia QA estaba en la migración `20261012010000_mi_dia_modular`; se aplicaron únicamente en esa copia local las seis migraciones pendientes hasta `20261020090000_organization_institutional_profile` y el mismo test pasó. Esto no prueba Storage productivo ni todos los destinos de upload.
