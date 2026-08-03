import { Types } from 'mongoose';
import { z } from 'zod';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IGroup,
  IRole,
  IUser,
  IConfig,
  CreateUserRequest,
  AdminUserListItem,
  AdminUserSearchResult,
  UserDeleteResult,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

const MAX_SEARCH_LENGTH = 200;
const MAX_PASSWORD_LENGTH = 128;

const USER_LIST_FIELDS = '_id name username email avatar role provider createdAt updatedAt';

const usernamePattern = /^[\p{L}\p{N}_.@#$%&*()]+$/u;

export type AdminCreateUserInput = {
  name: string;
  username?: string;
  email: string;
  password: string;
  confirmPassword: string;
  role?: string;
  groupId?: string;
};

export type AdminCreateUserResponse = {
  user: AdminUserListItem;
  groupId?: string;
};

function createUserSchema(minPasswordLength: number) {
  return z
    .object({
      name: z.string().trim().min(3).max(80),
      username: z
        .string()
        .trim()
        .min(2)
        .max(80)
        .regex(usernamePattern, 'Invalid characters in username')
        .optional()
        .or(z.literal('')),
      email: z
        .string()
        .trim()
        .email()
        .max(120)
        .transform((value) => value.toLowerCase()),
      password: z
        .string()
        .min(minPasswordLength)
        .max(MAX_PASSWORD_LENGTH)
        .refine((value) => value.trim().length > 0, 'Password cannot be only spaces'),
      confirmPassword: z.string().max(MAX_PASSWORD_LENGTH),
      role: z.string().trim().min(1).max(500).default(SystemRoles.USER),
      groupId: z.string().trim().optional().or(z.literal('')),
    })
    .superRefine(({ password, confirmPassword, groupId }, ctx) => {
      if (password !== confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confirmPassword'],
          message: 'The passwords did not match',
        });
      }
      if (groupId && !isValidObjectIdString(groupId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['groupId'],
          message: 'Invalid group ID format',
        });
      }
    });
}

function mapAdminUser(user: IUser): AdminUserListItem {
  return {
    id: user._id?.toString() ?? '',
    name: user.name ?? '',
    username: user.username ?? '',
    email: user.email ?? '',
    avatar: user.avatar ?? '',
    role: user.role ?? SystemRoles.USER,
    provider: user.provider ?? 'local',
    createdAt: user.createdAt?.toISOString(),
    updatedAt: user.updatedAt?.toISOString(),
  };
}

export interface AdminUsersDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  countUsers: (filter?: FilterQuery<IUser>) => Promise<number>;
  findUser: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser | null>;
  createUser: (data: CreateUserRequest) => Promise<IUser>;
  hashPassword: (password: string) => Promise<string>;
  getRoleByName: (name: string, fields?: string | string[] | null) => Promise<IRole | null>;
  findGroupById: (
    groupId: string | Types.ObjectId,
    projection?: Record<string, 0 | 1>,
  ) => Promise<IGroup | null>;
  addUserToGroup: (
    userId: string | Types.ObjectId,
    groupId: string | Types.ObjectId,
  ) => Promise<{ user: IUser; group: IGroup | null }>;
  minPasswordLength: number;
  /**
   * Thin data-layer delete — removes the User document only.
   * Full cascade of user-owned resources (conversations, messages, files, tokens, etc.)
   * is handled by `UserController.deleteUserController` in the self-delete flow.
   * This admin endpoint currently cascades Config and AclEntries.
   * A future iteration should consolidate the full cascade into a shared service function.
   */
  deleteUserById: (userId: string) => Promise<UserDeleteResult>;
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
}

