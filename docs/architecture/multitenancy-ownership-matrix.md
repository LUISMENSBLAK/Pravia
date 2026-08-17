# Matriz de ownership multitenant

Convenciones: `T` tenant-owned explícito; `D` hijo/derivado con `organization_id` para defensa y consultas directas; `G` global/plataforma; `U` identidad o preferencia personal; `H` configuración híbrida. Todos los T/D tienen índice simple de organización en la migración; los caminos calientes añaden índices compuestos.

| Entity | Tipo | Tenant source | Índice / constraint principal | Notas |
|---|---|---|---|---|
| Organization | G | propia frontera | status | Tenant canónico |
| OrganizationMembership | T | organization_id | unique(org,user), org/status, user/status | Rol efectivo por organización |
| User | U | Membership | email global unique; consultas por Membership | Identidad compartible, no datos de negocio |
| AuthSession | T | Membership seleccionada | org/revoked/expires; FK Membership | Contexto tenant autoritativo |
| PasswordResetToken | U | User | token global unique | Recuperación de identidad |
| UserPreference | U | User | user unique | Preferencia personal |
| UserInvitation | T | ActorContext | org index/FK | Invita solo a organización activa |
| Notification | T | ActorContext | org + recipient/read | Destinatario debe ser miembro |
| Prospecto | T | ActorContext | org; hot filters por middleware | Comercial |
| ProspectoSeguimiento | D | Prospecto | org + trigger Prospecto | Consulta directa frecuente |
| ProspectoEtapaCatalogo | G | catálogo | código/orden | Pipeline común |
| ProspectoServicioCatalogo | G | catálogo | código/orden | Actos/servicios comunes |
| Notaria | T | ActorContext | org | Entidad operativa; no tenant |
| NotariaContacto | D | Notaria | org + trigger Notaria | Hereda Notaria |
| Cotizacion | T | ActorContext | org; folio global compatible | Comercial |
| CotizacionVersion | D | Cotizacion | org + unique(cotización,versión) | Snapshot |
| CotizacionSeguimiento | D | Cotizacion | org + trigger Cotización | Historial |
| TipoActo | G | catálogo | id | Normativa común |
| FormularioSeccion | G | TipoActo | unique(tipo,clave) | Catálogo |
| FormularioCampo | G | Sección | unique(sección,clave) | Catálogo |
| FlujoEtapa | G | TipoActo | unique(tipo,clave) | Catálogo |
| FormularioVersion | G | TipoActo | unique(tipo,versión) | Configuración versionada común |
| FlujoVersion | G | TipoActo | unique(tipo,versión) | Configuración versionada común |
| PlantillaDocumentalVersion | H | NULL global o Notaria tenant | unique(tipo,notaría,versión) + trigger Expediente/template | Global si no tiene Notaría; privada de la Organization de la Notaría en caso contrario |
| ChecklistItem | G | TipoActo | tipo_acto_id | Catálogo |
| Expediente | T | ActorContext | org/status/updated | Folio sigue global unique por compatibilidad |
| ExpedienteEstatus_Log | D | Expediente | org + trigger | Historial |
| ExpedienteEtapa | D | Expediente | org + trigger | Snapshot de flujo |
| Documento | T | ActorContext | org/created; path global unique | Ownership documental explícito |
| ExpedienteDocumento | D | Expediente + Documento | org + triggers ambos padres | Rechaza cruce |
| CotizacionDocumento | D | Cotizacion + Documento | org + triggers ambos padres | Rechaza cruce |
| ProspectoDocumento | D | Prospecto + Documento | org + triggers ambos padres | Rechaza cruce |
| RequisitoDocumentoVinculo | D | Requisito + Documento | org + triggers | Rechaza cruce |
| MovimientoDocumento | D | Movimiento + Documento | org + triggers | Rechaza cruce |
| ComunicacionDocumento | D | Comunicación + Documento | org + triggers | Rechaza cruce |
| Compareciente | T | ActorContext | org | No master global por RFC |
| PersonaFisica | D | Compareciente | org + trigger | Identidad privada por tenant |
| RelacionConyugal | D | Compareciente/documento | org + documento trigger | Subrecurso |
| PersonaMoral | D | Compareciente | org + trigger | Subrecurso |
| PersonaMoralInstrumento | D | PersonaMoral | org + triggers | Subrecurso |
| ComparecienteDomicilio | D | Compareciente | org + trigger | Subrecurso |
| ComparecienteContacto | D | Compareciente | org + trigger | Subrecurso |
| ComparecienteIdentificacion | D | Compareciente | org + triggers | Subrecurso |
| ComparecienteDocumento | D | Compareciente + Documento | org + triggers | Rechaza cruce |
| PersonaMoralRepresentante | D | PersonaMoral | org + triggers | Subrecurso |
| CaracterRepresentacion | G | catálogo | clave | Catálogo jurídico |
| CaracterCompareciente | G | catálogo | clave | Catálogo jurídico |
| TipoActoCaracterCompareciente | G | catálogos | unique(tipo,carácter) | Catálogo |
| ExpedienteCompareciente | D | Expediente + Compareciente | org + triggers ambos padres | Relación crítica |
| ExpedienteRepresentacion | D | Expediente + Instrumento | org + triggers | Relación crítica |
| ExpedienteRequisitoDoc | D | Expediente | org + trigger | Subrecurso |
| MovimientoFinanciero | T | ActorContext | org/status/date + parent triggers | Agregaciones tenant-first |
| CategoriaFinanciera | T | ActorContext | org | Configuración financiera del tenant |
| CuentaFinanciera | T | ActorContext | org | Cuenta del tenant |
| HonorarioGenerado | D | Cotización/Expediente | org + triggers | Ledger derivado |
| MetaHonorario | T | ActorContext | org | Meta organizacional/personal dentro del tenant |
| MovimientoDistribucion | D | Movimiento | org + triggers | Ledger derivado |
| ComprobanteFinanciero | D | Movimiento | org + trigger | Documento financiero |
| TransaccionEstadoCuenta | D | Cuenta | org + trigger | Importación bancaria tenant |
| ConciliacionFinanciera | D | Movimiento + Transacción | org + triggers | Rechaza cruce |
| Pago | D | Expediente/Cotización | org + triggers | Flujo financiero |
| ExpedienteActividad | D | Expediente | org + trigger | Timeline |
| AuditLog | T | ActorContext | org/created | Auditoría visible solo en tenant |
| CalculoISR | T | ActorContext | org + parent triggers | Cálculo tenant |
| CalculoISRVersion | D | CalculoISR | org + trigger | Snapshot inmutable |
| CalculoISRDocumento | D | Cálculo + Documento | org + triggers | Evidencia |
| CalculoISRPropuesta | D | Cálculo + Documento | org + triggers | Revisión humana |
| FiscalRuleSet | G | normativa | clave/versión | Legal global/versionado |
| FiscalRateTable | G | FiscalRuleSet | rule_set/clave | Legal global |
| FiscalRateBracket | G | tabla | table/orden | Legal global |
| DomainEventOutbox | T | ActorContext del productor | org | Worker reclama global y procesa por org |
| DomainEventProcessingLog | D | Outbox | org + trigger | Idempotencia por handler |
| Tarea | T | ActorContext | org + expediente trigger | Agenda |
| EventoAgenda | T | ActorContext | org/start + parent triggers | Agenda |
| TareaExterna | D | Expediente | org + trigger | Postfirma |
| ExpedienteEntrega | D | Expediente | org + trigger | Entrega |
| Comunicacion | D | Expediente | org + trigger | Historial |
| Nota | T | ActorContext | org | Nota privada del tenant |
| MemoriaDespacho | T | ActorContext | org | Memoria organizacional |
| ComparecienteAltaSession | T | ActorContext | org | Wizard/temporal |
| AIUsageLog | T | ActorContext | org/created; operation_id unique | Ledger canónico, no duplicado |
| AssistantConversation | T | ActorContext | org/owner/status/last | Propietario + tenant |
| AssistantMessage | D | Conversation | org + trigger | Historial |
| AssistantAttachment | D | Conversation/Documento | org + triggers | Temporal u oficial |
| ComplianceRuleSet | G | normativa | tipo/clave/versión | Legal global/versionado |
| ComplianceReview | T | ActorContext | org + Expediente trigger | Caso UIF |
| ComplianceDecision | D | Review | org + trigger | Revisión humana |
| ComplianceEvidence | D | Review + Documento | org + triggers | Evidencia |
| UmaValue | G | normativa | year/effective_from | Legal global |
| CompliancePartySnapshot | D | Review + Compareciente | org + triggers | Snapshot |
| ComplianceBeneficialOwner | D | Review | org + trigger | Beneficiario controlador |
| CompliancePepReview | D | Review | org + trigger | PEP |
| ComplianceScreeningResult | D | Review | org + trigger | Screening |
| CompliancePayment | D | Review | org + trigger | Umbrales/pagos |
| ComplianceObligation | D | Review | org + trigger | Obligaciones |
| ComplianceEvent | D | Review | org + trigger | Timeline |
| ComplianceAiProposal | D | Review | org + trigger | Requiere revisión humana |
| CargaTemporalDocumento | D | AltaSession | org + trigger | Temporal |
| StorageCompensationJob | D | Carga o AssistantAttachment | org + ownership checks | Limpieza idempotente |
| ComparecienteDatoFuente | D | Compareciente/Documento/Carga | org + triggers | Procedencia |
| ComparecienteAlias | D | Compareciente | org + trigger | Privado por tenant |
| ActividadEconomica | G | catálogo | clave | Catálogo público común |
| ComparecienteActividadEconomica | D | Compareciente | org + trigger | Relación privada |

## Índices compuestos calientes

- `Expediente(organization_id, estatus, updated_at DESC)`
- `Documento(organization_id, fecha_carga DESC)`
- `MovimientoFinanciero(organization_id, estatus, fecha_movimiento DESC)`
- `EventoAgenda(organization_id, fecha_inicio)`
- `AuditLog(organization_id, created_at DESC)`
- `AIUsageLog(organization_id, created_at DESC)`
- Assistant: organización + conversación/propietario + estado/fecha.

La migración crea además un índice simple en `organization_id` para cada tabla operativa existente, necesario para el filtro transversal y las validaciones de huérfanos.
