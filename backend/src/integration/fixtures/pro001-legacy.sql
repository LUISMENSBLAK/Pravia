-- Synthetic legacy fixture, exclusively in the explicitly named isolated test database.
DO $$ BEGIN
  IF current_database() <> 'pravia_g0a' THEN RAISE EXCEPTION 'G0A_TEST_DATABASE_REQUIRED'; END IF;
END $$;
SET search_path TO pravia_os, public;
INSERT INTO organizations(id,name,updated_at) VALUES
 ('10000000-0000-4000-8000-000000000001','G0-A Organización A',now()),
 ('10000000-0000-4000-8000-000000000002','G0-A Organización B',now());
INSERT INTO users(id,email,password_hash,nombre,apellido,rol,updated_at,requires_password_change) VALUES
 ('20000000-0000-4000-8000-000000000001','g0a-a@example.test','test-unusable-hash','Prueba','A','ADMINISTRACION',now(),false),
 ('20000000-0000-4000-8000-000000000002','g0a-b@example.test','test-unusable-hash','Prueba','B','ADMINISTRACION',now(),false);
INSERT INTO organization_memberships(id,organization_id,user_id,rol,updated_at)
 SELECT ('30000000-0000-4000-8000-00000000000'||n)::uuid,
 ('10000000-0000-4000-8000-00000000000'||n)::uuid,
 ('20000000-0000-4000-8000-00000000000'||n)::uuid,'ADMINISTRACION',now() FROM generate_series(1,2) n;
INSERT INTO notarias(id,organization_id,nombre,correo_general,updated_at)
 SELECT ('40000000-0000-4000-8000-00000000000'||n)::uuid,
 ('10000000-0000-4000-8000-00000000000'||n)::uuid,
 'Notaría de prueba '||n,'notaria'||n||'@example.test',now() FROM generate_series(1,2) n;
INSERT INTO prospectos(id,organization_id,nombre,user_id,estado,etapa_operativa_codigo,created_at,updated_at,tipo_acto)
 SELECT ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-4000-8000-00000000000'||(CASE WHEN n=2 THEN 2 ELSE 1 END))::uuid,
 'HISTÓRICO SINTÉTICO '||n,
 ('20000000-0000-4000-8000-00000000000'||(CASE WHEN n=2 THEN 2 ELSE 1 END))::uuid,
 status::"ProspectoEstado",
 (ARRAY['PROSPECTO_RECIBIDO','ANTECEDENTES_SOLICITADOS','ANTECEDENTES_RECIBIDOS'])[(n-1)%3+1],
 '2025-01-01','2026-01-01','General histórico'
 FROM unnest(ARRAY['NUEVO','INFO_PENDIENTE','DOCS_RECIBIDOS','EN_REVISION','COTIZACION_SOLICITADA','COTIZACION_ENVIADA','SEGUIMIENTO','ACEPTADO','PERDIDO','CANCELADO','ARCHIVADO']) WITH ORDINALITY AS t(status,n);
INSERT INTO prospecto_seguimientos(id,organization_id,prospecto_id,usuario_id,tipo,contenido)
 SELECT gen_random_uuid(),organization_id,id,user_id,'NOTA','Nota sintética previa a G0-A' FROM prospectos;
INSERT INTO cotizaciones(id,organization_id,prospecto_id,user_id,notaria_id,estado,numero_cotizacion,updated_at)
 SELECT ('60000000-0000-4000-8000-00000000000'||n)::uuid,
 ('10000000-0000-4000-8000-00000000000'||n)::uuid,
 ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-00000000000'||n)::uuid,
 ('40000000-0000-4000-8000-00000000000'||n)::uuid,'CONVERTIDA_EXPEDIENTE','COT-2026-00'||n,now()
 FROM generate_series(1,2) n;
INSERT INTO expedientes(id,organization_id,numero_pravia,abogado_id,creador_id,cotizacion_id)
 SELECT ('70000000-0000-4000-8000-00000000000'||n)::uuid,
 ('10000000-0000-4000-8000-00000000000'||n)::uuid,'EXP-2026-000'||n,
 ('20000000-0000-4000-8000-00000000000'||n)::uuid,
 ('20000000-0000-4000-8000-00000000000'||n)::uuid,
 ('60000000-0000-4000-8000-00000000000'||n)::uuid FROM generate_series(1,2) n;
INSERT INTO documentos(id,organization_id,nombre_original,nombre_interno,tipo,storage_key,mime_type,size_bytes,subido_por_id,prospecto_id)
 SELECT gen_random_uuid(),organization_id,'Documento sintético.pdf','test-'||id,'PREDIAL',
 'organizations/'||organization_id||'/documentos/test-'||id,'application/pdf',100,user_id,id FROM prospectos;
INSERT INTO audit_logs(id,organization_id,user_id,accion,entidad,entidad_id)
 SELECT gen_random_uuid(),organization_id,user_id,'CREATE','Prospecto',id FROM prospectos;
CREATE TABLE public.g0a_before AS
 SELECT 'prospectos' AS entity,to_jsonb(p) AS row FROM prospectos p UNION ALL
 SELECT 'prospecto_seguimientos',to_jsonb(p) FROM prospecto_seguimientos p UNION ALL
 SELECT 'cotizaciones',to_jsonb(p) FROM cotizaciones p UNION ALL
 SELECT 'expedientes',to_jsonb(p) FROM expedientes p UNION ALL
 SELECT 'documentos',to_jsonb(p) FROM documentos p UNION ALL
 SELECT 'organizations',to_jsonb(p) FROM organizations p UNION ALL
 SELECT 'audit_logs',to_jsonb(p) FROM audit_logs p;
SELECT entity,count(*) FROM public.g0a_before GROUP BY entity ORDER BY entity;
