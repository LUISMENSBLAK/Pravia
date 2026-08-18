# Cierre técnico de bloqueos — cutover PRAVIA OS

Fecha: 2026-08-17 local / 2026-08-18 UTC
Commit base auditado: `e78be2e2ef3b11d1c8176e71bc77572867f1717d` — el target final se captura con `git rev-parse HEAD` desde el checkpoint que contiene este cierre
Resultado técnico: **PASS — LISTO PARA DECISIÓN HUMANA**

Este documento contiene únicamente agregados sanitizados. El informe individual con IDs y referencias permanece fuera del repositorio, con permisos restringidos.

## Auditoría documental

- Filas `documentos` auditadas individualmente: 70.
- Blobs Storage respaldados: 161/161.
- Documentos actualmente legibles mediante bucket canónico: 44.
- Los 44 blobs canónicos coinciden en tamaño y SHA-256 con el backup: PASS.
- Metadatos producción vs restore pre-migración: PASS.
- Metadatos producción vs restore post-migración: PASS.
- Blobs perdidos por migración: 0.
- Documentos con blob existente perdidos después del rehearsal: 0.

Semántica de dominio verificada:

- `ExpedienteRequisitoDoc` representa requisitos/slots documentales todavía no cargados.
- `Documento` representa un archivo previamente recibido y exige `storage_key`, nombres interno/original, MIME, tamaño, fecha de carga y usuario que lo subió.
- Los 26 registros sin blob conservan las siete evidencias obligatorias de carga previa.
- Requisitos nunca cargados entre esos 26: 0.
- Archivos oficiales previamente cargados y ahora ausentes: 26.
- Estado desconocido: 0.

Clasificación secundaria de sus referencias de almacenamiento:

| Clasificación | Cantidad |
|---|---:|
| `LEGACY_REFERENCE_FORMAT` | 4 |
| `BROKEN_REFERENCE` | 22 |

- Recuperables por evidencia inequívoca en backups/manifests/rutas conocidas: 0.
- Documentos activos no resueltos: 26.
- Decisión: **HUMAN ACCEPTANCE REQUIRED** antes del GO.

No se usó similitud de nombre, inferencia de contenido ni deduplicación cross-tenant.

## Referencias financieras adicionales no HTTP

- Referencias encontradas: 2 (`comprobante_url` y `factura_url`).
- Ambas son nombres de archivo legacy sin ruta HTTP.
- Ambas conservan nombre original, MIME y tamaño positivos, y pertenecen a un movimiento `VALIDADO`.
- Clasificación semántica: 2 `PREVIOUSLY_UPLOADED_BLOB_MISSING`; estado desconocido: 0.
- Blob exacto en bucket canónico: no.
- Blob exacto en bucket legacy: no.
- Coincidencia exacta en backup: no.
- Archivo local legacy resoluble por backend: no.
- Backend actual puede resolverlas: no.
- Clasificación: 2 `BROKEN_REFERENCE`.
- Resueltas: 0/2.

## Smoke visual autenticado local

- Login: PASS.
- Mi Día: PASS.
- Prospectos: PASS.
- Cotizaciones: PASS.
- Expedientes: PASS.
- Notarías: PASS.
- Comparecientes: PASS.
- Finanzas: PASS.
- Agenda: PASS.
- Reportes: PASS.
- Cálculo ISR: PASS.
- Riesgos/UIF: PASS.
- Configuración: PASS.
- PRAVIA IA drawer: PASS.
- Refresh y persistencia de sesión: PASS.
- Organization activa, rol y permisos: PASS.
- Errores visibles: ninguno.

Las credenciales efímeras se introdujeron solo en `127.0.0.1`; no se guardaron ni enviaron a producción.

## OpenAI sintético

- Smoke documental original: prueba sintética sin datos personales ni productivos.
- Resultado: PASS.
- Modelo documental observado: `gpt-5.4-nano-2026-03-17`.
- Respuesta esperada: PASS.
- AIUsage en DB local: PASS.
- Datos productivos enviados: ninguno.

Smoke posterior por la ruta general:

- Prompt: `Responde únicamente: PRAVIA OK`.
- Resultado: PASS; respuesta `PRAVIA OK`.
- Modelo resuelto: `gpt-5.4-mini`.
- Fuentes/datos productivos enviados: 0/ninguno.
- Routing enfocado: 5/5 PASS.
- Assistant fallback independiente del modelo documental: PASS.
- Escalamiento Nano → Mini: PASS.

Transcripción sintética:

- Audio generado localmente: “Prueba de transcripción PRAVIA”.
- Modelo: `gpt-4o-mini-transcribe`.
- Transcripción esperada: PASS.
- AIUsage en DB local: PASS.
- Datos productivos enviados: ninguno.

## Netlify read-only

- Sesión autenticada local encontrada y usada sin imprimir token.
- Site: `pravianetwork`.
- Repository: `LUISMENSBLAK/Pravia`.
- Branch: `main`.
- Base: `frontend`.
- Build: `npm run build`.
- Publish: `dist`.
- Nombres de variables configuradas: 0.
- Variables frontend obligatorias faltantes: ninguna; el build productivo usa defaults same-origin `/api`.
- Inventario de variables: PASS.

## Resultado

- Bloqueos técnicos restantes: ninguno.
- Decisión documental humana pendiente: aceptar o remediar 26 documentos y 2 adjuntos financieros preexistentes sin archivo resoluble.
- Organization, Membership, operadores, ventana y push: pendientes de aprobación humana.
- Cambio funcional posterior al rehearsal: exclusivamente routing canónico de PRAVIA IA; backend 413/413 y frontend 190/190 PASS.
- Escrituras productivas: ninguna.
- Migraciones productivas: ninguna.
- Push: no.
- Deploy: no.
