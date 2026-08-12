import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { configuredDatabaseMode, configuredDatabasePrimary, configuredDatabaseSchema, prisma } from './config/prisma';
import { checkStorageHealth, getStorageInfo } from './services/supabase.service';
import { getOpenAIEscalationModelName, getOpenAIModelName } from './services/openaiDocument.service';

import prospectosRoutes from './routes/prospectos.routes';
import documentosRoutes from './routes/documentos.routes';
import notariasRoutes from './routes/notarias.routes';
import cotizacionesRoutes from './routes/cotizaciones.routes';
import expedientesRoutes from './routes/expedientes.routes';
import comparecientesRoutes from './routes/compareciente.routes';
import comparecienteAltaSessionRoutes from './routes/comparecienteAltaSession.routes';
import finanzasRoutes from './routes/finanzas.routes';
import agendaRoutes from './routes/agenda.routes';
import reportesRoutes from './routes/reportes.routes';
import miDiaRoutes from './routes/miDia.routes';
import aiRoutes from './routes/ai.routes';
import complianceRoutes from './routes/compliance.routes';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import storageRoutes from './routes/storage.routes';
import { authenticate, authorizeByMethod, authorizeExpedienteRequest, requirePasswordReady, requirePermission } from './middleware/auth.middleware';
import { errorLogLevel, normalizeErrorBody } from './utils/httpError';
import { getStorageCompensationHealth, storageCompensationWorker } from './workers/storageCompensation.worker';

const app = express();
app.disable('etag');
app.disable('x-powered-by');
const PORT = process.env.PORT || 3001;
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.header('x-correlation-id') || randomUUID();
  const startedAt = Date.now();
  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 400) return originalJson(body);
    const normalized = normalizeErrorBody(body, res.statusCode, correlationId, process.env.NODE_ENV === 'production');
    res.locals.errorCode = normalized.code;
    return originalJson(normalized);
  }) as Response['json'];

  res.on('finish', () => {
    console.log(JSON.stringify({
      type: 'http_request',
      level: errorLogLevel(res.statusCode),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
      correlation_id: correlationId,
      user_id: req.user?.id,
      error_code: res.locals.errorCode,
    }));
  });

  next();
});

// ══════════════════════════════════════
// Health Check — infrastructure verification without depending on business data
// ══════════════════════════════════════
const healthHandler = async (req: Request, res: Response) => {
  const correlationId = (req as Request & { correlationId?: string }).correlationId;
  let storage: 'ok' | 'error' | 'not_configured' = 'not_configured';
  const storageInfo = getStorageInfo();

  try {
    await prisma.$queryRaw`SELECT 1`;

    storage = await checkStorageHealth();
    const storageCompensation = await getStorageCompensationHealth();
    return res.json({
      api: 'ok',
      database: 'ok',
      storage,
      service: 'PRAVIA OS backend',
      environment: process.env.NODE_ENV || 'development',
      database_mode: configuredDatabaseMode,
      database_primary: configuredDatabasePrimary,
      database_schema: configuredDatabaseSchema,
      storage_mode: storageInfo.mode,
      storage_primary: storageInfo.primary,
      storage_provider: storageInfo.provider,
      replication_enabled: storageInfo.replication_enabled,
      storage_compensation: storageCompensation,
      timestamp: new Date().toISOString(),
      correlation_id: correlationId,
    });
  } catch (dbErr: any) {
    return res.status(503).json({
      api: 'ok',
      database: 'error',
      storage,
      service: 'PRAVIA OS backend',
      environment: process.env.NODE_ENV || 'development',
      database_mode: configuredDatabaseMode,
      database_primary: configuredDatabasePrimary,
      database_schema: configuredDatabaseSchema,
      storage_mode: storageInfo.mode,
      storage_primary: storageInfo.primary,
      storage_provider: storageInfo.provider,
      replication_enabled: storageInfo.replication_enabled,
      timestamp: new Date().toISOString(),
      correlation_id: correlationId,
      ...(process.env.NODE_ENV === 'development' ? { detail: dbErr.message } : {}),
    });
  }
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Enlaces firmados de Storage local: la firma corta sustituye al JWT para visor/descarga.
app.use('/api/storage', storageRoutes);

// Autenticación pública: solo estas operaciones aceptan solicitudes sin JWT.
app.use('/api/auth', (req: Request, res: Response, next: NextFunction) => {
  const origin = req.header('origin');
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ code: 'ORIGIN_NOT_ALLOWED', error: 'Origen no autorizado.' });
  }
  return next();
}, authRoutes);

