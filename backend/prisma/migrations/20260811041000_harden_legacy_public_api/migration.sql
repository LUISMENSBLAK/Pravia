-- Fase 10: cierre explícito del Data API sobre tablas heredadas del esquema public.
-- La aplicación usa Prisma sobre pravia_os; estas tablas no tienen consumidores.
-- Sin políticas, RLS aplica denegación por defecto a anon/authenticated.

ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_acto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_requeridos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hallazgos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_cargados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fichas_datos_generales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyectos_escritura ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._prisma_migrations FROM anon, authenticated;
REVOKE ALL ON TABLE public.tipos_acto FROM anon, authenticated;
REVOKE ALL ON TABLE public.documentos_requeridos FROM anon, authenticated;
REVOKE ALL ON TABLE public.expedientes FROM anon, authenticated;
REVOKE ALL ON TABLE public.hallazgos FROM anon, authenticated;
REVOKE ALL ON TABLE public.documentos_cargados FROM anon, authenticated;
REVOKE ALL ON TABLE public.fichas_datos_generales FROM anon, authenticated;
REVOKE ALL ON TABLE public.proyectos_escritura FROM anon, authenticated;

ALTER FUNCTION pravia_os.fn_check_compareciente_perfil()
  SET search_path = pravia_os, pg_temp;
