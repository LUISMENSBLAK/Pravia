# Verificación física de documentos heredados — 2026-10-18/19

Estado: **FAIL / bloquea release**. Esta evidencia complementa la [matriz principal](./PLATFORM_ARCHITECTURE_GAP_MATRIX.md); no convierte el backfill lógico en una certificación de los originales. Revalidación read-only directa de NOTARYPROY del 28-10-2026: las 26/26 asociaciones y tenants continúan coherentes, pero 0/26 objetos fueron localizados en ambos buckets o listados de metadata; véase [evidencia actual](../release/2026-10-28/NOTARYPROY_READONLY_AUDIT.md).

## Alcance y método

- Fuente relacional: copia PostgreSQL **local aislada** `pravia_control_plane_backfill_20261017`; se exigieron exactamente 83 `Documento`, 83 `StorageBlob`, 83 `StorageBlobLocation` y 83 `StorageBlobReference`.
- Fuente de bytes: bucket configurado `pravia_documentos`; únicamente GET autenticados de lectura. No se modificaron objetos, metadatos, DB productiva ni claves.
- Para cada objeto: asociación y organización, respuesta de Storage, lectura completa en streaming, tamaño físico y SHA-256 actual. El comparador sólo declara igualdad histórica cuando existe un SHA persistido confiable.
- Ejecución: `backend/scripts/legacy-physical-audit.ts`, `NODE_ENV=test`, `LEGACY_PHYSICAL_AUDIT=1`, DB local exacta. Resultado reproducido en tres pasadas; una lectura transitoria falló en la segunda y pasó al repetirla individualmente. Las cifras siguientes son de la tercera pasada completa.
- Esta inspección prueba **accesibilidad actual en el bucket configurado**. No prueba por sí sola que otra versión, otro backup o una ruta histórica no conserve alguno de los 26 objetos; tampoco autoriza escribir o «reparar» producción.
- La segunda lectura, también **sólo GET**, buscó los mismos 26 keys en el otro bucket existente, `documents`: **0/26 legibles**, 26 respuestas HTTP 400. No se infiere pérdida definitiva hasta revisar versionado, rutas históricas y backups.
- Una consulta posterior del endpoint de **listado de metadatos** de Storage (operación SELECT; la API la transporta por HTTP POST) inspeccionó los directorios padres exactos de las 26 claves en ambos buckets. En cada bucket se pudieron listar 26/26 padres, sólo 4/26 contenían otros objetos y **0/26 incluían el nombre exacto faltante**. No se imprimieron nombres ni rutas. Este resultado descarta un simple error del endpoint de descarga para esas claves, pero no descarta otra ubicación o una copia histórica.

## Resultado

| Medida | Resultado |
|---|---:|
| Documents expected | 83 |
| Physical objects checked | 83 |
| Objects found y legibles | 57 |
| Size match entre bytes, Documento y Blob | 57 |
| SHA histórico persistido disponible | 13 |
| SHA persistido igual al SHA actual | 13 |
| SHA histórico no disponible | 70 |
| Tenant mismatches | 0 |
| Asociaciones lógicas faltantes | 0 |
| Missing physical objects en bucket configurado | 26 |
| Unreadable | 26 |
| Unexpected size mismatch en objetos leídos | 0 |
| Unexpected hash mismatch donde había SHA histórico | 0 |

Los 70 documentos sin SHA histórico no pueden certificarse retroactivamente frente a un original anterior. El SHA calculado hoy sólo puede ser baseline de la versión leída. No se declaró equivalencia histórica ficticia.

## IDs con respuesta `OBJECT_NOT_FOUND`

No se incluyen nombres, rutas de Storage, URLs ni contenido documental.