export function createAdminUsersHandlers(deps: AdminUsersDeps): {
  createUser: (req: ServerRequest, res: Response) => Promise<Response>;
  listUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  searchUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteUser: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findUsers,
    countUsers,
    findUser,
    createUser,
    hashPassword,
    getRoleByName,
    findGroupById,
    addUserToGroup,
    minPasswordLength,
    deleteUserById,
    deleteConfig,
    deleteAclEntries,
  } = deps;

  async function createUserHandler(req: ServerRequest, res: Response) {
    const parsed = createUserSchema(minPasswordLength).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid user details',
        error_code: 'INVALID_INPUT',
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const { name, email, password, role, groupId } = parsed.data;
    const username = parsed.data.username || '';
    if (role === SystemRoles.ADMIN) {
      return res.status(403).json({
        error: 'System administrators cannot be created from this form',
        error_code: 'ADMIN_ROLE_FORBIDDEN',
      });
    }

    let createdUserId: string | undefined;
    try {
      const existingUser = await findUser({ email }, '_id');
      if (existingUser) {
        return res.status(409).json({
          error: 'A user with this email already exists',
          error_code: 'EMAIL_EXISTS',
        });
      }

      if (role !== SystemRoles.USER) {
        const selectedRole = await getRoleByName(role, '_id name');
        if (!selectedRole) {
          return res.status(404).json({ error: 'Role not found', error_code: 'ROLE_NOT_FOUND' });
        }
      }

      if (groupId) {
        const selectedGroup = await findGroupById(groupId, { _id: 1 });
        if (!selectedGroup) {
          return res
            .status(404)
            .json({ error: 'Department not found', error_code: 'GROUP_NOT_FOUND' });
        }
      }

      const hashedPassword = await hashPassword(password);
      const user = await createUser({
        name,
        username,
        email,
        password: hashedPassword,
        provider: 'local',
        emailVerified: true,
        role,
      });
      createdUserId = user._id.toString();

      if (groupId) {
        const result = await addUserToGroup(createdUserId, groupId);
        if (!result.group) {
          throw new Error('Selected department disappeared during account creation');
        }
      }

      logger.info('[adminUsers] User created by administrator', {
        actorId: req.user?._id?.toString() ?? req.user?.id,
        userId: createdUserId,
        role,
        groupId: groupId || undefined,
      });
      const response: AdminCreateUserResponse = {
        user: mapAdminUser(user),
        ...(groupId ? { groupId } : {}),
      };
      return res.status(201).json(response);
    } catch (error) {
      if (createdUserId) {
        try {
          await deleteUserById(createdUserId);
        } catch (rollbackError) {
          logger.error('[adminUsers] Failed to roll back partially-created user', {
            userId: createdUserId,
            rollbackError,
          });
        }
      }

      const databaseError = error as { code?: number; name?: string };
      if (databaseError.code === 11000) {
        return res.status(409).json({
          error: 'A user with this email already exists',
          error_code: 'EMAIL_EXISTS',
        });
      }
      logger.error('[adminUsers] createUser error:', error);
      return res.status(500).json({ error: 'Failed to create user', error_code: 'CREATE_FAILED' });
    }
  }

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const [users, total] = await Promise.all([
        findUsers({}, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } }),
        countUsers(),
      ]);

      const mapped: AdminUserListItem[] = users.map(mapAdminUser);

      return res.status(200).json({ users: mapped, total, limit, offset });
    } catch (error) {
      logger.error('[adminUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function searchUsersHandler(req: ServerRequest, res: Response) {
    try {
      const rawQ = req.query.q;
      const rawLimit = req.query.limit;
      const query = typeof rawQ === 'string' ? rawQ : undefined;
      const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
      const trimmed = query?.trim() ?? '';

      if (!trimmed) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
      }

      if (trimmed.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      if (trimmed.length > MAX_SEARCH_LENGTH) {
        return res
          .status(400)
          .json({ error: `Query must not exceed ${MAX_SEARCH_LENGTH} characters` });
      }

      const searchLimit = Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 50);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}`, 'i');

      const users = await findUsers(
        { $or: [{ name: regex }, { email: regex }, { username: regex }] },
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      );

      const results: AdminUserSearchResult[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        email: u.email ?? '',
        username: u.username,
        avatarUrl: u.avatar,
      }));

      return res
        .status(200)
        .json({ users: results, total: results.length, capped: results.length >= searchLimit });
    } catch (error) {
      logger.error('[adminUsers] searchUsers error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }

  async function deleteUserHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }

      const [targetUser] = await findUsers({ _id: id }, 'role', { limit: 1 });
      if (targetUser?.role === SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }
      }

      const result = await deleteUserById(id);

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser?.role === SystemRoles.ADMIN) {
        const remaining = await countUsers({ role: SystemRoles.ADMIN });
        if (remaining === 0) {
          logger.error(
            `[adminUsers] CRITICAL: last admin deleted via race condition, user: ${id}. ` +
              'Manual DB intervention required to restore an ADMIN user.',
          );
        }
      }

      const objectId = new Types.ObjectId(id);
      const cleanupResults = await Promise.allSettled([
        deleteConfig(PrincipalType.USER, id),
        deleteAclEntries({ principalType: PrincipalType.USER, principalId: objectId }),
      ]);
      for (const r of cleanupResults) {
        if (r.status === 'rejected') {
          logger.error('[adminUsers] cascade cleanup failed for user:', id, r.reason);
        }
      }

      return res.status(200).json({ message: result.message || 'User deleted successfully' });
    } catch (error) {
      logger.error('[adminUsers] deleteUser error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  return {
    createUser: createUserHandler,
    listUsers: listUsersHandler,
    searchUsers: searchUsersHandler,
    deleteUser: deleteUserHandler,
  };
}
