# Objetos PostgreSQL nativos

15A contó cuatro eventos de trigger; la introspección física 15B confirmó **dos triggers** y **una función**.

## Función

`pravia_os.fn_check_compareciente_perfil()` es PL/pgSQL y devuelve `trigger`. Verifica que un compareciente no mantenga simultáneamente perfiles incompatibles y que `tipo_persona` concuerde con la tabla de perfil. Sigue siendo necesaria: protege escrituras directas, jobs y futuras rutas que omitan validación backend. Complementa, no sustituye, la validación de API.

## Triggers

| Nombre | Tabla | Evento | Función | Propósito | Baseline |
| --- | --- | --- | --- | --- | --- |
| `trg_check_persona_fisica_perfil` | `personas_fisicas` | AFTER INSERT OR UPDATE, constraint, deferrable initially deferred | `fn_check_compareciente_perfil()` | Evitar perfil físico incompatible | Conservar |
| `trg_check_persona_moral_perfil` | `personas_morales` | AFTER INSERT OR UPDATE, constraint, deferrable initially deferred | `fn_check_compareciente_perfil()` | Evitar perfil moral incompatible | Conservar |

Las definiciones exactas están en `production-structure.json` y en el baseline candidato. No se eliminó ni alteró ningún objeto productivo.
