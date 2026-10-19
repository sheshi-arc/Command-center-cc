import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const BCRYPT_ROUNDS = 12;

/**
 * Idempotent seed script:
 * Creates ONLY these 4 official institutional accounts with passwords read from environment variables.
 * Never writes passwords in code or README.
 * Seeded users have must_change_password = true.
 *
 * 1. sriram@smru.edu.in : Admin (password from SEED_ADMIN_PASSWORD)
 * 2. sheshitejs@gmail.com : Co-admin / team lead (SEED_COADMIN_PASSWORD)
 * 3. gundasurya600@gmail.com, name Surya : Core intern (SEED_CORE_PASSWORD)
 * 4. anaalia092@gmail.com, name Anaalia : Unpaid intern, paired to Surya (SEED_INTERN_PASSWORD)
 */
export async function seed(knex: Knex): Promise<void> {
  const isTest = process.env.NODE_ENV === 'test';

  const adminPass = process.env.SEED_ADMIN_PASSWORD || (isTest ? 'AdminPass123!@#' : '');
  const coadminPass = process.env.SEED_COADMIN_PASSWORD || (isTest ? 'CoadminPass123!@#' : '');
  const corePass = process.env.SEED_CORE_PASSWORD || (isTest ? 'CorePass123!@#' : '');
  const internPass = process.env.SEED_INTERN_PASSWORD || (isTest ? 'InternPass123!@#' : '');

  if (!isTest && (!adminPass || !coadminPass || !corePass || !internPass)) {
    console.warn(
      '[Seed Warning] Missing one or more seed password environment variables (SEED_ADMIN_PASSWORD, SEED_COADMIN_PASSWORD, SEED_CORE_PASSWORD, SEED_INTERN_PASSWORD). Please define them in .env before running seed in production.'
    );
  }

  const suryaId = 'u-core-surya';
  const anaaliaId = 'u-intern-anaalia';

  const seedUsers = [
    {
      id: 'u-admin-sriram',
      name: 'Sri Ram',
      email: 'sriram@smru.edu.in',
      password: adminPass,
      role: 'admin',
      internType: null,
      level: 15,
      marksheetConfirmed: true,
      pairedId: null,
    },
    {
      id: 'u-lead-sheshi',
      name: 'Sheshi',
      email: 'sheshitejs@gmail.com',
      password: coadminPass,
      role: 'lead',
      internType: null,
      level: 10,
      marksheetConfirmed: true,
      pairedId: null,
    },
    {
      id: suryaId,
      name: 'Surya',
      email: 'gundasurya600@gmail.com',
      password: corePass,
      role: 'paid_intern',
      internType: 'paid',
      level: 5,
      marksheetConfirmed: true,
      pairedId: null,
    },
    {
      id: anaaliaId,
      name: 'Anaalia',
      email: 'anaalia092@gmail.com',
      password: internPass,
      role: 'unpaid_intern',
      internType: 'unpaid',
      level: 1,
      marksheetConfirmed: false,
      pairedId: suryaId, // Paired to Surya
    },
  ];

  for (const u of seedUsers) {
    const existing = await knex('users')
      .where('id', u.id)
      .orWhereRaw('LOWER(email) = ?', [u.email.toLowerCase()])
      .first();

    const passwordHash = u.password ? await bcrypt.hash(u.password, BCRYPT_ROUNDS) : null;
    const icsToken = crypto.randomBytes(24).toString('hex');

    if (!existing) {
      await knex('users').insert({
        id: u.id,
        name: u.name,
        email: u.email.toLowerCase(),
        password_hash: passwordHash,
        role: u.role,
        intern_type: u.internType,
        paired_paid_intern_id: u.pairedId,
        current_level: u.level,
        marksheet_percentage: u.role === 'paid_intern' ? 88.0 : null,
        marksheet_confirmed: u.marksheetConfirmed,
        status: 'active',
        token_version: 1,
        failed_login_attempts: 0,
        locked_until: null,
        must_change_password: true,
        ics_token: icsToken,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`[Seed] Created account: ${u.email} (${u.role})`);
    } else {
      // Keep existing, but ensure email, role, pairing and password are synchronized
      const updateData: Record<string, any> = {
        name: u.name,
        email: u.email.toLowerCase(),
        role: u.role,
        intern_type: u.internType,
        paired_paid_intern_id: u.pairedId,
        updated_at: new Date(),
      };
      if (passwordHash) {
        updateData.password_hash = passwordHash;
        updateData.must_change_password = true;
      }
      await knex('users')
        .where({ id: existing.id })
        .update(updateData);
      console.log(`[Seed] Verified account: ${u.email}`);
    }
  }

  // Ensure default attendance rules record exists
  const existingRules = await knex('attendance_rules').first();
  if (!existingRules) {
    await knex('attendance_rules').insert({
      id: 'att-rules-default',
      office_start_time: '09:00',
      grace_minutes: 15,
      half_day_hours: 4.0,
      absent_cutoff_time: '11:00',
      updated_at: new Date(),
    });
    console.log('[Seed] Default attendance rules created (09:00, 15m grace, 4h half-day, 11:00 absent).');
  }
}
