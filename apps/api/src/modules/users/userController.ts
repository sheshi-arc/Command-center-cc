import type { Request, Response } from 'express';
import { db } from '../../config/database.js';
import { USER_ROLES, INTERN_TYPES } from '@command-center/shared';
import { hashPassword } from '../../config/security.js';
import { revokeAllSessionsForUser } from '../../config/session.js';
import { sendSystemNotification } from '../automations/emailService.js';

export const MAX_ADMIN_LIMIT = 5;

export async function logAdminAction(params: {
  userId?: string;
  userName?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, any> | string;
  ipAddress?: string;
}) {
  try {
    await db('audit_logs').insert({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      user_id: params.userId || null,
      user_name: params.userName || null,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId || null,
      details: typeof params.details === 'object' ? JSON.stringify(params.details) : params.details || null,
      ip_address: params.ipAddress || null,
      created_at: new Date(),
    });
  } catch (err) {
    console.error('[AuditLog] Failed to log action:', err);
  }
}

import { getCached, setCached, deleteCached } from '../../config/redis.js';

export async function getAdminSummary(req: Request, res: Response) {
  const cacheKey = 'dashboard:admin_summary';
  const cached = await getCached<any>(cacheKey);
  if (cached) return res.json(cached);

  const admins = await db('users')
    .whereIn('role', [USER_ROLES.ADMIN, USER_ROLES.LEAD])
    .select('id', 'name', 'email', 'role', 'status', 'created_at as createdAt', 'joining_date as joiningDate');

  const activeAdminsCount = admins.length;
  const availablePositions = Math.max(0, MAX_ADMIN_LIMIT - activeAdminsCount);

  const primaryAdmin = admins.find((a) => a.role === USER_ROLES.ADMIN) || null;
  const coAdmin = admins.find((a) => a.role === USER_ROLES.LEAD) || null;

  const result = {
    maxAdmins: MAX_ADMIN_LIMIT,
    activeAdminsCount,
    availablePositions,
    primaryAdmin,
    coAdmin,
    admins,
  };

  await setCached(cacheKey, result, 60);
  return res.json(result);
}

export async function grantAdminRole(req: Request, res: Response) {
  const currentUser = req.user!;
  const { targetUserId, targetRole = USER_ROLES.LEAD } = req.body;

  // Authorization check
  if (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.LEAD) {
    return res.status(403).json({ message: 'Only an authorized administrator can grant administrator access.' });
  }

  if (targetRole !== USER_ROLES.ADMIN && targetRole !== USER_ROLES.LEAD) {
    return res.status(400).json({ message: 'Target role must be admin or co-admin (lead).' });
  }

  const adminCountRecord = await db('users')
    .whereIn('role', [USER_ROLES.ADMIN, USER_ROLES.LEAD])
    .count('id as count')
    .first();

  const currentAdminCount = Number(adminCountRecord?.count || 0);

  const targetUser = await db('users').where({ id: targetUserId }).first();
  if (!targetUser) {
    return res.status(404).json({ message: 'Target user not found.' });
  }

  const isAlreadyAdmin = targetUser.role === USER_ROLES.ADMIN || targetUser.role === USER_ROLES.LEAD;

  if (!isAlreadyAdmin && currentAdminCount >= MAX_ADMIN_LIMIT) {
    return res.status(400).json({
      message: `Maximum limit of ${MAX_ADMIN_LIMIT} administrator positions reached. Available positions: 0. Cannot assign additional administrators.`,
    });
  }

  await db('users').where({ id: targetUserId }).update({
    role: targetRole,
    updated_at: new Date(),
  });

  await deleteCached('dashboard:admin_summary');

  await logAdminAction({
    userId: currentUser.id,
    userName: currentUser.name,
    action: 'ADMIN_ACCESS_GRANTED',
    resourceType: 'USER',
    resourceId: targetUserId,
    details: {
      targetUserName: targetUser.name,
      targetEmail: targetUser.email,
      assignedRole: targetRole,
      previousRole: targetUser.role,
      activeAdminsAfter: isAlreadyAdmin ? currentAdminCount : currentAdminCount + 1,
      availablePositionsAfter: isAlreadyAdmin ? MAX_ADMIN_LIMIT - currentAdminCount : MAX_ADMIN_LIMIT - (currentAdminCount + 1),
    },
    ipAddress: req.ip,
  });

  return res.json({
    message: `Administrator access successfully granted to ${targetUser.name} as ${targetRole === USER_ROLES.ADMIN ? 'Primary Admin' : 'Co-Admin'}.`,
    user: {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      role: targetRole,
    },
  });
}

