import type { Role } from '@prisma/client';
import type { Permission } from '../auth/permissions';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        nombre: string;
        apellido: string;
        rol: Role;
        sessionId: string;
        permissions: Permission[];
        requiresPasswordChange: boolean;
      };
      correlationId?: string;
    }
  }
}

export {};
