import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { app } from '../src/server.js';
import { db } from '../src/config/database.js';
import { hashToken } from '../src/config/security.js';

describe('Comprehensive Authentication, Open Sign-up & Security Suite', () => {
  beforeAll(async () => {
    // Run migrations and seeds
    await db.migrate.latest({
      directory: path.resolve(process.cwd(), 'src/db/migrations'),
    });
    await db.seed.run({
      directory: path.resolve(process.cwd(), 'src/db/seeds'),
    });
  });

  describe('1. 405 Error Prevention, CORS & Route Architecture', () => {
    it('handles CORS OPTIONS preflight on /api/auth/login with credentials allowed', async () => {
      const res = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');

      expect([200, 204]).toContain(res.status);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('returns 400 (Bad Request) instead of 405 (Method Not Allowed) on empty POST to /api/auth/login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({});

      expect(res.status).toBe(400);
      expect(res.status).not.toBe(405);
    });

    it('returns JSON 404 for nonexistent API routes, never 405', async () => {
      const res = await request(app)
        .post('/api/auth/non-existent-endpoint')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });
  });

  describe('2. Open Sign Up (Unrestricted Registration)', () => {
    const testEmail = `new_candidate_${Date.now()}@gmail.com`;

    it('rejects passwords shorter than 8 characters or lacking letters/numbers', async () => {
      const resShort = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'shortpass@example.com',
          password: 'pass1',
          name: 'Short Pass',
        });
      expect(resShort.status).toBe(400);

      const resNoNum = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'nonum@example.com',
          password: 'passwordonly',
          name: 'No Number',
        });
      expect(resNoNum.status).toBe(400);
    });

    it('allows anyone to register with any email address and assigns unpaid_intern role', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'ValidPassword123!',
          name: 'Candidate User',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('unpaid_intern');
      expect(res.body.user.email).toBe(testEmail);
      expect(res.body.user.emailVerified).toBe(false);
      expect(res.body.accessToken).toBeDefined();

      // Ensure cookie was set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
    });

    it('rejects duplicate email with exact message: "An account with this email already exists. Sign in instead."', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'ValidPassword123!',
          name: 'Duplicate Attempt',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('An account with this email already exists. Sign in instead.');
    });
  });

  describe('3. Email Verification Flow (24h Single-Use)', () => {
    let verificationToken: string;
    const verifyUserEmail = `unverified_${Date.now()}@college.edu`;

    beforeAll(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: verifyUserEmail,
          password: 'CollegePass123!',
          name: 'College Student',
        });

      // Retrieve user from DB to obtain token hash
      const user = await db('users').where({ email: verifyUserEmail }).first();
      expect(user).toBeDefined();
      expect(user.email_verification_token_hash).toBeDefined();
    });

    it('verifies email with a valid token', async () => {
      // Find the raw token by generating test token directly in DB
      const rawToken = 'test-verification-token-valid';
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db('users')
        .where({ email: verifyUserEmail })
        .update({
          email_verification_token_hash: tokenHash,
          email_verification_expires_at: expiresAt,
          email_verified: false,
        });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: rawToken });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('verified successfully');

      const updated = await db('users').where({ email: verifyUserEmail }).first();
      expect(Boolean(updated.email_verified)).toBe(true);
      expect(updated.email_verification_token_hash).toBeNull();
    });

    it('rejects reusing an already used verification token', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'test-verification-token-valid' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('already been used');
    });

    it('rejects an expired verification token', async () => {
      const expiredToken = 'expired-token-123';
      const tokenHash = hashToken(expiredToken);
      const expiredDate = new Date(Date.now() - 1000); // in the past

      await db('users')
        .where({ email: verifyUserEmail })
        .update({
          email_verification_token_hash: tokenHash,
          email_verification_expires_at: expiredDate,
        });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: expiredToken });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('expired');
    });
  });

  describe('4. Login for Seeded Accounts & Lockout Security', () => {
    it('successfully logs in all 4 seeded accounts with correct credentials', async () => {
      const seededAccounts = [
        { email: 'sriram@smru.edu.in', pass: process.env.SEED_ADMIN_PASSWORD || 'AdminPass123!@#', expectedRole: 'admin' },
        { email: 'sheshitejs@gmail.com', pass: process.env.SEED_COADMIN_PASSWORD || 'CoadminPass123!@#', expectedRole: 'lead' },
        { email: 'gundasurya600@gmail.com', pass: process.env.SEED_CORE_PASSWORD || 'CorePass123!@#', expectedRole: 'paid_intern' },
        { email: 'anaalia092@gmail.com', pass: process.env.SEED_INTERN_PASSWORD || 'InternPass123!@#', expectedRole: 'unpaid_intern' },
      ];

      for (const account of seededAccounts) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({
            email: account.email,
            password: account.pass,
          });

        expect(res.status, `Failed to login ${account.email}`).toBe(200);
        expect(res.body.user.email).toBe(account.email);
        expect(res.body.user.role).toBe(account.expectedRole);
        expect(res.body.accessToken).toBeDefined();
      }
    });

    it('returns exact message "Email or password is incorrect." on wrong credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'sriram@smru.edu.in',
          password: 'CompletelyWrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Email or password is incorrect.');
    });

    it('locks account for 15 minutes after 5 consecutive failed attempts', async () => {
      const targetEmail = 'lockout_test@example.com';
      await request(app)
        .post('/api/auth/register')
        .send({
          email: targetEmail,
          password: 'Password123!',
          name: 'Lockout Target',
        });

      // 4 wrong attempts
      for (let i = 0; i < 4; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: targetEmail, password: 'WrongPassword123!' });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Email or password is incorrect.');
      }

      // 5th wrong attempt triggers lockout
      const fifthRes = await request(app)
        .post('/api/auth/login')
        .send({ email: targetEmail, password: 'WrongPassword123!' });
      expect(fifthRes.status).toBe(423);
      expect(fifthRes.body.message).toContain('15 minutes');

      // 6th attempt even with correct password is still locked out
      const sixthRes = await request(app)
        .post('/api/auth/login')
        .send({ email: targetEmail, password: 'Password123!' });
      expect(sixthRes.status).toBe(423);
    });

    it('supports "Keep me signed in" 30-day cookie vs browser session cookie', async () => {
      const resPersistent = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'sriram@smru.edu.in',
          password: process.env.SEED_ADMIN_PASSWORD || 'AdminPass123!@#',
          keepMeSignedIn: true,
        });

      expect(resPersistent.status).toBe(200);
      const persistentCookies = resPersistent.headers['set-cookie'] || [];
      const hasMaxAge = persistentCookies.some((c: string) => c.includes('Max-Age='));
      expect(hasMaxAge).toBe(true);

      const resSession = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'sriram@smru.edu.in',
          password: process.env.SEED_ADMIN_PASSWORD || 'AdminPass123!@#',
          keepMeSignedIn: false,
        });

      expect(resSession.status).toBe(200);
      const sessionCookies = resSession.headers['set-cookie'] || [];
      const refreshCookie = sessionCookies.find((c: string) => c.startsWith('refreshToken='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).not.toContain('Max-Age=');
    });
  });

  describe('5. Token Refresh, Rotation & Logout', () => {
    it('refreshes token, rotates refresh token, and prevents token reuse', async () => {
      // 1. Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'sheshitejs@gmail.com',
          password: process.env.SEED_COADMIN_PASSWORD || 'CoadminPass123!@#',
        });

      const initialCookie = loginRes.headers['set-cookie'][0];
      const initialRefreshToken = initialCookie.split(';')[0].replace('refreshToken=', '');

      // 2. Refresh token
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${initialRefreshToken}`]);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.accessToken).toBeDefined();

      const newCookie = refreshRes.headers['set-cookie'][0];
      const rotatedRefreshToken = newCookie.split(';')[0].replace('refreshToken=', '');
      expect(rotatedRefreshToken).not.toBe(initialRefreshToken);

      // 3. Attempt reuse of old refresh token must fail
      const reuseRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${initialRefreshToken}`]);

      expect(reuseRes.status).toBe(401);
    });

    it('logs out and clears session on server', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'gundasurya600@gmail.com',
          password: process.env.SEED_CORE_PASSWORD || 'CorePass123!@#',
        });

      const cookie = loginRes.headers['set-cookie'][0];
      const refreshToken = cookie.split(';')[0].replace('refreshToken=', '');

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
        .set('Cookie', [`refreshToken=${refreshToken}`]);

      expect(logoutRes.status).toBe(200);

      // Verify refresh with that token fails after logout
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`]);

      expect(refreshRes.status).toBe(401);
    });
  });

  describe('6. Password Reset Flow (30-Minute Single-Use Token)', () => {
    it('always shows uniform confirmation message on forgot password request', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'sriram@smru.edu.in' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('password reset link has been sent');

      // Also for non-existent email
      const resNonExistent = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent_account@nowhere.com' });

      expect(resNonExistent.status).toBe(200);
      expect(resNonExistent.body.message).toContain('password reset link has been sent');
    });

    it('resets password using token and revokes sessions on all devices', async () => {
      const testEmail = `reset_test_${Date.now()}@example.com`;
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'OldPassword123!',
          name: 'Reset Test',
        });

      const oldAccessToken = regRes.body.accessToken;
      const user = await db('users').where({ email: testEmail }).first();

      // Set up a valid reset token in password_resets table
      const resetToken = 'valid-reset-token-30m';
      const tokenHash = hashToken(resetToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 mins

      await db('password_resets').insert({
        id: `pr-test-${Date.now()}`,
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        used: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Submit reset
      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          password: 'NewBrandPassword123!',
        });

      expect(resetRes.status).toBe(200);

      // Old access token must now be revoked (token_version incremented)
      const oldTokenRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldAccessToken}`);
      expect(oldTokenRes.status).toBe(401);

      // New password works
      const newLoginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'NewBrandPassword123!',
        });
      expect(newLoginRes.status).toBe(200);
    });
  });

  describe('7. Role of New Account & Role Change by Admin', () => {
    it('creates account as unpaid intern and allows admin to change role', async () => {
      // 1. Admin logs in
      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'sriram@smru.edu.in',
          password: process.env.SEED_ADMIN_PASSWORD || 'AdminPass123!@#',
        });
      const adminToken = adminLogin.body.accessToken;

      // 2. Register new user
      const internEmail = `role_change_${Date.now()}@test.com`;
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: internEmail,
          password: 'InternPassword123!',
          name: 'Promote Candidate',
        });

      expect(regRes.body.user.role).toBe('unpaid_intern');
      const userId = regRes.body.user.id;

      // 3. Admin modifies role to paid_intern
      const updateRes = await request(app)
        .patch(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: 'paid_intern',
          internType: 'paid',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.user.role).toBe('paid_intern');

      // 4. Verify in DB
      const userInDb = await db('users').where({ id: userId }).first();
      expect(userInDb.role).toBe('paid_intern');
    });
  });

  describe('8. Invite Acceptance Flow', () => {
    it('allows Core intern to invite an unpaid intern and accept the invite', async () => {
      // 1. Core intern logs in
      const coreLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'gundasurya600@gmail.com',
          password: process.env.SEED_CORE_PASSWORD || 'CorePass123!@#',
        });
      const coreToken = coreLogin.body.accessToken;

      // 2. Create invite
      const inviteEmail = `invited_by_core_${Date.now()}@domain.com`;
      const inviteRes = await request(app)
        .post('/api/invites')
        .set('Authorization', `Bearer ${coreToken}`)
        .send({
          name: 'Invited Peer',
          email: inviteEmail,
          role: 'unpaid_intern',
        });

      expect(inviteRes.status).toBe(201);
      const inviteToken = inviteRes.body.token;

      // 3. Accept invite
      const acceptRes = await request(app)
        .post('/api/invites/accept')
        .send({
          token: inviteToken,
          password: 'AcceptedPassword123!',
        });

      expect([200, 201]).toContain(acceptRes.status);
      expect(acceptRes.body.user.email).toBe(inviteEmail);
      expect(acceptRes.body.user.role).toBe('unpaid_intern');

      // 4. Single-use: cannot accept again
      const repeatRes = await request(app)
        .post('/api/invites/accept')
        .send({
          token: inviteToken,
          password: 'AcceptedPassword123!',
        });

      expect(repeatRes.status).toBe(400);
    });
  });
});
