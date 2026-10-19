import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { db } from '../src/config/database.js';
import path from 'path';

describe('Command Center for Software Hub 2.0 - Core Business Rules, 5-Admin Limit & RBAC', () => {
  let adminToken: string;
  let leadToken: string;
  let coreToken: string;
  let unpaidToken: string;

  let adminUserId: string;
  let leadUserId: string;
  let coreUserId: string;
  let unpaidUserId: string;
  let testTaskId: string;
  let testPartId: string;

  beforeAll(async () => {
    // Run migrations and seeds
    await db.migrate.latest({
      directory: path.resolve(process.cwd(), 'src/db/migrations'),
    });
    await db.seed.run({
      directory: path.resolve(process.cwd(), 'src/db/seeds'),
    });

    // Obtain tokens for all 4 roles via real institutional login
    const adminRes = await request(app).post('/api/auth/login').send({
      email: 'sriram@smru.edu.in',
      password: process.env.SEED_ADMIN_PASSWORD || 'AdminPass123!@#',
    });
    adminToken = adminRes.body.accessToken;
    adminUserId = adminRes.body.user.id;

    const leadRes = await request(app).post('/api/auth/login').send({
      email: 'sheshitejs@gmail.com',
      password: process.env.SEED_COADMIN_PASSWORD || 'CoadminPass123!@#',
    });
    leadToken = leadRes.body.accessToken;
    leadUserId = leadRes.body.user.id;

    const coreRes = await request(app).post('/api/auth/login').send({
      email: 'gundasurya600@gmail.com',
      password: process.env.SEED_CORE_PASSWORD || 'CorePass123!@#',
    });
    coreToken = coreRes.body.accessToken;
    coreUserId = coreRes.body.user.id;

    const unpaidRes = await request(app).post('/api/auth/login').send({
      email: 'anaalia092@gmail.com',
      password: process.env.SEED_INTERN_PASSWORD || 'InternPass123!@#',
    });
    unpaidToken = unpaidRes.body.accessToken;
    unpaidUserId = unpaidRes.body.user.id;

    // Create a task and parts for testing
    testTaskId = `t-test-${Date.now()}`;
    await db('tasks').insert({
      id: testTaskId,
      task_number: 'TSK-TEST-01',
      title: 'Automated Test Task',
      description: 'Testing task visibility and review',
      priority: 'high',
      status: 'in_progress',
      due_date: new Date(Date.now() + 86400000),
      created_by: adminUserId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    testPartId = `p-test-${Date.now()}-1`;
    await db('task_parts').insert({
      id: testPartId,
      task_id: testTaskId,
      part_number: 1,
      total_parts: 1,
      title: 'Part 1 of Test Task',
      assigned_intern_id: unpaidUserId,
      due_date: new Date(Date.now() + 86400000),
      status: 'submitted',
      reviewer_id: leadUserId,
    });
  }, 30000);

  describe('1. Official Administrator Structure & 5-Admin Limit (Section 1)', () => {
    it('returns official admin summary showing active count and available positions', async () => {
      const res = await request(app)
        .get('/api/users/admins/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.maxAdmins).toBe(5);
      expect(res.body.activeAdminsCount).toBeGreaterThanOrEqual(1);
      expect(res.body.availablePositions).toBe(5 - res.body.activeAdminsCount);
      expect(res.body.primaryAdmin).toBeDefined();
    });

    it('enforces hard backend limit of 5 administrators and prevents creating a 6th admin', async () => {
      // Find current active admins count
      const initialSummary = await request(app)
        .get('/api/users/admins/summary')
        .set('Authorization', `Bearer ${adminToken}`);
      const currentCount = initialSummary.body.activeAdminsCount;
      const neededToFill = 5 - currentCount;

      // Create candidates to reach limit of 5 plus one extra
      const candidateIds: string[] = [];
      for (let i = 0; i <= neededToFill; i++) {
        const cId = `u-test-cand-${Date.now()}-${i}`;
        await db('users').insert({
          id: cId,
          name: `Candidate ${i}`,
          email: `cand${i}_${Date.now()}@test.softwarehub2.org`,
          role: 'paid_intern',
          status: 'active',
          token_version: 1,
          created_at: new Date(),
          updated_at: new Date(),
        });
        candidateIds.push(cId);
      }

      // Fill remaining available slots
      for (let i = 0; i < neededToFill; i++) {
        const grantRes = await request(app)
          .post('/api/users/admins')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ targetUserId: candidateIds[i] });
        expect(grantRes.status).toBe(200);
      }

      // Summary should now reflect 5 active admins and 0 available positions
      const summaryRes = await request(app)
        .get('/api/users/admins/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(summaryRes.body.activeAdminsCount).toBe(5);
      expect(summaryRes.body.availablePositions).toBe(0);

      // Attempting to grant a 6th administrator MUST be rejected with HTTP 400
      const overflowRes = await request(app)
        .post('/api/users/admins')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetUserId: candidateIds[neededToFill] });

      expect(overflowRes.status).toBe(400);
      expect(overflowRes.body.message).toContain('Maximum limit of 5 administrator positions reached');
    });

    it('records administrative actions in the audit log', async () => {
      const res = await request(app)
        .get('/api/users/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.some((l: any) => l.action.includes('ADMIN_ACCESS_GRANTED'))).toBe(true);
    });
  });

  describe('2. Role-Based Permissions & Scope Barriers', () => {
    it('allows admin and co-admin (lead) to manage automations and view system triggers', async () => {
      const res = await request(app)
        .get('/api/automations')
        .set('Authorization', `Bearer ${leadToken}`);

      expect(res.status).toBe(200);
      expect(res.body.automations.length).toBeGreaterThanOrEqual(10);
      expect(res.body.metrics.sentThisWeek).toBeDefined();
    });

    it('allows accessing email templates system and logs (Sections 5 & 6)', async () => {
      const res = await request(app)
        .get('/api/automations/email-templates/list')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('3. Task & Part Delegation Rules', () => {
    it('unpaid intern sees only their assigned parts on tasks', async () => {
      const res = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${unpaidToken}`);

      expect(res.status).toBe(200);
      for (const task of res.body) {
        for (const part of task.parts) {
          expect(part.assignedInternId).toBe(unpaidUserId);
        }
      }
    });

    it('successfully reviews and approves a task part with rating', async () => {
      const res = await request(app)
        .post(`/api/tasks/parts/${testPartId}/review`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          action: 'approve',
          rating: 5,
          comment: 'Outstanding audit findings!',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Part approved successfully');
    });
  });

  describe('4. Privacy-Preserving Attendance Rules', () => {
    it('records check-in without collecting location and returns status', async () => {
      const res = await request(app)
        .post('/api/attendance/check-in')
        .set('Authorization', `Bearer ${unpaidToken}`);

      expect([200, 400]).toContain(res.status);
    });

    it('exports attendance register to Excel workbook with valid mimetype', async () => {
      const res = await request(app)
        .get('/api/exports/attendance')
        .set('Authorization', `Bearer ${leadToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
    });
  });

  describe('5. Institutional Invites & Secure Onboarding', () => {
    let inviteToken: string;
    const inviteEmail = `new_intern_${Date.now()}@smru.edu.in`;

    it('allows open self-registration with any email and assigns unpaid_intern role', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'random_applicant@gmail.com',
          password: 'Password123!',
          name: 'Random User',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('unpaid_intern');
      expect(res.body.accessToken).toBeDefined();
    });

    it('allows Admin to create an invite link', async () => {
      const res = await request(app)
        .post('/api/invites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Invited Intern',
          email: inviteEmail,
          role: 'unpaid_intern',
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      inviteToken = res.body.token;
    });

    it('validates pending invite token details', async () => {
      const res = await request(app).get(`/api/invites/verify/${inviteToken}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(inviteEmail);
      expect(res.body.role).toBe('unpaid_intern');
    });

    it('accepts valid invite and creates account', async () => {
      const res = await request(app)
        .post('/api/invites/accept')
        .send({
          token: inviteToken,
          password: 'NewStrongPassword123!@#',
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.accessToken).toBeDefined();
    });

    it('burns single-use invite so second attempt fails', async () => {
      const res = await request(app)
        .post('/api/invites/accept')
        .send({
          token: inviteToken,
          password: 'NewStrongPassword123!@#',
        });

      expect([400, 410]).toContain(res.status);
    });
  });

  describe('6. Account Security, Lockout & Password Change', () => {
    it('seeded accounts have must_change_password set to true initially', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${coreToken}`);

      expect(res.status).toBe(200);
      expect(res.body.mustChangePassword).toBe(true);
    });

    it('locks out account after 5 consecutive failed login attempts', async () => {
      const targetEmail = `lockout_test_${Date.now()}@smru.edu.in`;
      const pass = 'CorrectPassword123!@#';
      const cId = `u-lockout-${Date.now()}`;

      // Insert fresh test user
      const bcrypt = (await import('bcryptjs')).default;
      const hash = await bcrypt.hash(pass, 10);
      await db('users').insert({
        id: cId,
        name: 'Lockout Test User',
        email: targetEmail,
        password_hash: hash,
        role: 'unpaid_intern',
        status: 'active',
        token_version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // 5 consecutive failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/auth/login').send({
          email: targetEmail,
          password: 'WrongPassword!',
        });
      }

      // 6th attempt (even with correct password) must be locked out
      const lockedRes = await request(app).post('/api/auth/login').send({
        email: targetEmail,
        password: pass,
      });

      expect(lockedRes.status).toBe(423);
      expect(lockedRes.body.message).toContain('locked');
    });
  });
});

