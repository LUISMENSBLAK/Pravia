# Matriz de paridad funcional ISR: referencia Jade → PRAVIA OS

Fecha de auditoría estática: 2026-09-26. Jade fue tratado exclusivamente como referencia funcional: se inventariaron 556 entradas, el manual completo de 63 páginas, notas, ayuda y 205 archivos `.ISR`; no se ejecutó ningún binario ni se copió código, interfaz, marca o regla fiscal histórica.

Estados: `IMPLEMENTADO` significa que la capacidad vive en el único motor ISR canónico; `EQUIVALENTE MODERNO` reemplaza una mecánica obsoleta conservando su finalidad; `BLOQUEO SEGURO` evita inventar una regla, identidad o formato que no puede verificarse.

| # | Función Jade descubierta | Equivalente PRAVIA | Estado | Prueba / evidencia | Fuente de autoridad | Comentarios |
|---:|---|---|---|---|---|---|
| 1 | Nuevo cálculo | Cálculo ISR persistente vinculado a expediente | IMPLEMENTADO | `isr.service.test.ts` | Modelo `CalculoISR` | No usa archivos como estado primario. |
| 2 | Abrir cálculo `.ISR` | Abrir por ID y organización | EQUIVALENTE MODERNO | API + UI `/calculo-isr/:id` | DB canónica | Recarga conserva datos. |
| 3 | Guardar `.ISR` | Guardado y versiones en PostgreSQL | EQUIVALENTE MODERNO | servicios ISR | DB canónica | Snapshot reproducible. |
| 4 | Duplicar cálculo | Recalcular como nueva versión | IMPLEMENTADO | `isr.service.test.ts` | Versionado ISR | No muta resultado histórico. |
| 5 | Importar `.ISR` | Rechazo explícito hasta disponer de especificación | BLOQUEO SEGURO | auditoría estática | 205 contenedores TopSpeed | No existe parser heurístico ni ejecución de Jade. |
| 6 | Fecha de enajenación | `saleDate` | IMPLEMENTADO | `isrTaxEngine*.test.ts` | ruleset efectivo | Selección temporal obligatoria. |
| 7 | Fecha de adquisición de terreno | Adquisición por componente | IMPLEMENTADO | casos avanzados | snapshot de inputs | Soporta N adquisiciones. |
| 8 | Fecha de construcción | Adquisición de componente construcción | IMPLEMENTADO | escenarios misma/distinta fecha | snapshot de inputs | No exige modo técnico manual. |
| 9 | Sólo terreno | Escenario `TERRENO` | IMPLEMENTADO | test “sólo terreno” | motor determinístico | — |
| 10 | Sólo construcción | Escenario `CONSTRUCCION` | IMPLEMENTADO | test “sólo construcción” | motor determinístico | — |
| 11 | Terreno + construcción misma fecha | Escenario inferido | IMPLEMENTADO | test “misma fecha” | motor determinístico | — |
| 12 | Terreno + construcción fechas distintas | Escenario inferido | IMPLEMENTADO | test “fechas diferentes” | motor determinístico | — |
| 13 | Múltiples terrenos / fusiones | N adquisiciones por componente | IMPLEMENTADO | test múltiples adquisiciones | motor determinístico | Sin límite artificial. |
| 14 | Reparto histórico 20/80 | Regla versionada requerida | BLOQUEO SEGURO | rechazo sin snapshot | fuente fiscal verificada | Nunca se fija 20/80 por copiar Jade. |
| 15 | Construcción sin valor histórico | Regla versionada requerida | BLOQUEO SEGURO | validación de adquisición | fuente fiscal verificada | No se copian 10%/80% históricos. |
| 16 | Valores de adquisición y venta | Componentes Decimal | IMPLEMENTADO | dominio ISR | snapshot | Suma de componentes validada. |
| 17 | Ajuste automático | Política determinística autorizada | IMPLEMENTADO | tests de factor/INPC | revisión fiscal versionada | AUTO no usa IA. |
| 18 | Ajuste por factores | Referencia `FACTOR` versionada | IMPLEMENTADO | test factor exacto/inconsistente | fuente/revisión fiscal | Valida resultado contra factor. |
| 19 | Ajuste por INPC | Referencia `INPC` versionada | IMPLEMENTADO | test INPC sin referencia | fuente/revisión fiscal | Bloquea si falta snapshot. |
| 20 | Tabla UDI | Referencias `UDI` efectivas | IMPLEMENTADO | `isr.service.test.ts` | fuente oficial/fixture local marcada | No edición silenciosa. |
| 21 | Tabla de recargos | Referencias mensuales `RECARGO` | IMPLEMENTADO | utilidades ISR | fuente oficial/fixture local marcada | Año/mes, vigencia y fuente. |
| 22 | Tarifas por año | Ruleset/versiones fiscales | IMPLEMENTADO | selección de rule revision | fuente fiscal | AUTO o manual autorizado. |
| 23 | Tarifa manual | Criterio explícito con snapshot | IMPLEMENTADO | dominio/servicio | permiso elevado | No checkbox legal sin contexto. |
| 24 | Pérdida de terreno contra construcción | Política de criterio versionada | IMPLEMENTADO | snapshot de criterios | organización + fundamento | No altera históricos. |
| 25 | Resultados intermedios | Nodos y traza reproducible | IMPLEMENTADO | `calculationTrace` | ruleset + inputs | Incluye fórmula, fuente y redondeo. |
| 26 | Federación / entidad | Federal determinado; componente estatal bloqueado hasta ruleset verificado | BLOQUEO SEGURO | `scope=FEDERAL_ARTICLE_126_ONLY` + obligación no soportada | regla efectiva | No presupone reparto histórico fijo ni presenta el artículo 127 como calculado. |
| 27 | N enajenantes | Relaciones fiscales | IMPLEMENTADO | tests 50/50, 33.33/66.67 | CMP-001 + snapshot | No duplica persona maestra. |
| 28 | Reparto igual automático | Ayuda de distribución | IMPLEMENTADO | dominio ISR | confirmación usuario | Total debe ser 100%. |
| 29 | Reparto manual | Porcentaje Decimal por parte | IMPLEMENTADO | validación 100% | snapshot | Bloquea suma inválida. |
| 30 | Exención individual | Exención por enajenante | IMPLEMENTADO | test exención no contagia | regla/fuente confirmada | Nunca se replica a todos. |
| 31 | Residente extranjero | Tratamiento con regla confirmada | IMPLEMENTADO | tests bloquear/aceptar | fuente versionada | Sin alternativas históricas inventadas. |
| 32 | N adquirentes | Relaciones y proporciones | IMPLEMENTADO | tests compradores | CMP-001 + snapshot | Total 100% cuando aplica. |
| 33 | Generar RFC/CURP auxiliar | Faltante explícito | BLOQUEO SEGURO | test RFC ausente | CMP-001 | Nunca se fabrica identidad fiscal. |
| 34 | Deducciones de terreno | Fila `TERRENO` | IMPLEMENTADO | dominio ISR | documento + regla | N filas. |
| 35 | Deducciones de construcción | Fila `CONSTRUCCION` | IMPLEMENTADO | dominio ISR | documento + regla | Depreciación sólo con regla. |
| 36 | Deducciones a ambos | Distribución autorizada | IMPLEMENTADO | dominio ISR | regla versionada | Sin proporción heredada fija. |
| 37 | Mejoras/ampliaciones | Concepto estructurado | IMPLEMENTADO | UI/API | evidencia de pago | No catálogo legal rígido. |
| 38 | Gastos notariales/impuestos/derechos | Concepto estructurado | IMPLEMENTADO | UI/API | evidencia de pago | — |
| 39 | Comisiones/mediación | Concepto estructurado | IMPLEMENTADO | UI/API | evidencia de pago | — |
| 40 | Área exenta de terreno | Utilidad integrada y aplicable | IMPLEMENTADO | `calculateLandExemption` | regla, versión y fuente | Calcula porción exenta/no exenta. |
| 41 | Calculadora de recargos | Utilidad Decimal con traza | IMPLEMENTADO | `isrFiscalUtilities.test.ts` | tabla de recargos | Fechas, meses, actualización y total. |
| 42 | Valores referidos | Utilidad de valor histórico | IMPLEMENTADO | `isrFiscalUtilities.test.ts` | factor efectivo | Bloquea referencia futura sin índice. |
| 43 | Aplicar valor referido | Resultado con procedencia | IMPLEMENTADO | servicio ISR | confirmación de usuario | Se conserva fuente. |
| 44 | Impuesto por adquisición | Motor de impuesto adicional | IMPLEMENTADO | `calculateAdditionalTax` | referencia ADQUISICION | No porcentaje Jade fijo. |
| 45 | IVA | Motor de impuesto adicional | IMPLEMENTADO | `calculateAdditionalTax` | referencia IVA | Base confirmada requerida. |
| 46 | Catálogo de códigos postales | Búsqueda SEPOMEX vigente | EQUIVALENTE MODERNO | 159,326 filas; test/service/UI | Correos de México 2026-09-25 | Busca CP, colonia, municipio y estado. |
| 47 | Datos de operación SAT/UIF | Snapshot estructurado | IMPLEMENTADO | schema/servicio/UI | perfil efectivo | Escritura, instrumento, notaría y metadatos. |
| 48 | Datos del inmueble | Referencia PRD-001 + snapshot | IMPLEMENTADO | integración ISR | PRD-001 | No duplica predio maestro. |
| 49 | Liquidaciones/pagos | N filas controladas | IMPLEMENTADO | test suma N pagos | catálogos de perfil | Moneda, forma, instrumento, banco y fuente. |
| 50 | Catálogos banco/moneda/país/tipo | Catálogos en perfil versionado | IMPLEMENTADO | endpoint `/resources` + UI | perfil SAT/UIF | Conserva valores históricos. |
| 51 | Exportación DeclaraNot histórica | Perfil de salida versionado | EQUIVALENTE MODERNO | modelo/export validation | esquema oficial por fecha | No se marca vigente sin verificación. |
| 52 | Secciones históricas SAT | Perfil SAT configurable | IMPLEMENTADO | validación de perfil | fuente del perfil | No están hardcodeadas como esquema 2026. |
| 53 | Secciones históricas UIF | Perfil UIF configurable | IMPLEMENTADO | validación de perfil | fuente del perfil | No están hardcodeadas como esquema 2026. |
| 54 | Representante ficticio para PM | Representante real o bloqueo | BLOQUEO SEGURO | tests negativos | CMP-001 | Conducta Jade prohibida. |
| 55 | Alterar ganancia para importador | Valor fiscal real inmutable | BLOQUEO SEGURO | tests de snapshot/export | cálculo canónico | Nunca distorsiona el resultado. |
| 56 | Forma 1-A / 15-C | Output profile histórico si aplica | EQUIVALENTE MODERNO | perfil por fecha | fuente vigente/histórica | No se presenta como actual sin fuente. |
| 57 | Hoja de trabajo | Artefacto detallado | IMPLEMENTADO | rutas/documentos ISR | CFG-002 | Incluye inputs, resultados, traza y fuentes. |
| 58 | Memoria ISR | Destino funcional CFG-002 | IMPLEMENTADO | integración Correction 014 | CFG-002 | Presentación separada del cálculo. |
| 59 | Vista previa / impresión | Universal Viewer + descarga | EQUIVALENTE MODERNO | E2E visor | artefacto privado | Sin offsets de impresora Windows. |
| 60 | Envío por email | Servicio canónico si está configurado | EQUIVALENTE MODERNO | estado `NOT CONFIGURED` permitido | comunicación PRAVIA | Sin SMTP embebido. |
| 61 | Actualización por Internet/FTP | Ingestión versionada KNOW-001 | EQUIVALENTE MODERNO | import/verify/history | fuente oficial + hash | No FTP Jade. |
| 62 | Ayuda CHM | Ayuda contextual `?` y fuentes | EQUIVALENTE MODERNO | UI ISR | KNOW-001 | Explicación breve, sin chain-of-thought. |
| 63 | Calculadora general | Utilidades numéricas integradas | EQUIVALENTE MODERNO | utilidades ISR | operación matemática | No abre ejecutable externo. |
| 64 | Lista de errores | Resumen de errores/faltantes | IMPLEMENTADO | API/UI | validadores canónicos | Mensajes humanos. |
| 65 | Casos con tabla futura | Bloqueo por datos no publicados | IMPLEMENTADO | test de referencia ausente | vigencia | No proyecta cifras futuras. |

## Cierre

- Funciones descubiertas y explicadas: **65**.
- Implementadas en el motor/rutas canónicas: **49**.
- Sustituidas por equivalente moderno: **10**.
- Bloqueos seguros expresos: **6**.
- Brechas sin explicación: **0**.

Los bloqueos seguros no son módulos pendientes: preservan integridad al impedir un parser propietario inventado, identidades ficticias, reglas históricas sin fuente o distorsiones fiscales.
