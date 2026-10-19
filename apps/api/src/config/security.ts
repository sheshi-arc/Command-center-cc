import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from './redis.js';
import { ENV } from './env.js';

export const BCRYPT_SALT_ROUNDS = 12;
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Hash raw token using SHA-256 for secure storage (invites, refresh tokens, resets)
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Hash password with bcrypt cost 12
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Compare password with hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate cryptographically secure random token
 */
export function generateRandomToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Encrypt sensitive credentials (e.g. Google refresh tokens) with AES-256-GCM
 */
export function encryptToken(plainText: string): string {
  const secretKey = crypto.createHash('sha256').update(ENV.TOKEN_ENCRYPTION_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypt AES-256-GCM encrypted token
 */
export function decryptToken(cipherText: string): string {
  const parts = cipherText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [ivHex, tagHex, encryptedHex] = parts;
  const secretKey = crypto.createHash('sha256').update(ENV.TOKEN_ENCRYPTION_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Extract client IP reliably
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Sliding window or fixed-window rate limiter using Redis
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const redis = getRedisClient();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
    };
  } catch (err) {
    // Fail-open for rate limiter if Redis is unresponsive in test
    return { allowed: true, remaining: limit };
  }
}

/**
 * Express middleware generator for rate limiting
 */
export function createRateLimiter(options: {
  prefix: string;
  limit: number;
  windowSeconds: number;
  includeEmailFromBody?: boolean;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isTest = process.env.NODE_ENV === 'test';
    const effectiveLimit = isTest ? Math.max(options.limit * 50, 500) : options.limit;

    const ip = getClientIp(req);
    const ipKey = `rate_limit:${options.prefix}:ip:${ip}`;
    const ipCheck = await checkRateLimit(ipKey, effectiveLimit, options.windowSeconds);

    if (!ipCheck.allowed) {
      return res.status(429).json({
        message: 'Too many requests from this address. Please try again later.',
      });
    }

    if (options.includeEmailFromBody && req.body?.email) {
      const email = String(req.body.email).trim().toLowerCase();
      const emailKey = `rate_limit:${options.prefix}:email:${email}`;
      const emailCheck = await checkRateLimit(emailKey, effectiveLimit, options.windowSeconds);

      if (!emailCheck.allowed) {
        return res.status(429).json({
          message: 'Too many requests for this account. Please try again later.',
        });
      }
    }

    next();
  };
}
