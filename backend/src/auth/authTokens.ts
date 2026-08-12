import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = 'pravia_refresh';

type AccessClaims = {
  sub: string;
  sid: string;
  role: Role;
  type: 'access';
};

export function getJwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET || '';
  if (secret.length < 32) throw new Error('AUTH_JWT_SECRET debe tener al menos 32 caracteres.');
  return secret;
}

export const signAccessToken = (claims: Omit<AccessClaims, 'type'>) => jwt.sign(
  { ...claims, type: 'access' },
  getJwtSecret(),
  { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS, issuer: 'pravia-os', audience: 'pravia-web' },
);

export const verifyAccessToken = (token: string) => jwt.verify(token, getJwtSecret(), {
  algorithms: ['HS256'], issuer: 'pravia-os', audience: 'pravia-web',
}) as AccessClaims & jwt.JwtPayload;

export const newOpaqueToken = () => randomBytes(48).toString('base64url');
export const hashOpaqueToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function constantTimeEqual(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseCookies(header?: string): Record<string, string> {
  return (header || '').split(';').reduce<Record<string, string>>((result, pair) => {
    const separator = pair.indexOf('=');
    if (separator < 0) return result;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
    return result;
  }, {});
}
