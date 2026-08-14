# Equivalencia final S2 ↔ schema.prisma

Resultado: **equivalencia semántica GREEN**.

El `schema.prisma` fue introspectado desde S2 y luego validado/generado. El diff final contiene únicamente dos `RenameForeignKey` en `expediente_representaciones`; ambas conservan tabla, columnas, referencia y acciones referenciales y se clasifican `NAMING_ONLY`. No se ejecutan por estética.

- Diferencias críticas: 0.
- Diferencias semánticas no documentadas: 0.
- Objetos UNKNOWN: 0.
- FK operativas sin índice: 0.
- Objetos DB-native preservados: índices parciales/expresión, checks no representables por Prisma, función/triggers históricos y enum legacy `ComparecePor`.

Las 60 parejas Drop/Add FK del diff S1 tenían `ON DELETE` idéntico y solo discrepaban en `ON UPDATE`: S1 usaba `NO ACTION` y el schema anterior proponía `CASCADE`. Dado que las PK UUID son inmutables, se preservó la opción más restrictiva y se declaró `onUpdate: NoAction` mediante introspección. La FK histórica `persona_moral_representantes.documento_soporte_id` se preservó; la FK realmente ausente `documentos.compareciente_id` se añadió y validó.

El SQL final del diff está en `artifacts/s2-to-schema-prisma.diff.sql`.
