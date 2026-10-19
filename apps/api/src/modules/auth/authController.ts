import type { Request, Response } from 'express';
import { db } from '../../config/database.js';
import { ENV } from '../../config/env.js';
import {
  hashPassword,
  comparePassword,
  hashToken,
  generateRandomToken,
  LOCKOUT_THRESHOLD,
  LOCKOUT_DURATION_MS,
  getClientIp,
} from '../../config/security.js';
import {
  createSession,
  rotateRefreshToken,
  revokeSession,
  revokeSessionByToken,
  revokeAllSessionsForUser,
  clearRefreshTokenCookie,
  REFRESH_COOKIE_NAME,
} from '../../config/session.js';
import { sendSystemNotification } from '../automations/emailService.js';
import { USER_ROLES, INTERN_TYPES } from '@command-center/shared';

const UNIFORM_LOGIN_ERROR = 'Email or password is incorrect.';

/**
 * Open Sign Up:
 * Anyone can register with any email address (Gmail, college, company, anything).
 * Plain labels. Validates 8+ chars with at least one letter and number.
 * Account created as Unpaid intern with no team.
 * Sends 24h single-use verification email.
 * Immediately signs user in with access token and session cookie.
 */
export async function register(req: Request, res: Response) {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Full name, email, and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  // Password rules: at least 8 characters with at least one letter and one number
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ message: 'Password must contain at least one letter and one number' });
  }

  // Duplicate email check
  const existingUser = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();
  if (existingUser) {
    return res.status(409).json({
      message: 'An account with this email already exists. Sign in instead.',
    });
  }

  const passwordHash = await hashPassword(password);
  const userId = `u-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const rawVerifyToken = generateRandomToken(32);
  const verifyTokenHash = hashToken(rawVerifyToken);
  const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const icsToken = generateRandomToken(24);

  // New account created as Unpaid intern with no team
  await db('users').insert({
    id: userId,
    name: String(name).trim(),
    email: normalizedEmail,
    password_hash: passwordHash,
    role: USER_ROLES.UNPAID_INTERN,
    intern_type: INTERN_TYPES.UNPAID,
    team_id: null,
    paired_paid_intern_id: null,
    current_level: 1,
    status: 'active',
    token_version: 1,
    email_verified: false,
    email_verification_token_hash: verifyTokenHash,
    email_verification_expires_at: verifyExpiresAt,
    ics_token: icsToken,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Send verification email with 24-hour single-use link
  const verificationLink = `${ENV.CLIENT_ORIGIN || 'http://localhost:5173'}/verify-email?token=${rawVerifyToken}`;
  try {
    await sendSystemNotification({
      eventType: 'EMAIL_VERIFICATION',
      recipientEmail: normalizedEmail,
      recipientName: String(name).trim(),
      variables: {
        verification_link: verificationLink,
      },
    });
  } catch (err) {
    console.warn('[Register] Error dispatching verification email:', err);
  }

  // Issue session so user is immediately logged in
  const session = await createSession(
    {
      id: userId,
      email: normalizedEmail,
      role: USER_ROLES.UNPAID_INTERN,
      tokenVersion: 1,
    },
    res,
    { ip: getClientIp(req), userAgent: req.headers['user-agent'], keepMeSignedIn: false }
  );

  return res.status(201).json({
    message: 'Account created successfully. A verification link has been sent to your email.',
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: {
      id: userId,
      name: String(name).trim(),
      email: normalizedEmail,
      role: USER_ROLES.UNPAID_INTERN,
      internType: INTERN_TYPES.UNPAID,
      currentLevel: 1,
      emailVerified: false,
      mustChangePassword: false,
    },
    redirectUrl: '/',
  });
}

/**
 * Verify Email:
 * Validates single-use 24-hour token. Marks email as verified.
 */
export async function verifyEmail(req: Request, res: Response) {
  const token = (req.query?.token as string) || req.body?.token;

  if (!token) {
    return res.status(400).json({ message: 'This verification link is invalid or has already been used.' });
  }

  const tokenHash = hashToken(token);
  const user = await db('users').where({ email_verification_token_hash: tokenHash }).first();

  if (!user) {
    return res.status(400).json({ message: 'This verification link is invalid or has already been used.' });
  }

  if (user.email_verification_expires_at && new Date(user.email_verification_expires_at) < new Date()) {
    return res.status(400).json({ message: 'This verification link has expired. Please request a new one.' });
  }

  await db('users')
    .where({ id: user.id })
    .update({
      email_verified: true,
      email_verification_token_hash: null,
      email_verification_expires_at: null,
      updated_at: new Date(),
    });

  return res.json({ message: 'Email verified successfully!' });
}

/**
 * Resend Email Verification:
 * Generates fresh 24-hour token and sends verification link.
 */
export async function resendVerification(req: Request, res: Response) {
  const emailFromBody = req.body?.email;
  const emailFromUser = req.user?.email;
  const targetEmail = (emailFromBody || emailFromUser || '').trim().toLowerCase();

  if (!targetEmail) {
    return res.status(400).json({ message: 'Email is required to resend verification' });
  }

  const user = await db('users').whereRaw('LOWER(email) = ?', [targetEmail]).first();
  if (!user) {
    return res.json({ message: 'If an account exists, a new verification link has been sent.' });
  }

  if (user.email_verified) {
    return res.json({ message: 'Email is already verified.' });
  }

  const rawVerifyToken = generateRandomToken(32);
  const verifyTokenHash = hashToken(rawVerifyToken);
  const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db('users')
    .where({ id: user.id })
    .update({
      email_verification_token_hash: verifyTokenHash,
      email_verification_expires_at: verifyExpiresAt,
      updated_at: new Date(),
    });

  const verificationLink = `${ENV.CLIENT_ORIGIN || 'http://localhost:5173'}/verify-email?token=${rawVerifyToken}`;
  try {
    await sendSystemNotification({
      eventType: 'EMAIL_VERIFICATION',
      recipientEmail: user.email,
      recipientName: user.name,
      variables: {
        verification_link: verificationLink,
      },
    });
  } catch (err) {
    console.warn('[ResendVerification] Error:', err);
  }

  return res.json({ message: 'Verification email sent. Please check your inbox.' });
}

/**
 * Standard Login:
 * Plain labels. Exact uniform error message on wrong email or password: "Email or password is incorrect."
 * Locks for 15 minutes after 5 wrong attempts.
 * Supports "Keep me signed in" (30-day token vs session cookie).
 */
export async function login(req: Request, res: Response) {
  const { email, password, keepMeSignedIn } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: UNIFORM_LOGIN_ERROR });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();

  // If user doesn't exist, return uniform error
  if (!user) {
    return res.status(401).json({ message: UNIFORM_LOGIN_ERROR });
  }

  // Check 15-minute account lockout
  if (user.locked_until && new Date() < new Date(user.locked_until)) {
    const minutesLeft = Math.ceil(
      (new Date(user.locked_until).getTime() - Date.now()) / (60 * 1000)
    );
    return res.status(423).json({
      message: `Account is temporarily locked due to too many failed attempts. Try again in ${Math.max(1, minutesLeft)} minutes.`,
    });
  }

  // Deactivated user check
  if (user.status !== 'active') {
    return res.status(401).json({ message: UNIFORM_LOGIN_ERROR });
  }

  // Check admin requirement: "Require verified email before using the app" (default off)
  try {
    const requireVerificationSetting = await db('app_settings').where({ key: 'require_email_verification' }).first();
    if (requireVerificationSetting?.value === 'true' && !user.email_verified) {
      return res.status(403).json({
        message: 'Email verification is required before using the app. Please verify your email.',
        requiresVerification: true,
      });
    }
  } catch {
    // If setting table missing in dev, skip
  }

  // Password verification
  let passwordValid = false;
  if (user.password_hash) {
    passwordValid = await comparePassword(password, user.password_hash);
  }

  if (!passwordValid) {
    const newFailedAttempts = (user.failed_login_attempts || 0) + 1;
    const updates: Record<string, any> = { failed_login_attempts: newFailedAttempts };

    if (newFailedAttempts >= LOCKOUT_THRESHOLD) {
      updates.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS);
      updates.failed_login_attempts = 0; // reset counter after locking
    }

    await db('users').where({ id: user.id }).update(updates);

    if (newFailedAttempts >= LOCKOUT_THRESHOLD) {
      return res.status(423).json({
        message: 'Account is temporarily locked due to too many failed attempts. Try again in 15 minutes.',
      });
    }

    return res.status(401).json({ message: UNIFORM_LOGIN_ERROR });
  }

  // Successful login: reset failed attempts & lockout
  await db('users').where({ id: user.id }).update({
    failed_login_attempts: 0,
    locked_until: null,
  });

  // Issue session (RS256 JWT access token + refresh token in cookie and hashed in Redis)
  const session = await createSession(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.token_version || 1,
    },
    res,
    { ip: getClientIp(req), userAgent: req.headers['user-agent'], keepMeSignedIn: Boolean(keepMeSignedIn) }
  );

  return res.json({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      internType: user.intern_type,
      pairedPaidInternId: user.paired_paid_intern_id,
      currentLevel: user.current_level,
      marksheetPercentage: user.marksheet_percentage,
      marksheetConfirmed: user.marksheet_confirmed,
      avatarUrl: user.avatar_url,
      mustChangePassword: Boolean(user.must_change_password),
      emailVerified: Boolean(user.email_verified),
    },
    redirectUrl: '/',
  });
}

/**
 * Google Sign-In:
 * Signs in existing user or creates an Unpaid intern account with verified email.
 */
export async function googleSignIn(req: Request, res: Response) {
  const { token, credential, keepMeSignedIn } = req.body;
  const rawIdToken = token || credential;

  if (!rawIdToken) {
    return res.status(400).json({ message: 'Google ID token required' });
  }

  let email: string | null = null;
  let name: string | null = null;

  try {
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(rawIdToken)}`
    );
    if (!verifyRes.ok) {
      return res.status(401).json({ message: 'Invalid Google credential token' });
    }
    const tokenInfo = (await verifyRes.json()) as any;
    email = tokenInfo.email;
    name = tokenInfo.name;
  } catch {
    return res.status(401).json({ message: 'Failed to verify Google token' });
  }

  if (!email) {
    return res.status(401).json({ message: 'Google token does not contain email' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  let user = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();

  if (!user) {
    const userId = `u-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const icsToken = generateRandomToken(24);

    await db('users').insert({
      id: userId,
      name: name || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      password_hash: null,
      role: USER_ROLES.UNPAID_INTERN,
      intern_type: INTERN_TYPES.UNPAID,
      team_id: null,
      paired_paid_intern_id: null,
      status: 'active',
      current_level: 1,
      token_version: 1,
      email_verified: true,
      must_change_password: false,
      ics_token: icsToken,
      created_at: new Date(),
      updated_at: new Date(),
    });

    user = await db('users').where({ id: userId }).first();
  }

  if (user.status !== 'active') {
    return res.status(401).json({ message: UNIFORM_LOGIN_ERROR });
  }

  const session = await createSession(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.token_version || 1,
    },
    res,
    { ip: getClientIp(req), userAgent: req.headers['user-agent'], keepMeSignedIn: Boolean(keepMeSignedIn) }
  );

  return res.json({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      internType: user.intern_type,
      pairedPaidInternId: user.paired_paid_intern_id,
      currentLevel: user.current_level,
      marksheetPercentage: user.marksheet_percentage,
      marksheetConfirmed: user.marksheet_confirmed,
      avatarUrl: user.avatar_url,
      mustChangePassword: Boolean(user.must_change_password),
      emailVerified: Boolean(user.email_verified),
    },
    redirectUrl: '/',
  });
}

/**
 * Microsoft OpenID Connect SSO Sign-In:
 */
export async function microsoftSignIn(req: Request, res: Response) {
  if (!ENV.MS_OIDC_CLIENT_ID) {
    return res.status(403).json({ message: 'Microsoft Sign-In is not configured.' });
  }
  return res.status(501).json({ message: 'Microsoft Sign-In pending institutional callback.' });
}

/**
 * Public Authentication Configuration:
 * Exposes whether Google Sign-In is available without exposing secrets.
 */
export async function getAuthConfig(_req: Request, res: Response) {
  return res.json({
    googleClientId: ENV.GOOGLE_CLIENT_ID || null,
  });
}

/**
 * Get App Settings (Admin requirement for verified email)
 */
export async function getAppSettings(_req: Request, res: Response) {
  try {
    const setting = await db('app_settings').where({ key: 'require_email_verification' }).first();
    return res.json({
      requireEmailVerification: setting?.value === 'true',
    });
  } catch {
    return res.json({ requireEmailVerification: false });
  }
}

/**
 * Update App Settings (Admin setting: "Require verified email before using the app")
 */
export async function updateAppSettings(req: Request, res: Response) {
  const { requireEmailVerification } = req.body;
  if (typeof requireEmailVerification !== 'boolean') {
    return res.status(400).json({ message: 'requireEmailVerification boolean required' });
  }

  try {
    const existing = await db('app_settings').where({ key: 'require_email_verification' }).first();
    if (existing) {
      await db('app_settings')
        .where({ key: 'require_email_verification' })
        .update({ value: String(requireEmailVerification), updated_at: new Date() });
    } else {
      await db('app_settings').insert({
        key: 'require_email_verification',
        value: String(requireEmailVerification),
      });
    }
    return res.json({ requireEmailVerification, message: 'Settings updated successfully' });
  } catch (err: any) {
    return res.status(500).json({ message: err.message || 'Failed to update settings' });
  }
}

/**
 * Token Refresh:
 * Validates refresh token from cookie or body, rotates hashed token in Redis, issues new tokens
 */
export async function refreshToken(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (!token) {
    return res.status(401).json({ message: 'Refresh token required' });
  }

  const session = await rotateRefreshToken(token, res, {
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'],
  });

  if (!session) {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ message: 'Refresh token invalid or expired' });
  }

  return res.json({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
}

/**
 * Logout:
 * Ends the session on the server and clears the cookie
 */
export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

  if (token) {
    await revokeSessionByToken(token);
  } else if (req.user) {
    await revokeAllSessionsForUser(req.user.id);
  }

  clearRefreshTokenCookie(res);
  return res.json({ message: 'Signed out successfully' });
}

/**
 * Sign out of all devices:
 * Invalidates all active Redis sessions and increments token_version in DB
 */
export async function signoutAllDevices(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  await revokeAllSessionsForUser(req.user.id);
  clearRefreshTokenCookie(res);

  return res.json({
    message: 'Successfully signed out of all devices. All other active sessions have been terminated.',
  });
}

/**
 * Forgot Password:
 * Single-use reset link that expires in 30 minutes. Always shows the same confirmation message.
 */
export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  const uniformConfirmation = 'If an account exists with this email, a password reset link has been sent.';

  if (!email) {
    return res.json({ message: uniformConfirmation });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();

  if (user && user.status === 'active') {
    const rawResetToken = generateRandomToken(32);
    const tokenHash = hashToken(rawResetToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Invalidate previous resets
    await db('password_resets')
      .where({ user_id: user.id })
      .update({ used: true });

    await db('password_resets').insert({
      id: `pr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const resetLink = `${ENV.CLIENT_ORIGIN || 'http://localhost:5173'}/reset-password?token=${rawResetToken}`;

    // Background email dispatch
    setImmediate(async () => {
      try {
        await sendSystemNotification({
          eventType: 'PASSWORD_RESET',
          recipientEmail: user.email,
          recipientName: user.name,
          variables: {
            reset_link: resetLink,
          },
        });
      } catch (e) {
        console.warn('[ForgotPassword] Email send error:', e);
      }
    });
  }

  return res.json({ message: uniformConfirmation });
}

/**
 * Reset Password:
 * Verifies 30-minute token, updates password, signs out everywhere
 */
export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ message: 'Token and new password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ message: 'Password must contain at least one letter and one number' });
  }

  const tokenHash = hashToken(token);
  const resetRecord = await db('password_resets')
    .where({ token_hash: tokenHash, used: false })
    .first();

  if (!resetRecord) {
    return res.status(400).json({ message: 'Invalid or expired password reset link' });
  }

  if (new Date(resetRecord.expires_at) < new Date()) {
    await db('password_resets').where({ id: resetRecord.id }).update({ used: true });
    return res.status(400).json({ message: 'This password reset link has expired (links expire after 30 minutes)' });
  }

  const user = await db('users').where({ id: resetRecord.user_id }).first();
  if (!user || user.status !== 'active') {
    return res.status(400).json({ message: 'Account is inactive or not found' });
  }

  const newHash = await hashPassword(password);

  await db('users')
    .where({ id: user.id })
    .update({
      password_hash: newHash,
      must_change_password: false,
      failed_login_attempts: 0,
      locked_until: null,
      updated_at: new Date(),
    });

  await db('password_resets').where({ id: resetRecord.id }).update({ used: true });

  await revokeAllSessionsForUser(user.id);
  clearRefreshTokenCookie(res);

  return res.json({
    message: 'Password reset successfully. All active sessions have been terminated. Please sign in with your new password.',
  });
}

