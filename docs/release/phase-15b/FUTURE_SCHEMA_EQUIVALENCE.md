# Equivalencia del esquema futuro

Resultado: **RED — drift inesperado**.

Baseline + siete deltas se reconstruye correctamente y Prisma registra las ocho migraciones como aplicadas. El estado físico resultante contiene 80 tablas, 1084 columnas, 298 constraints, 312 índices, 279 labels enum, dos secuencias, una función y dos triggers; fingerprint `e4dd1e6e5823c46b8cb71c02c929451391d0fc8e4f870dfadfd6776d5a4e284f`.

Sin embargo, `prisma migrate diff --from-url staging --to-schema-datamodel backend/prisma/schema.prisma` genera 46,042 bytes y 322 operaciones: 61 `DropForeignKey`, 61 `AddForeignKey`, 121 `DropIndex`, 32 `AlterTable`, 12 `RenameForeignKey`, 29 `RenameIndex`, cinco `CreateIndex` y un `DropEnum`. Los `AlterTable` incluyen defaults UUID, nullability, varchar/text y timestamps; no son diferencias textuales benignas. Ejecutar ese diff eliminaría 121 índices y cambiaría semántica, por lo que fue rechazado.

La integración DB también detectó 16 FK sin índice utilizable. En consecuencia, la afirmación de que el `schema.prisma` actual representa S1 no queda demostrada. El SQL de evidencia está en `artifacts/canonical-prisma/future-to-schema-prisma.diff.sql` y **no fue ejecutado**.
