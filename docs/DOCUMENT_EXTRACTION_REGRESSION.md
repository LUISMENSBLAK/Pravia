# Pruebas de regresión de extracción documental

Este conjunto mide qué propone PRAVIA, qué deja sin propuesta y por qué. No es entrenamiento de pesos ni aprendizaje automático de los documentos de la notaría.

## Qué medir al incorporar un caso

- **Exactitud:** el valor y su fuente coinciden con la lectura independiente. En números de identificación, valores, cuentas y fechas no se da crédito por aproximación.
- **Compleción:** registrar los campos legibles que no se recuperaron; separar los campos que no constan en ninguna fuente.
- **Abstención correcta:** una fuente de otro titular, una unidad no identificada o un valor ilegible no se convierten en hechos ni en datos de la ficha. Las demás propuestas válidas deben conservarse.
- **Persistencia:** extraer no cambia el maestro. La revisión humana permite conservar lo capturado y deja rastro de la fuente y el campo elegido.

## Cómo reproducir

Desde `backend`, ejecutar:

```sh
npx vitest run src/domain/partyDocumentPolicy.test.ts src/domain/machineReadableIdentity.test.ts src/domain/propertyDocumentPolicy.test.ts src/services/identityDocumentOcr.service.test.ts src/services/documentVisionRouting.test.ts src/services/predios.extractionFailure.test.ts
```

Cuando aparezca un caso nuevo, conservar su patrón con datos ficticios: formato, orden de campos, deterioro visual, tipo de documento, conflicto esperado y evidencia mínima. Las pruebas deben comprobar tanto el caso que se recupera como el parecido que se debe abstener. Los originales se pueden cotejar en un entorno autorizado y efímero; no se suben al repositorio, a logs, ni a un conjunto de entrenamiento. Una prueba con respuesta simulada certifica el flujo y las reglas locales, no la calidad del proveedor externo.

Separar los resultados por tipo de documento y dificultad (texto nativo, escaneo, foto, reverso, lote mixto o escritura con varias unidades). En cada tanda, comparar antes y después sobre el mismo conjunto: campos correctos, campos incorrectos y campos legibles no recuperados. No contar como acierto un campo que sólo se propuso sin cotejo ni publicar una tasa general a partir de unos pocos originales.