export async function getUsers(req: Request, res: Response) {
  const currentUser = req.user!;

  if (currentUser.role === USER_ROLES.UNPAID_INTERN) {
    // Unpaid intern: sees only their own work / record and their paired mentor & leaders
    const allowedUserIds = new Set<string>([currentUser.id]);
    if (currentUser.pairedPaidInternId) {
      allowedUserIds.add(currentUser.pairedPaidInternId);
    }
    const adminIds = await db('users').whereIn('role', [USER_ROLES.ADMIN, USER_ROLES.LEAD]).pluck('id');
    for (const id of adminIds) allowedUserIds.add(id);

    const users = await db('users as u')
      .leftJoin('users as p', 'u.paired_paid_intern_id', 'p.id')
      .whereIn('u.id', Array.from(allowedUserIds))
      .select(
        'u.id',
        'u.name',
        'u.email',
        'u.role',
        'u.intern_type as internType',
        'u.paired_paid_intern_id as pairedPaidInternId',
        'p.name as pairedPaidInternName',
        'u.current_level as currentLevel',
        'u.marksheet_percentage as marksheetPercentage',
        'u.marksheet_confirmed as marksheetConfirmed',
        'u.status',
        'u.joining_date as joiningDate',
        'u.phone',
        'u.created_at as createdAt'
      );

    return res.json(users);
  }

  let query = db('users as u')
    .leftJoin('users as p', 'u.paired_paid_intern_id', 'p.id')
    .select(
      'u.id',
      'u.name',
      'u.email',
      'u.role',
      'u.intern_type as internType',
      'u.paired_paid_intern_id as pairedPaidInternId',
      'p.name as pairedPaidInternName',
      'u.current_level as currentLevel',
      'u.marksheet_percentage as marksheetPercentage',
      'u.marksheet_confirmed as marksheetConfirmed',
      'u.status',
      'u.joining_date as joiningDate',
      'u.phone',
      'u.created_at as createdAt'
    );

  // Core Intern: views their own work, their team's work, and their unpaid interns' work
  if (currentUser.role === USER_ROLES.PAID_INTERN) {
    // Get teams that currentUser belongs to
    const myTeamIds = await db('team_members').where({ user_id: currentUser.id }).pluck('team_id');
    const myTeamMemberIds = await db('team_members').whereIn('team_id', myTeamIds).pluck('user_id');

    query = query.where((builder) => {
      builder
        .where('u.id', currentUser.id)
        .orWhere('u.paired_paid_intern_id', currentUser.id)
        .orWhereIn('u.id', myTeamMemberIds);
    });
  }

  const users = await query;

  // Real attendance percentage & tasks calculated from database rows
  const usersWithStats = await Promise.all(
    users.map(async (u) => {
      const records = await db('attendance').where({ user_id: u.id });
      const totalDays = records.length;
      const presentDays = records.filter(
        (r) => r.status === 'present' || r.status === 'late' || r.status === 'half_day'
      ).length;
      const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

      const team = await db('team_members as tm')
        .join('teams as t', 'tm.team_id', 't.id')
        .where('tm.user_id', u.id)
        .select('t.id as teamId', 't.name as teamName')
        .first();

      const assignedParts = await db('task_parts').where({ assigned_intern_id: u.id });
      const completedParts = assignedParts.filter((p) => p.status === 'done');

      return {
        ...u,
        teamId: team?.teamId || null,
        teamName: team?.teamName || (u.role === USER_ROLES.ADMIN || u.role === USER_ROLES.LEAD ? 'Central Office Administration' : 'Unassigned'),
        attendancePercentage: totalDays > 0 ? attendancePct : null,
        totalTasksAssigned: assignedParts.length,
        tasksCompleted: completedParts.length,
      };
    })
  );

  return res.json(usersWithStats);
}