- `14d2a675-386b-47b5-83d5-a7b33651de76`
- `1f02cc08-de9a-4764-8401-5bb87aa8b06b`
- `28007066-2d27-4d21-bad9-34e9b7a4b2f5`
- `3a75bb5b-5ddf-4d14-8501-2b497f6363e0`
- `449fa725-60f0-4ca9-bb91-b585e9a102a0`
- `4a9217eb-da42-4f00-ad3a-880f97d0e743`
- `5385efec-a18b-4557-a2c7-ffdf8067d134`
- `558f252d-a2e2-4606-8aee-d9be16223f6c`
- `59f72cfe-6d91-4be2-abe2-7e9ba4eb65a2`
- `5fcc3c06-f4d4-4388-9a30-ed78a0886fbb`
- `63a5b620-b062-46f2-8235-036840ffd387`
- `6844c3eb-7389-49a2-8780-d65a0e5f2b8d`
- `735c899e-a856-42ba-85b2-d58c2f438ee6`
- `7480e7e2-de37-408d-9280-31ac71ac8fd9`
- `74f09425-7399-4b56-bb84-288e30e7cd34`
- `7f7d31b1-4a09-4824-8264-d0764638de1f`
- `7f830c1b-9e11-477f-8e0d-a705da17810b`
- `8503f967-333a-4e02-acbc-7e0c4e243739`
- `9b386293-1198-4240-8eda-58bc17fe38e5`
- `9bb12b11-ca16-464c-b79c-81249df12895`
- `b6ba1c50-3968-46c7-b6ea-5e297e758fb8`
- `c798da3e-1db9-4fa5-98ab-95b300389182`
- `e07289e8-9173-4dca-a77b-332cc9ef512a`
- `e2412ab5-ed15-45d0-b52b-34e332b8330c`
- `ea88f912-f8bf-4d81-803f-4a1a7702da79`
- `f6e47e0f-0bd1-4bf7-a138-e27422609122`

## Evidencia individual de los 83 IDs

`SHA actual` es el digest de los bytes leídos ahora; `SHA histórico` sólo es PASS cuando existía un valor persistido independiente. Todas las asociaciones y organizaciones fueron coherentes en la copia local; las ubicaciones siguen `LEGACY_UNVERIFIED` hasta resolver los 26 faltantes.