// ══════════════════════════════════════
// Secure IA Diagnostic Endpoint (Rule 4)
// ══════════════════════════════════════
app.get('/api/comparecientes/ia/status', authenticate, requirePermission('ia.read'), (_req: Request, res: Response) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getOpenAIModelName();
  const provider = 'OPENAI';

  return res.json({
    provider_configured: !!provider,
    model_configured: !!(model && model.trim().length > 0),
    api_key_configured: !!(apiKey && apiKey.trim().length > 0),
    model,
    escalation_model: getOpenAIEscalationModelName(),
    reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'high',
  });
});

if (process.env.NODE_ENV !== 'production') app.get('/api/debug/openai', authenticate, requirePermission('ia.read'), async (_req: Request, res: Response) => {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  const model = getOpenAIModelName();

  if (!apiKey) {
    return res.status(503).json({
      success: false,
      provider: 'OPENAI',
      model,
      error: 'La variable OPENAI_API_KEY no está configurada.'
    });
  }

  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000)
    });
    const detail = response.ok ? null : (await response.text()).slice(0, 300);
    return res.status(response.ok ? 200 : response.status).json({
      success: response.ok,
      provider: 'OPENAI',
      model,
      api_key_configured: true,
      detail
    });
  } catch (error: any) {
    return res.status(503).json({ success: false, provider: 'OPENAI', model, error: error.message });
  }
});

// ══════════════════════════════════════
// Feature Routes
// ══════════════════════════════════════
app.use('/api', authenticate);
app.use('/api', requirePasswordReady);
app.use('/api/users', usersRoutes);
app.use('/api/prospectos', authorizeByMethod('prospectos.read', 'prospectos.write'), prospectosRoutes);
app.use('/api/documentos', authorizeByMethod('documentos.read', 'documentos.write'), documentosRoutes);
app.use('/api/notarias', authorizeByMethod('notarias.read', 'notarias.write'), notariasRoutes);
app.use('/api/cotizaciones', authorizeByMethod('cotizaciones.read', 'cotizaciones.write'), cotizacionesRoutes);
app.use('/api/expedientes', authorizeExpedienteRequest, expedientesRoutes);
app.use('/api/comparecientes/altas', authorizeByMethod('comparecientes.read', 'comparecientes.write'), comparecienteAltaSessionRoutes);
app.use('/api/comparecientes/alta', authorizeByMethod('comparecientes.read', 'comparecientes.write'), comparecienteAltaSessionRoutes);
app.use('/api/comparecientes', authorizeByMethod('comparecientes.read', 'comparecientes.write'), comparecientesRoutes);
app.use('/api/finanzas', requirePermission('finanzas.read'), finanzasRoutes);
app.use('/api/agenda', authorizeByMethod('agenda.read', 'agenda.write'), agendaRoutes);
app.use('/api/reportes', requirePermission('reportes.read'), reportesRoutes);
app.use('/api/mi-dia', requirePermission('mi_dia.read'), miDiaRoutes);
app.use('/api/ia', aiRoutes);
app.use('/api/cumplimiento', authorizeByMethod('cumplimiento.read', 'cumplimiento.write'), complianceRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  const correlationId = (req as Request & { correlationId?: string }).correlationId;
  res.status(404).json({
    code: 'ROUTE_NOT_FOUND',
    error: `Ruta no encontrada: ${req.method} ${req.path}`,
    correlation_id: correlationId,
  });
});

// Error final: captura fallos no controlados sin exponer stack, secretos o datos del usuario.
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const correlationId = req.correlationId || randomUUID();
  console.error(JSON.stringify({
    type: 'unhandled_error',
    level: 'error',
    method: req.method,
    path: req.path,
    correlation_id: correlationId,
    user_id: req.user?.id,
    error_name: error instanceof Error ? error.name : 'UnknownError',
  }));
  if (res.headersSent) return;
  return res.status(500).json({
    code: 'INTERNAL_ERROR',
    error: 'No fue posible completar la solicitud. Intenta de nuevo.',
  });
});

const server = app.listen(PORT, () => {
  console.log(`✅ PRAVIA OS Backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Supabase Storage: ${process.env.SUPABASE_URL ? '✅ configured' : '❌ NOT configured'}`);
});

if (String(process.env.STORAGE_COMPENSATION_WORKER_ENABLED || 'false').toLowerCase() === 'true') {
  storageCompensationWorker.start();
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ type: 'lifecycle', event: 'shutdown_started', signal }));
  const forced = setTimeout(() => {
    console.error(JSON.stringify({ type: 'lifecycle', event: 'shutdown_timeout', signal }));
    process.exitCode = 1;
    server.closeAllConnections?.();
  }, 15_000);
  forced.unref();
  const workerDrained = await storageCompensationWorker.stop(10_000);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect().catch(() => undefined);
  clearTimeout(forced);
  console.log(JSON.stringify({ type: 'lifecycle', event: 'shutdown_completed', signal, worker_drained: workerDrained }));
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
