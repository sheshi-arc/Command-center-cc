import { Router } from 'express';
import {
  register,
  login,
  verifyEmail,
  resendVerification,
  googleSignIn,
  microsoftSignIn,
  getAuthConfig,
  getAppSettings,
  updateAppSettings,
  refreshToken,
  logout,
  signoutAllDevices,
  forgotPassword,
  resetPassword,
  getCurrentUser,
  updateProfile,
  changePassword,
} from './authController.js';
import { authenticateToken } from '../../middleware/authenticate.js';
import { validateBody } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authorize.js';
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
  USER_ROLES,
} from '@command-center/shared';
import { createRateLimiter } from '../../config/security.js';

const router = Router();

const loginLimiter = createRateLimiter({
  prefix: 'login',
  limit: 15,
  windowSeconds: 60,
  includeEmailFromBody: true,
});

const signupLimiter = createRateLimiter({
  prefix: 'signup',
  limit: 10,
  windowSeconds: 60,
  includeEmailFromBody: true,
});

const verifyLimiter = createRateLimiter({
  prefix: 'verify_email',
  limit: 20,
  windowSeconds: 60,
});

const resetLimiter = createRateLimiter({
  prefix: 'pwd_reset',
  limit: 10,
  windowSeconds: 60,
  includeEmailFromBody: true,
});

// Public authentication & onboarding endpoints
router.get('/config', getAuthConfig);
router.post('/login', loginLimiter, validateBody(loginSchema), login);
router.post('/register', signupLimiter, validateBody(registerSchema), register);
router.post('/signup', signupLimiter, validateBody(registerSchema), register);
router.get('/verify-email', verifyLimiter, verifyEmail);
router.post('/verify-email', verifyLimiter, verifyEmail);
router.post('/resend-verification', signupLimiter, resendVerification);

// OAuth Single Sign-On
router.post('/google-signin', loginLimiter, googleSignIn);
router.post('/microsoft-signin', loginLimiter, microsoftSignIn);

// Token refresh & password reset
router.post('/refresh', refreshToken);
router.post('/forgot-password', resetLimiter, validateBody(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', resetLimiter, validateBody(resetPasswordSchema), resetPassword);

// Session endpoints
router.post('/logout', logout);
router.post('/signout-all', authenticateToken, signoutAllDevices);

// User & Profile endpoints
router.get('/me', authenticateToken, getCurrentUser);
router.get('/profile', authenticateToken, getCurrentUser);
router.patch('/profile', authenticateToken, validateBody(updateProfileSchema), updateProfile);
router.post('/change-password', authenticateToken, validateBody(changePasswordSchema), changePassword);

// App settings for email verification requirement (admin/lead)
router.get('/settings', getAppSettings);
router.patch('/settings', authenticateToken, requireRole(USER_ROLES.ADMIN, USER_ROLES.LEAD), updateAppSettings);

export default router;