export async function createUser(req: Request, res: Response) {
  const currentUser = req.user!;
  const {
    name,
    email,
    role = USER_ROLES.UNPAID_INTERN,
    internType,
    pairedPaidInternId,
    teamId,
    phone,
    joiningDate,
    password,
  } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required.' });
  }

  // Role permissions
  if (currentUser.role === USER_ROLES.UNPAID_INTERN) {
    return res.status(403).json({ message: 'Unpaid interns are not authorized to create users.' });
  }

  // Core intern can ONLY create unpaid interns (paired to them automatically)
  if (currentUser.role === USER_ROLES.PAID_INTERN) {
    if (role !== USER_ROLES.UNPAID_INTERN) {
      return res.status(403).json({
        message: 'Core interns may only create Unpaid Interns paired to them.',
      });
    }
  }

  // Check 5-admin limit if creating admin or lead
  if (role === USER_ROLES.ADMIN || role === USER_ROLES.LEAD) {
    if (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.LEAD) {
      return res.status(403).json({ message: 'Only administrators can create admin/lead accounts.' });
    }
    const adminCountRecord = await db('users')
      .whereIn('role', [USER_ROLES.ADMIN, USER_ROLES.LEAD])
      .count('id as count')
      .first();
    const count = Number(adminCountRecord?.count || 0);
    if (count >= MAX_ADMIN_LIMIT) {
      return res.status(400).json({
        message: `Maximum limit of ${MAX_ADMIN_LIMIT} administrators reached. Cannot create another administrator account.`,
      });
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();
  if (existing) {
    return res.status(409).json({ message: 'A user with this email address already exists.' });
  }

  // Password hash with bcrypt cost 12
  const passwordHash = await hashPassword(password || 'Password123!');
  const newId = `u-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  // Automatically pair unpaid intern to current core intern if caller is a core intern
  let assignedPairedId = pairedPaidInternId || null;
  if (currentUser.role === USER_ROLES.PAID_INTERN) {
    assignedPairedId = currentUser.id;
  }

  const resolvedInternType =
    role === USER_ROLES.PAID_INTERN
      ? INTERN_TYPES.PAID
      : role === USER_ROLES.UNPAID_INTERN
      ? INTERN_TYPES.UNPAID
      : internType || null;

  await db('users').insert({
    id: newId,
    name: name.trim(),
    email: normalizedEmail,
    password_hash: passwordHash,
    role,
    intern_type: resolvedInternType,
    paired_paid_intern_id: assignedPairedId,
    phone: phone || null,
    joining_date: joiningDate || new Date().toISOString().split('T')[0],
    current_level: 1,
    marksheet_percentage: null,
    marksheet_confirmed: false,
    status: 'active',
  });

  if (teamId) {
    await db('team_members').insert({
      id: `tm-${newId}`,
      team_id: teamId,
      user_id: newId,
    });
  }

  // 1. Welcome Email Automation: immediately to the assignee
  try {
    const roleDisplayName =
      role === USER_ROLES.ADMIN
        ? 'Central Office Admin'
        : role === USER_ROLES.LEAD
        ? 'Co-Admin / Team Lead'
        : role === USER_ROLES.PAID_INTERN
        ? 'Core Intern'
        : 'Unpaid Intern';

    await sendSystemNotification({
      ruleKey: 'welcome_email',
      recipientEmail: normalizedEmail,
      recipientName: name.trim(),
      recipientUserId: newId,
      variables: {
        recipient_role: roleDisplayName,
      },
    });
  } catch (err) {
    console.warn('[WelcomeEmail] Failed to dispatch welcome email:', err);
  }

  await logAdminAction({
    userId: currentUser.id,
    userName: currentUser.name,
    action: 'USER_CREATED',
    resourceType: 'USER',
    resourceId: newId,
    details: { name, email: normalizedEmail, role, pairedPaidInternId: assignedPairedId },
    ipAddress: req.ip,
  });

  return res.status(201).json({
    message: 'User created successfully',
    user: {
      id: newId,
      name: name.trim(),
      email: normalizedEmail,
      role,
      internType: resolvedInternType,
      pairedPaidInternId: assignedPairedId,
    },
  });
}

export async function createBulkInterns(req: Request, res: Response) {
  const currentUser = req.user!;
  const { emails, internType = INTERN_TYPES.UNPAID, paidInternId, teamId } = req.body;

  if (currentUser.role === USER_ROLES.PAID_INTERN && internType !== INTERN_TYPES.UNPAID) {
    return res.status(403).json({
      message: 'Core interns may only create unpaid interns.',
    });
  }

  const assignedPaidInternId =
    currentUser.role === USER_ROLES.PAID_INTERN ? currentUser.id : paidInternId || null;

  const createdUsers: any[] = [];
  const defaultPassword = await hashPassword('Password123!');

  for (const rawEmail of emails) {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    const existing = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();
    if (existing) continue;

    const usernamePart = normalizedEmail.split('@')[0];
    const name = usernamePart
      .split(/[._-]/)
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const newId = `u-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const role =
      internType === INTERN_TYPES.PAID ? USER_ROLES.PAID_INTERN : USER_ROLES.UNPAID_INTERN;

    await db('users').insert({
      id: newId,
      name,
      email: normalizedEmail,
      password_hash: defaultPassword,
      role,
      intern_type: internType,
      paired_paid_intern_id: internType === INTERN_TYPES.UNPAID ? assignedPaidInternId : null,
      current_level: 1,
      status: 'active',
    });

    if (teamId) {
      await db('team_members').insert({
        id: `tm-${newId}`,
        team_id: teamId,
        user_id: newId,
      });
    }

    sendSystemNotification({
      ruleKey: 'welcome_email',
      recipientEmail: normalizedEmail,
      recipientName: name,
      recipientUserId: newId,
      variables: {
        recipient_role: role === USER_ROLES.PAID_INTERN ? 'Core Intern' : 'Unpaid Intern',
      },
    }).catch(() => {});

    createdUsers.push({ id: newId, name, email: normalizedEmail, role, internType });
  }

  return res.status(201).json({
    message: `Created ${createdUsers.length} interns successfully`,
    users: createdUsers,
  });
}

