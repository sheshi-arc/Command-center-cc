import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtKeys } from './keys.js';
import { getRedisClient } from './redis.js';
import { hashToken, generateRandomToken } from './security.js';
import { db } from './database.js';

export const REFRESH_COOKIE_NAME = 'refreshToken';
export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_TTL_PERSISTENT = 30 * 24 * 60 * 60; // 30 days
export const REFRESH_TOKEN_TTL_SESSION = 24 * 60 * 60; // 1 day

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  tokenVersion?: number;
}

/**
 * Generate RS256 JWT access token (15 minutes)
 */
export function generateAccessToken(user: SessionUser): string {
  const { privateKey } = getJwtKeys();
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion || 1,
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Issue new session:
 * 1. Creates RS256 access token (15m)
 * 2. Generates secure random refresh token
 * 3. Hashes refresh token and stores in Redis (30 days if keepMeSignedIn, else session TTL)
 * 4. Sets httpOnly, secure, SameSite cookie (session cookie unless keepMeSignedIn is true)
 */
export async function createSession(
  user: SessionUser,
  res?: Response,
  metadata?: { ip?: string; userAgent?: string; keepMeSignedIn?: boolean }
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = generateAccessToken(user);
  const rawRefreshToken = generateRandomToken(32);
  const tokenHash = hashToken(rawRefreshToken);
  const keepMeSignedIn = Boolean(metadata?.keepMeSignedIn);
  const ttlSeconds = keepMeSignedIn ? REFRESH_TOKEN_TTL_PERSISTENT : REFRESH_TOKEN_TTL_SESSION;

  const redis = getRedisClient();
  const sessionKey = `user_session:${user.id}:${tokenHash}`;
  const indexKey = `user_session_hashes:${user.id}`;

  const sessionData = JSON.stringify({
    userId: user.id,
    createdAt: new Date().toISOString(),
    ip: metadata?.ip || 'unknown',
    userAgent: metadata?.userAgent || 'unknown',
    keepMeSignedIn,
  });

  await redis.set(sessionKey, sessionData, 'EX', ttlSeconds);
  await redis.sadd(indexKey, tokenHash);
  await redis.expire(indexKey, ttlSeconds);

  // Set httpOnly, secure, SameSite cookie if Response is provided
  if (res) {
    setRefreshTokenCookie(res, rawRefreshToken, keepMeSignedIn);
  }

  return { accessToken, refreshToken: rawRefreshToken };
}

/**
 * Set httpOnly SameSite cookie for refresh token
 * If keepMeSignedIn is false, maxAge is omitted making it a browser session cookie
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string, keepMeSignedIn: boolean = false) {
  const cookieOptions: any = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
  if (keepMeSignedIn) {
    cookieOptions.maxAge = REFRESH_TOKEN_TTL_PERSISTENT * 1000;
  }
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, cookieOptions);
}

/**
 * Clear refresh token cookie
 */
export function clearRefreshTokenCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Rotate refresh token on use:
 * Validates old hashed token in Redis, invalidates it, issues brand new token
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  res?: Response,
  metadata?: { ip?: string; userAgent?: string }
): Promise<{ accessToken: string; refreshToken: string; user: any } | null> {
  const tokenHash = hashToken(rawRefreshToken);
  const redis = getRedisClient();

  // Find user by scanning session keys or checking all keys
  const keys = await redis.keys(`user_session:*:${tokenHash}`);
  if (!keys || keys.length === 0) {
    return null;
  }

  const sessionKey = keys[0];
  const parts = sessionKey.split(':');
  const userId = parts[1];

  let keepMeSignedIn = false;
  try {
    const rawData = await redis.get(sessionKey);
    if (rawData) {
      const parsed = JSON.parse(rawData);
      keepMeSignedIn = Boolean(parsed.keepMeSignedIn);
    }
  } catch {
    // ignore
  }

  // Retrieve user from DB to verify still active and fetch latest role
  const user = await db('users').where({ id: userId }).first();
  if (!user || user.status !== 'active') {
    // Delete session if user deactivated
    await redis.del(sessionKey);
    return null;
  }

  // Delete old session from Redis
  await redis.del(sessionKey);
  await redis.srem(`user_session_hashes:${userId}`, tokenHash);

  // Issue brand new rotated session
  const session = await createSession(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.token_version || 1,
    },
    res,
    { ...metadata, keepMeSignedIn }
  );

  return {
    ...session,
    user,
  };
}

/**
 * Invalidate a specific refresh token (Logout)
 */
export async function revokeSessionByToken(rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);
  const redis = getRedisClient();
  const keys = await redis.keys(`user_session:*:${tokenHash}`);
  if (keys && keys.length > 0) {
    for (const sessionKey of keys) {
      const parts = sessionKey.split(':');
      const userId = parts[1];
      await redis.del(sessionKey);
      await redis.srem(`user_session_hashes:${userId}`, tokenHash);
    }
  }
}

export async function revokeSession(userId: string, rawRefreshToken: string) {
  if (rawRefreshToken) {
    await revokeSessionByToken(rawRefreshToken);
  } else if (userId) {
    await revokeAllSessionsForUser(userId);
  }
}

/**
 * Sign out of all devices:
 * 1. Invalidates all active Redis session hashes for this user
 * 2. Increments token_version in DB (invalidates all existing RS256 access tokens immediately)
 */
export async function revokeAllSessionsForUser(userId: string) {
  const redis = getRedisClient();
  const indexKey = `user_session_hashes:${userId}`;
  const hashes = await redis.smembers(indexKey);

  if (hashes && hashes.length > 0) {
    const keysToDelete = hashes.map((h) => `user_session:${userId}:${h}`);
    await redis.del(...keysToDelete);
    await redis.del(indexKey);
  }

  // Increment token version in database
  await db('users')
    .where({ id: userId })
    .increment('token_version', 1);
}