| Document ID | Lectura | Tamaño | SHA actual | SHA histórico | Asociación / tenant |
|---|---|---|---|---|---|
| `068ab2c4-d8c3-4e06-80b7-c337c519eace` | PASS | PASS | `35392f0488a71a7160912ec1046e69d3fd381e80caef1e21e599998962f936a7` | NO DISPONIBLE | PASS |
| `085f3f04-83c7-4ad7-a0e8-0616f7b29fdf` | PASS | PASS | `c0dcaf95dc2b2f31373f6ff601bf199218c8a2cb1251dec36ab26782ec54a337` | NO DISPONIBLE | PASS |
| `0af45023-4132-443d-9f78-bcbe87201f1e` | PASS | PASS | `8ae040381152ff9f6ab1de8f8243b92a269b69a6a220ffdb26e62251b759dfdd` | NO DISPONIBLE | PASS |
| `0f7c9db6-48cc-4d9b-abcc-4fd783fd36a6` | PASS | PASS | `2b4b56d416781ff77677d64b4d2e26918dfc85a603b01724197bbf49fabd10c0` | PASS | PASS |
| `11d53a97-78c4-447a-baa9-e06e2e12f91f` | PASS | PASS | `ab12ba58b43ae4c7f5c201e39c6a846209fc65fd5c917957fd6cb63cb6581f01` | NO DISPONIBLE | PASS |
| `145d5c82-62b6-4f4d-8d37-a0bd94901648` | PASS | PASS | `dd9d60cad0ebaf7c379e5592440dc2baee4375f695abfc864242b726027f0eaa` | NO DISPONIBLE | PASS |
| `14d2a675-386b-47b5-83d5-a7b33651de76` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `15325eeb-ef42-4d5b-a8bb-3ce7938a2e16` | PASS | PASS | `7c8b6ca13e8c5a1ebf0165e29312b55a254cf559915ea9ca16b42b244cafd9d5` | PASS | PASS |
| `1868a08f-42ba-4748-9895-ad40738f572f` | PASS | PASS | `012b0001b5e4918a89267ba6d15e64221d5c04720ec94441c41a2e03f376c6a9` | NO DISPONIBLE | PASS |
| `1c3a61a1-f0d3-4375-bf24-76c1b790c0de` | PASS | PASS | `abfd30ffbc60fcb612191aae50661ae8b1e438ae6092a2c7f2e84a3db79810c6` | NO DISPONIBLE | PASS |
| `1c41f5d7-0894-4317-bd45-05ae374dab03` | PASS | PASS | `b1c1d2f4b1abc24756c6c9743ed0312ea9383d2989aa23081642324eb2813af8` | NO DISPONIBLE | PASS |
| `1d7e67c5-f1a5-4f55-8f0e-60fedc68f23c` | PASS | PASS | `2b16d90010a0e42801219a9c299e941995b5df6ef89b84907b36f404d48cd5f9` | NO DISPONIBLE | PASS |
| `1f02cc08-de9a-4764-8401-5bb87aa8b06b` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `25f33f75-f98c-46a0-8e8c-886698b001af` | PASS | PASS | `d724fa06e1a673705e2b4be75402e5d410605de507d2079726303e9c81c484b0` | PASS | PASS |
| `28007066-2d27-4d21-bad9-34e9b7a4b2f5` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `2a7dd7f4-87f9-4361-b747-21198f0a6bcf` | PASS | PASS | `070af43f3e543d3c71e15df164e987cbe11b618cbea05fa5c8c2608dffff4afe` | NO DISPONIBLE | PASS |
| `312579ae-8e6d-47eb-a400-0aa37b51ea25` | PASS | PASS | `a8d18bf5404d3310453eb85e399d442c03be14ec0cbe6832d482c84e15a648d4` | NO DISPONIBLE | PASS |
| `33ddb6d2-963c-4c40-b59d-5516c22ddad8` | PASS | PASS | `dd9d60cad0ebaf7c379e5592440dc2baee4375f695abfc864242b726027f0eaa` | NO DISPONIBLE | PASS |
| `3851a7c4-a1c6-416e-a29a-d7d6bda95f3a` | PASS | PASS | `8c041e85da5d38f970127bf25a87f4273dc6c3e3bf63fb31e7265f980f859405` | NO DISPONIBLE | PASS |
| `3a75bb5b-5ddf-4d14-8501-2b497f6363e0` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `3eaf0596-fdee-4601-b610-6be19cfa3bf5` | PASS | PASS | `f1be76656cf849edf5c500e166efb32d24025a6ad2b9fe3860e1584ad38f140f` | NO DISPONIBLE | PASS |
| `449fa725-60f0-4ca9-bb91-b585e9a102a0` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `45cd32c3-72d5-46e0-bacc-fd19b5ea2be9` | PASS | PASS | `ea3c98c2e2e8d6911a8eb0f300ec8c2bf8fa6331d6b90533faeac28c6cb3360f` | PASS | PASS |
| `47318588-a95c-4533-8406-62530e2ac382` | PASS | PASS | `b774366bd418f6b15b4c7059d192380885382ca9a70f0646c526d63c09013032` | NO DISPONIBLE | PASS |
| `4a9217eb-da42-4f00-ad3a-880f97d0e743` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `5385efec-a18b-4557-a2c7-ffdf8067d134` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `558f252d-a2e2-4606-8aee-d9be16223f6c` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `59f72cfe-6d91-4be2-abe2-7e9ba4eb65a2` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `5e5bfd31-47f7-44d2-9885-751c1703442d` | PASS | PASS | `ae62dfdbd425556d0760a39518c48b093dd308689a55f5e406b141a48d9a9f53` | NO DISPONIBLE | PASS |
| `5fcc3c06-f4d4-4388-9a30-ed78a0886fbb` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `61260ae9-c1ae-4527-bf77-564f0be72e45` | PASS | PASS | `570009e85a8581bd577cf3f9b1305c1d1c037774b63ed32b38b4e6a38e0dda4c` | PASS | PASS |
| `61b6cf22-12bf-451a-bb7d-3fd881c6eb8e` | PASS | PASS | `dd9d60cad0ebaf7c379e5592440dc2baee4375f695abfc864242b726027f0eaa` | NO DISPONIBLE | PASS |
| `62b0d112-c79f-4b0f-88ba-2ce6fade53d7` | PASS | PASS | `6a736813a76f563d130dfdbe14a0d2f8310d945b748a1c68a9878f73f92fc04d` | PASS | PASS |
| `6307399d-a266-4460-8b51-9fae054363f4` | PASS | PASS | `c6aea25e1b4e60737f963b5485b1d3620cd605157d5ec71d215c06409a88825b` | NO DISPONIBLE | PASS |
| `63a5b620-b062-46f2-8235-036840ffd387` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `65520f53-1868-4e27-b102-067f94bf1f6b` | PASS | PASS | `ad55708002e0b261ee2e9f7d1b09dd26912419e51e7a65d5db0566072f40745d` | NO DISPONIBLE | PASS |
| `657bb112-2d27-49e0-99c0-34c5f33b2671` | PASS | PASS | `c9847097c4e297e13e027aa157fb9abc594ca46b3182a1a8df4492697832f361` | NO DISPONIBLE | PASS |
| `66a20c2c-0439-4f55-973c-74e958d27663` | PASS | PASS | `75d2940cff73f95c621de8d2dd4053307359d9b7d18e93d9a66c3a3fc4915d7c` | NO DISPONIBLE | PASS |
| `6844c3eb-7389-49a2-8780-d65a0e5f2b8d` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `6d05a0b6-ae3e-4432-a3b8-70e9a7221aba` | PASS | PASS | `f2ecf66d36eee510db0f8c76aae40d5248f4554b0de36b4da3e6eda3de936591` | NO DISPONIBLE | PASS |
| `6d693c7f-a976-461f-98d2-00c6329f12db` | PASS | PASS | `6a05e9f792dc8c23714d181a45882144797e883c2362fb346292217f58239c33` | NO DISPONIBLE | PASS |
| `735c899e-a856-42ba-85b2-d58c2f438ee6` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `7480e7e2-de37-408d-9280-31ac71ac8fd9` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `74f09425-7399-4b56-bb84-288e30e7cd34` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `75e1545a-d768-42a8-80d8-22f4f30877a1` | PASS | PASS | `6c020b9edcd99d2a79a40c871b76a3dc18859fbff4f0f4680c002f84e9b5e32f` | PASS | PASS |
| `786a32ce-be47-4cb9-81c3-49526baccff6` | PASS | PASS | `ac655179210dc9e10ed69986c05822950bbec5951dc9030ab43b5960d97f7e4d` | NO DISPONIBLE | PASS |
| `7aa5380a-91ef-4ace-978b-9617f90b480f` | PASS | PASS | `2b4b56d416781ff77677d64b4d2e26918dfc85a603b01724197bbf49fabd10c0` | NO DISPONIBLE | PASS |
| `7f7d31b1-4a09-4824-8264-d0764638de1f` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `7f830c1b-9e11-477f-8e0d-a705da17810b` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `7fa08f15-0dd8-4f81-a5f9-939b9560ba1b` | PASS | PASS | `2e6e62890906180c2c7c1f5fe1ca1c2172de0a6d9460d6523359318e205fa88c` | NO DISPONIBLE | PASS |
| `8503f967-333a-4e02-acbc-7e0c4e243739` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `85c84545-18f0-4ec3-9483-327c44657eec` | PASS | PASS | `a4d1de6c46d6db781092a2d32cba3795055e546b3c3583e113985046ba80c8d2` | NO DISPONIBLE | PASS |
| `869557a7-b1f8-4d41-9407-6c52d0145a41` | PASS | PASS | `404a5ba331544870330f7f6eba34167c88fe597ad7ad9acb77f6826d21c65730` | NO DISPONIBLE | PASS |
| `8bdcd8c5-a16f-47da-b578-421483c8b83c` | PASS | PASS | `b6d2282a5a2294bfd2ae64aade665ff6b613b6c279636f817af5bf5d62e52f15` | PASS | PASS |
| `9504c371-e722-4e37-bb38-e641b1714a08` | PASS | PASS | `de079b16113a33e79e5e1cf83a3f7b2a3c9e93704ca8b352db5ab27ad03dd69f` | NO DISPONIBLE | PASS |
| `9b386293-1198-4240-8eda-58bc17fe38e5` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `9bb12b11-ca16-464c-b79c-81249df12895` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `9d0ea51d-9de5-42c2-8c8b-b2daa9ac650b` | PASS | PASS | `4f9c41fd47927492a31775ebad0db39e08e69d239606a92c2f9b94efe7b544f8` | PASS | PASS |
| `a8134eca-a284-45cb-83c9-1a1991b4a0b8` | PASS | PASS | `63fed25ac43e78a291192af582b645407789e8b3a66795774fbd227ce5d670c9` | PASS | PASS |
| `a815e277-d778-4c3f-a043-b139ea4a1f6e` | PASS | PASS | `a2b99d23e97cec3f866e07549955c1c03ef4af0af06b769f6f9e51d40ea7a128` | NO DISPONIBLE | PASS |
| `aa94aeff-7cc8-4e3d-b698-78611205570d` | PASS | PASS | `a98f05dfcdfec43f297bee23d6ec37c4f1c7a8f8f148a30d8d8c07b0f9474852` | NO DISPONIBLE | PASS |
| `aebccb30-82c7-4a73-8c16-767a4313062d` | PASS | PASS | `8fd261c60e2dc6a8f331b2cc7722bee452db4645bb79df067d744b2172a3f9c9` | NO DISPONIBLE | PASS |
| `b094912a-294a-49ea-8ca3-5c2d3b67e239` | PASS | PASS | `3a2137500828775beb6543296441970afc017e77b377ddb22bac226c9492cf09` | NO DISPONIBLE | PASS |
| `b6ba1c50-3968-46c7-b6ea-5e297e758fb8` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `b7815db5-13b5-4e5a-b65e-a5fff1d78c25` | PASS | PASS | `dd9d60cad0ebaf7c379e5592440dc2baee4375f695abfc864242b726027f0eaa` | NO DISPONIBLE | PASS |
| `bb6af507-e7dd-4768-bf1f-8d5ec4e03eba` | PASS | PASS | `a663084da812e5f7d830bd55faa56dda9db3df201ea5f8e6bcfbf68de492b6a7` | NO DISPONIBLE | PASS |
| `be350076-c5b4-4c37-9930-3a33f50f8076` | PASS | PASS | `dd9d60cad0ebaf7c379e5592440dc2baee4375f695abfc864242b726027f0eaa` | NO DISPONIBLE | PASS |
| `c11954d5-4fe3-4c6f-b816-ef0fa10feb06` | PASS | PASS | `dd943cbdbd7d040a2c1333d403d12abadfd0876b06a245b321eb353c685104f1` | NO DISPONIBLE | PASS |
| `c3fdc163-017b-41af-b740-1c4004f2706f` | PASS | PASS | `49150c4166ce1ed770ff617a648bb892ba48fa7d1fe8d19839ad0d6ab793e5d1` | PASS | PASS |
| `c798da3e-1db9-4fa5-98ab-95b300389182` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `cef6e844-55c0-4edb-a038-200bf7faa35a` | PASS | PASS | `6a736813a76f563d130dfdbe14a0d2f8310d945b748a1c68a9878f73f92fc04d` | PASS | PASS |
| `d4980d6a-9c5b-4462-b1b7-62aa6038290d` | PASS | PASS | `9500b9bd16495638d4e607ee91aeab72c76c86ee16123f1a8c88a39289846408` | PASS | PASS |
| `d58f44fb-9900-4d26-969d-5f56938af1eb` | PASS | PASS | `e80add32a7ac6792781f173b9dbcb10bcb9dfe01ad6a6b6a0e161ded10005393` | NO DISPONIBLE | PASS |
| `daf5d81c-f139-409f-8bea-846196bbf8e1` | PASS | PASS | `abfd30ffbc60fcb612191aae50661ae8b1e438ae6092a2c7f2e84a3db79810c6` | NO DISPONIBLE | PASS |
| `de41b61e-3532-4069-b949-1354f1f168ec` | PASS | PASS | `9cbd2e3e8765ad8deb15bfcd17a91e7ac24f60733f3f9cc03ead140f66c578d7` | NO DISPONIBLE | PASS |
| `e07289e8-9173-4dca-a77b-332cc9ef512a` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `e0afd98a-9af4-4b6c-997b-7be9646a604d` | PASS | PASS | `dd9d60cad0ebaf7c379e5592440dc2baee4375f695abfc864242b726027f0eaa` | NO DISPONIBLE | PASS |
| `e2412ab5-ed15-45d0-b52b-34e332b8330c` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `ea88f912-f8bf-4d81-803f-4a1a7702da79` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |
| `eb4d32f6-792c-460a-97fb-762fca36a015` | PASS | PASS | `4d8a7f524c093980e22e825eafaeaa95cffb61aa7d4387f0dd3fe917fc274ea3` | NO DISPONIBLE | PASS |
| `f416e841-2b56-4084-ab6d-ed29856eae56` | PASS | PASS | `bb3d7b6a9731f032eec276214d72380197916fd246e91bc465470485898db8f9` | NO DISPONIBLE | PASS |
| `f451352a-baf4-469b-a307-4f3e1b1926f5` | PASS | PASS | `07a0ea97c163c7846cbd6040febdaa392efd44d869795392f9e40b5d398ff7d1` | NO DISPONIBLE | PASS |
| `f6e47e0f-0bd1-4bf7-a138-e27422609122` | OBJECT_NOT_FOUND | — | — | NO DISPONIBLE | PASS |

## Investigación pendiente y gate

1. Corroborar para estos IDs la fuente de sus `storage_key`, bucket/proveedor original, historial de versiones/eliminación y backup disponible, mediante procedimientos autorizados de sólo lectura.
2. Si existe original recuperable, restaurarlo primero en un entorno aislado y verificar tamaño, SHA, tenant y relación antes de cualquier reparación controlada.
3. Si no existe, conservar el fallo documentado; no sustituir bytes, preview ni metadata para cuadrar el contador.
4. No certificar 83/83, no habilitar uso cliente ni desplegar mientras falten los originales requeridos.

**Production writes: NONE. Production migrations: NONE. Commit/push/deploy: NO.**