export async function pairIntern(req: Request, res: Response) {
  const { unpaidInternId, paidInternId } = req.body;

  await db('users')
    .where({ id: unpaidInternId })
    .update({ paired_paid_intern_id: paidInternId });

  await logAdminAction({
    userId: req.user?.id,
    userName: req.user?.name,
    action: 'INTERN_PAIRED',
    resourceType: 'USER',
    resourceId: unpaidInternId,
    details: { pairedWith: paidInternId },
  });

  return res.json({ message: 'Intern paired successfully' });
}

export async function promoteIntern(req: Request, res: Response) {
  const currentUser = req.user!;
  const { internId, decision, notes } = req.body;

  // Strict check: Only Admin and Lead can review levels
  if (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.LEAD) {
    return res.status(403).json({
      message: 'Access Denied: Only Admin and Co-Admin may review or approve level progression.',
    });
  }

  if (internId === currentUser.id) {
    return res.status(400).json({
      message: 'Administrators cannot self-approve their own progression.',
    });
  }

  const intern = await db('users').where({ id: internId }).first();
  if (!intern) {
    return res.status(404).json({ message: 'Intern not found' });
  }

  const previousLevel = Number(intern.current_level || 1);
  const isApproved = decision === 'approve' || decision === 'pass';
  const newLevel = isApproved ? Math.min(previousLevel + 1, 15) : previousLevel;

  // Record Level Review
  const reviewId = `lrev-${Date.now()}`;
  await db('level_reviews').insert({
    id: reviewId,
    intern_id: internId,
    level_number: previousLevel,
    decision: isApproved ? 'passed' : 'repeat',
    notes: notes || (isApproved ? 'Approved for next level' : 'Level review deferred'),
    reviewed_by: currentUser.id,
    created_at: new Date(),
  });

  const updateFields: Record<string, any> = {
    current_level: newLevel,
    updated_at: new Date(),
  };

  // Promotion from Unpaid to Core Intern requires passing 15 levels AND Admin approval
  if (isApproved && previousLevel >= 15 && intern.role === USER_ROLES.UNPAID_INTERN) {
    if (currentUser.role !== USER_ROLES.ADMIN) {
      return res.status(403).json({
        message: 'Only an Admin can approve promotion from Unpaid Intern to Paid (Core) Intern after 15 levels.',
      });
    }
    updateFields.role = USER_ROLES.PAID_INTERN;
    updateFields.intern_type = INTERN_TYPES.PAID;
    updateFields.paired_paid_intern_id = null;
  }

  await db('users').where({ id: internId }).update(updateFields);

  return res.json({
    message: isApproved
      ? `Level ${previousLevel} passed successfully! Advanced to Level ${newLevel}.`
      : `Level ${previousLevel} marked to repeat.`,
    newLevel,
    promotedToCore: updateFields.role === USER_ROLES.PAID_INTERN,
  });
}

