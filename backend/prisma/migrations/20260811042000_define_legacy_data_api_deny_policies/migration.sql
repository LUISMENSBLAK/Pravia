-- Políticas explícitas de denegación para el modelo actual sin Data API directa.
-- Prisma usa la conexión PostgreSQL del servidor y no depende de anon/authenticated.

CREATE POLICY legacy_data_api_denied ON public._prisma_migrations
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY legacy_data_api_denied ON public.tipos_acto
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY legacy_data_api_denied ON public.documentos_requeridos
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY legacy_data_api_denied ON public.expedientes
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY legacy_data_api_denied ON public.hallazgos
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY legacy_data_api_denied ON public.documentos_cargados
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY legacy_data_api_denied ON public.fichas_datos_generales
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY legacy_data_api_denied ON public.proyectos_escritura
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
