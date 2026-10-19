import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Add email verification columns to users
  const hasEmailVerified = await knex.schema.hasColumn('users', 'email_verified');
  if (!hasEmailVerified) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('email_verified').defaultTo(false);
      table.string('email_verification_token_hash').nullable();
      table.timestamp('email_verification_expires_at').nullable();
    });
  }

  // Set existing seeded accounts as verified
  await knex('users')
    .whereIn('email', [
      'sriram@smru.edu.in',
      'sheshitejs@gmail.com',
      'gundasurya600@gmail.com',
      'anaalia092@gmail.com',
    ])
    .update({ email_verified: true });

  // 2. Create app_settings table
  const hasAppSettings = await knex.schema.hasTable('app_settings');
  if (!hasAppSettings) {
    await knex.schema.createTable('app_settings', (table) => {
      table.string('key').primary();
      table.text('value').notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex('app_settings').insert({
      key: 'require_email_verification',
      value: 'false',
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasEmailVerified = await knex.schema.hasColumn('users', 'email_verified');
  if (hasEmailVerified) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('email_verification_expires_at');
      table.dropColumn('email_verification_token_hash');
      table.dropColumn('email_verified');
    });
  }

  await knex.schema.dropTableIfExists('app_settings');
}
