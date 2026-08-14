# Equivalencia baseline ↔ producción

Resultado S0: **GREEN**.

| Métrica | Producción | Test DB 1 | Test DB 2 |
| --- | ---: | ---: | ---: |
| Tablas | 67 | 67 | 67 |
| Columnas | 902 | 902 | 902 |
| Constraints | 236 | 236 | 236 |
| Índices | 258 | 258 | 258 |
| Enum labels | 249 | 249 | 249 |
| Funciones | 1 | 1 | 1 |
| Triggers | 2 | 2 | 2 |

Fingerprint de los tres: `4a4d89cbb98c0ba29017fcac70c3109ed95a8e0824b74637bcf6f3f2dfc5b172`.

Diferencias: 0 `SEMANTIC`, 0 `CRITICAL`. Extensiones, ownership, grants y direcciones de servidor se clasificaron `EXPECTED_ENVIRONMENTAL`; orden SQL y timestamps no participan en el hash. Dos reconstrucciones independientes produjeron hashes idénticos, por lo que el baseline es determinista.