export async function updateUser(req: Request, res: Response) {
  const currentUser = req.user!;
  const { id } = req.params;
  const {
    name,
    email,
    phone,
    role,
    internType,
    teamId,
    pairedPaidInternId,
    joiningDate,
    currentLevel,
    marksheetPercentage,
    status,
  } = req.body;

  if (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.LEAD) {
    return res.status(403).json({ message: 'Only authorized administrators can modify member details.' });
  }

  const user = await db('users').where({ id }).first();
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (email && email !== user.email) {
    const existing = await db('users').where({ email }).whereNot({ id }).first();
    if (existing) {
      return res.status(400).json({ message: 'An account with this email address already exists.' });
    }
  }

  const updatePayload: Record<string, any> = {
    updated_at: new Date(),
  };

  if (name !== undefined) updatePayload.name = name;
  if (email !== undefined) updatePayload.email = email;
  if (phone !== undefined) updatePayload.phone = phone;
  if (role !== undefined) updatePayload.role = role;
  if (internType !== undefined) updatePayload.intern_type = internType;
  if (pairedPaidInternId !== undefined) updatePayload.paired_paid_intern_id = pairedPaidInternId;
  if (joiningDate !== undefined) updatePayload.joining_date = joiningDate;
  if (currentLevel !== undefined) updatePayload.current_level = currentLevel;
  if (marksheetPercentage !== undefined) updatePayload.marksheet_percentage = marksheetPercentage;
  if (status !== undefined) updatePayload.status = status;

  await db('users').where({ id }).update(updatePayload);

  // Update team if provided
  if (teamId !== undefined) {
    await db('team_members').where({ user_id: id }).del();
    if (teamId) {
      await db('team_members').insert({
        id: `tm-${id}-${Date.now()}`,
        team_id: teamId,
        user_id: id,
      });
    }
  }

  // A deactivated user is signed out at once
  if (status === 'inactive') {
    await revokeAllSessionsForUser(id);
  }

  return res.json({ message: 'Member updated successfully', user: { ...user, ...updatePayload } });
}

export async function getAuditLogs(req: Request, res: Response) {
  const logs = await db('audit_logs').orderBy('created_at', 'desc').limit(50);
  return res.json(logs);
}
