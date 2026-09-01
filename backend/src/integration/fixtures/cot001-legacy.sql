-- Synthetic G0-B legacy fixture. It extends pro001-legacy.sql and is safe only in the isolated test DB.
DO $$ BEGIN
  IF current_database() <> 'pravia_g0a' THEN RAISE EXCEPTION 'G0B_TEST_DATABASE_REQUIRED'; END IF;
END $$;
SET search_path TO pravia_os, public;

INSERT INTO prospectos(id,organization_id,nombre,user_id,estado,created_at,updated_at,tipo_acto)
SELECT ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-00000000000'||(CASE WHEN n=10 THEN 2 ELSE 1 END))::uuid,
       'PROSPECTO LEGACY COT '||n,
       ('20000000-0000-4000-8000-00000000000'||(CASE WHEN n=10 THEN 2 ELSE 1 END))::uuid,
       'COTIZACION_ENVIADA'::"ProspectoEstado", '2025-02-01'::timestamp + (n||' days')::interval,
       '2025-03-01'::timestamp + (n||' days')::interval, 'Acto sintético'
FROM generate_series(1,10) n;

INSERT INTO cotizaciones(id,organization_id,prospecto_id,user_id,notaria_id,estado,numero_cotizacion,
  fecha_solicitud_notaria,fecha_presupuesto_recibido,fecha_enviada_cliente,fecha_aceptacion_cliente,
  fecha_conversion_expediente,created_at,updated_at,total_cliente,total_notaria,honorarios_pravia)
SELECT ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-00000000000'||(CASE WHEN n=10 THEN 2 ELSE 1 END))::uuid,
       ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('20000000-0000-4000-8000-00000000000'||(CASE WHEN n=10 THEN 2 ELSE 1 END))::uuid,
       ('40000000-0000-4000-8000-00000000000'||(CASE WHEN n=10 THEN 2 ELSE 1 END))::uuid,
       state::"CotizacionEstado", 'COT-LEGACY-'||lpad(n::text,3,'0'),
       CASE WHEN n >= 2 THEN '2025-02-10'::timestamp + (n||' days')::interval END,
       CASE WHEN n >= 3 THEN '2025-02-12'::timestamp + (n||' days')::interval END,
       CASE WHEN n >= 5 THEN '2025-02-14'::timestamp + (n||' days')::interval END,
       CASE WHEN n IN (7,10) THEN '2025-02-16'::timestamp + (n||' days')::interval END,
       CASE WHEN n = 10 THEN '2025-02-18'::timestamp + (n||' days')::interval END,
       '2025-02-01'::timestamp + (n||' days')::interval,
       '2025-03-01'::timestamp + (n||' days')::interval,
       100000+n,90000+n,10000
FROM unnest(ARRAY['BORRADOR','ENVIADA_NOTARIA','PRESUPUESTO_RECIBIDO','EN_REVISION_ABOGADO','ENVIADA_CLIENTE',
  'EN_NEGOCIACION','ACEPTADA','RECHAZADA','VENCIDA','CONVERTIDA_EXPEDIENTE']) WITH ORDINALITY AS t(state,n);

INSERT INTO cotizacion_versiones(id,organization_id,cotizacion_id,version,total_cliente,total_notaria,honorarios_pravia,
  creada_por_id,aprobada,pdf_url,desglose_notaria,desglose_pravia,created_at)
SELECT gen_random_uuid(),q.organization_id,q.id,1,q.total_cliente,q.total_notaria,q.honorarios_pravia,q.user_id,
       q.estado IN ('ENVIADA_CLIENTE','EN_NEGOCIACION','ACEPTADA','RECHAZADA','VENCIDA','CONVERTIDA_EXPEDIENTE'),
       CASE WHEN q.estado IN ('ENVIADA_CLIENTE','ACEPTADA','CONVERTIDA_EXPEDIENTE') THEN 'https://example.test/'||q.id||'.pdf' END,
       '{"rubros":[{"categoria":"HONORARIOS","concepto":"Honorarios","monto":100000}]}'::jsonb,
       '{"participacion_pravia":10000}'::jsonb,q.created_at
FROM cotizaciones q WHERE q.id::text LIKE '90000000-0000-4000-8000-%';

INSERT INTO pagos(id,organization_id,cotizacion_id,categoria_ingreso,concepto,monto,estatus,fecha_pago,fecha_registro)
SELECT gen_random_uuid(),organization_id,id,'ANTICIPO_NOTARIA','Anticipo histórico',25000,'VALIDADO',
       '2025-02-20','2025-02-20'
FROM cotizaciones WHERE id IN (
  '90000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000007'::uuid,
  '90000000-0000-4000-8000-000000000010'::uuid
);

INSERT INTO documentos(id,organization_id,nombre_original,nombre_interno,tipo,storage_key,mime_type,size_bytes,
  subido_por_id,prospecto_id,cotizacion_id,fecha_carga)
SELECT gen_random_uuid(),q.organization_id,'Cotización histórica '||q.numero_cotizacion||'.pdf','legacy-'||q.id,
  'PRESUPUESTO_NOTARIA','organizations/'||q.organization_id||'/documentos/legacy-'||q.id,'application/pdf',1234,
  q.user_id,q.prospecto_id,q.id,q.created_at
FROM cotizaciones q WHERE q.id::text LIKE '90000000-0000-4000-8000-%';

INSERT INTO expedientes(id,organization_id,numero_pravia,abogado_id,creador_id,cotizacion_id,fecha_apertura)
SELECT 'a0000000-0000-4000-8000-000000000001',organization_id,'EXP-9001-2025',user_id,user_id,id,'2025-03-01'
FROM cotizaciones WHERE id='90000000-0000-4000-8000-000000000010';

CREATE TABLE public.g0b_counts_before AS
SELECT 'cotizaciones' entity,count(*) count FROM cotizaciones UNION ALL
SELECT 'prospectos',count(*) FROM prospectos UNION ALL
SELECT 'cotizacion_versiones',count(*) FROM cotizacion_versiones UNION ALL
SELECT 'pagos',count(*) FROM pagos UNION ALL
SELECT 'documentos',count(*) FROM documentos UNION ALL
SELECT 'expedientes',count(*) FROM expedientes UNION ALL
SELECT 'organizations',count(*) FROM organizations;

CREATE TABLE public.g0b_quotes_before AS
SELECT id,to_jsonb(q) row FROM cotizaciones q WHERE id::text LIKE '90000000-0000-4000-8000-%';
