# Compliance staging E2E

Entorno: PostgreSQL/local Storage aislado, S2. Resultado: **PASS**.

Se crearon un usuario Dirección sintético, expediente, compareciente, RuleSet UIF versionado, RuleSet ISR versionado y revisión. El compareciente incluyó nombre/profesión deliberadamente sugestivos de PEP, pero `pep_estado=PENDIENTE`; el prefill no lo convirtió en `SI`. Se subió y vinculó evidencia, se evaluó UIF y una persona confirmó la decisión.

Después se modificó el master del expediente. El `master_snapshot` histórico quedó byte-estable y `master_data_changed=true`. La reevaluación creó una nueva revisión con `supersedes_review_id` correcto. La revisión ISR terminó como diagnóstico `NO_CALCULADO`, sin campo UIF `requiere_aviso`.

Esto verifica lógica y persistencia local; no afirma screening PEP externo, cálculo/dictamen ISR ni presentación real ante UIF.