/**
 * Change Password (from Profile or first-login forced change)
 */
export async function changePassword(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ message: 'New password is required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return res.status(400).json({ message: 'Password must contain at least one letter and one number' });
  }

  const user = await db('users').where({ id: req.user.id }).first();
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // If user already has a password and is not forced to change, verify current password
  if (user.password_hash && !user.must_change_password) {
    if (!currentPassword) {
      return res.status(400).json({ message: 'Current password is required' });
    }
    const currentValid = await comparePassword(currentPassword, user.password_hash);
    if (!currentValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
  }

  const newHash = await hashPassword(newPassword);

  await db('users')
    .where({ id: user.id })
    .update({
      password_hash: newHash,
      must_change_password: false,
      token_version: (user.token_version || 1) + 1,
      updated_at: new Date(),
    });

  return res.json({ message: 'Password updated successfully' });
}

/**
 * Get Profile & Current User Details
 */
export async function getCurrentUser(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  const user = await db('users').where({ id: req.user.id }).first();
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  let pairedPaidInternName = null;
  if (user.paired_paid_intern_id) {
    const paired = await db('users').where({ id: user.paired_paid_intern_id }).first();
    pairedPaidInternName = paired?.name || null;
  }

  let teamName = null;
  if (user.team_id) {
    const team = await db('teams').where({ id: user.team_id }).first();
    teamName = team?.name || null;
  }

  return res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    internType: user.intern_type,
    pairedPaidInternId: user.paired_paid_intern_id,
    pairedPaidInternName,
    teamId: user.team_id,
    teamName,
    currentLevel: user.current_level,
    marksheetPercentage: user.marksheet_percentage,
    marksheetConfirmed: user.marksheet_confirmed,
    avatarUrl: user.avatar_url,
    emailNotificationsMuted: Boolean(user.email_notifications_muted),
    pushNotificationsMuted: Boolean(user.push_notifications_muted),
    mustChangePassword: Boolean(user.must_change_password),
    emailVerified: Boolean(user.email_verified),
    hasGoogleCalendar: Boolean(user.google_refresh_token_encrypted),
    icsToken: user.ics_token,
    createdAt: user.created_at,
  });
}

/**
 * Update Profile Settings (Name, Avatar, Mute Preferences)
 */
export async function updateProfile(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const { name, avatarUrl, emailNotificationsMuted, pushNotificationsMuted } = req.body;
  const updates: Record<string, any> = { updated_at: new Date() };

  if (typeof name === 'string' && name.trim().length >= 2) {
    updates.name = name.trim();
  }
  if (typeof avatarUrl === 'string') {
    updates.avatar_url = avatarUrl;
  }
  if (typeof emailNotificationsMuted === 'boolean') {
    updates.email_notifications_muted = emailNotificationsMuted;
  }
  if (typeof pushNotificationsMuted === 'boolean') {
    updates.push_notifications_muted = pushNotificationsMuted;
  }

  await db('users').where({ id: req.user.id }).update(updates);
  const updatedUser = await db('users').where({ id: req.user.id }).first();

  return res.json({
    message: 'Profile updated successfully',
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      internType: updatedUser.intern_type,
      avatarUrl: updatedUser.avatar_url,
      emailNotificationsMuted: Boolean(updatedUser.email_notifications_muted),
      pushNotificationsMuted: Boolean(updatedUser.push_notifications_muted),
      emailVerified: Boolean(updatedUser.email_verified),
    },
  });
}
