import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';

const auditedModules = new Set([
  'prospectos', 'cotizaciones', 'expedientes', 'comparecientes', 'predios',
  'documentos', 'finanzas', 'settings', 'collaboration',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denialCode = /^[A-Z][A-Z0-9_]{2,79}$/;

/** Only authenticated 403s in sensitive modules are audited. Request bodies,
 * query strings, cookies and credentials are deliberately never recorded. */
export function securityDenialAudit(db: Pick<PrismaClient, 'auditLog'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.path is mount-relative inside app.use('/api', ...); originalUrl keeps
    // the module prefix. Strip the query string before inspecting identifiers.
    const path = String(req.originalUrl || req.path).split('?')[0].split('/').filter(Boolean);
    const moduleName = path[1];
    if (path[0] !== 'api' || !auditedModules.has(moduleName) || !req.user) return next();
    const actor = req.user;
    const resourceId = path.find((part) => uuid.test(part)) || null;
    let responseCode: string | null = null;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (body && typeof body === 'object' && 'code' in body) {
        const code = (body as { code?: unknown }).code;
        if (typeof code === 'string' && denialCode.test(code)) responseCode = code;
      }
      return originalJson(body);
    }) as Response['json'];
    res.once('finish', () => {
      if (res.statusCode !== 403) return;
      // A short process-local window prevents a browser retry loop from flooding
      // AuditLog. It never suppresses the first denial or the HTTP 403 itself.
      const key = `${actor.organizationId}:${actor.id}:${actor.sessionId}:${req.method}:${moduleName}:${resourceId || ''}:${responseCode || ''}`;
      const now = Date.now();
      const last = recentDenials.get(key);
      if (last && now - last < 5000) return;
      recentDenials.set(key, now);
      if (recentDenials.size > 2000) for (const [item, at] of recentDenials) if (now - at > 5000) recentDenials.delete(item);
      void db.auditLog.create({ data: {
        organization_id: actor.organizationId,
        user_id: actor.id,
        session_id: actor.sessionId,
        correlation_id: randomUUID(),
        accion: 'ACTION_DENIED',
        entidad: moduleName,
        entidad_id: resourceId || actor.id,
        detalles: { result: 'ACTION_DENIED', method: req.method, module: moduleName,
          object_id: resourceId, code: responseCode || 'ACCESS_DENIED' },
      } }).catch(() => {
        // A database outage must never turn a denied request into an allowed one.
        // Operational logging records only a code, not request content.
        console.error('SECURITY_DENIAL_AUDIT_WRITE_FAILED');
      });
    });
    next();
  };
}

const recentDenials = new Map<string, number>();
