import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';
import { DrizzleProvider } from '../database/drizzle.provider';
import type { User, UserRole } from '@strawboss/types';
import { MachineType } from '@strawboss/types';

export interface CreateUserDto {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  phone?: string | null;
}

export interface UpdateUserDto {
  fullName?: string;
  role?: UserRole;
  phone?: string | null;
  isActive?: boolean;
  /** UUID of the machine to assign, or null to unassign. */
  assignedMachineId?: string | null;
}

/** Maps each operator role to its compatible machine type. */
const ROLE_MACHINE_TYPE: Partial<Record<UserRole, MachineType>> = {
  loader_operator: MachineType.loader,
  baler_operator:  MachineType.baler,
  driver:          MachineType.truck,
};

/** Shared SELECT projection for the users table. */
const USER_SELECT_COLS = sql`
  id, email, phone, full_name AS "fullName",
  role, is_active AS "isActive", locale,
  avatar_url AS "avatarUrl",
  last_login_at AS "lastLoginAt",
  assigned_machine_id AS "assignedMachineId",
  created_at AS "createdAt", updated_at AS "updatedAt",
  deleted_at AS "deletedAt"
`;

@Injectable()
export class AdminUsersService {
  private readonly supabaseAdmin: SupabaseClient;

  constructor(
    private readonly drizzleProvider: DrizzleProvider,
    private readonly configService: ConfigService,
  ) {
    const url = this.configService.getOrThrow<string>('SUPABASE_URL');
    const serviceKey = this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.supabaseAdmin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async listUsers(): Promise<User[]> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT ${USER_SELECT_COLS}
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `);
    return result as unknown as User[];
  }

  async createUser(dto: CreateUserDto): Promise<User> {
    // 1. Create the auth account in Supabase Auth.
    const { data, error } = await this.supabaseAdmin.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
      app_metadata: { role: dto.role },
      user_metadata: { full_name: dto.fullName },
    });

    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        throw new ConflictException('A user with that email already exists');
      }
      throw new InternalServerErrorException(`Supabase Auth error: ${error.message}`);
    }

    const authId = data.user.id;

    // 2. Insert into public.users with the same UUID.
    const insertResult = await this.drizzleProvider.db.execute(sql`
      INSERT INTO users (id, email, phone, full_name, role, is_active, locale)
      VALUES (
        ${authId}::uuid,
        ${dto.email},
        ${dto.phone ?? null},
        ${dto.fullName},
        ${dto.role}::user_role,
        true,
        'ro'
      )
      RETURNING ${USER_SELECT_COLS}
    `);

    const rows = insertResult as unknown as User[];
    return rows[0];
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<User> {
    const hasChanges =
      dto.fullName !== undefined ||
      dto.role !== undefined ||
      dto.phone !== undefined ||
      dto.isActive !== undefined ||
      dto.assignedMachineId !== undefined;

    if (!hasChanges) return this.getById(id);

    // Validate machine assignment compatibility.
    if (dto.assignedMachineId) {
      const current = await this.getById(id);
      const effectiveRole: UserRole = dto.role ?? current.role;
      const requiredType = ROLE_MACHINE_TYPE[effectiveRole];

      if (requiredType) {
        const machineRows = await this.drizzleProvider.db.execute(sql`
          SELECT machine_type FROM machines
          WHERE id = ${dto.assignedMachineId}::uuid AND deleted_at IS NULL
          LIMIT 1
        `);
        const rows = machineRows as unknown as { machine_type: string }[];
        if (!rows.length) {
          throw new NotFoundException(`Machine ${dto.assignedMachineId} not found`);
        }
        if (rows[0].machine_type !== requiredType) {
          throw new BadRequestException(
            `Role "${effectiveRole}" requires a machine of type "${requiredType}", ` +
            `but the selected machine is of type "${rows[0].machine_type}".`,
          );
        }
      }
    }

    // Also update app_metadata role in Supabase Auth if role changed.
    if (dto.role) {
      await this.supabaseAdmin.auth.admin.updateUserById(id, {
        app_metadata: { role: dto.role },
      });
    }

    await this.drizzleProvider.db.execute(sql`
      UPDATE users SET
        full_name           = COALESCE(${dto.fullName ?? null}, full_name),
        role                = COALESCE(${dto.role ? sql`${dto.role}::user_role` : null}, role),
        phone               = CASE WHEN ${dto.phone !== undefined} THEN ${dto.phone ?? null} ELSE phone END,
        is_active           = COALESCE(${dto.isActive ?? null}, is_active),
        assigned_machine_id = CASE
                                WHEN ${dto.assignedMachineId !== undefined}
                                THEN ${dto.assignedMachineId ?? null}::uuid
                                ELSE assigned_machine_id
                              END,
        updated_at          = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
    `);

    return this.getById(id);
  }

  async deactivateUser(id: string): Promise<void> {
    const result = await this.drizzleProvider.db.execute(sql`
      UPDATE users SET is_active = false, deleted_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING id
    `);
    const rows = result as unknown as { id: string }[];
    if (!rows.length) throw new NotFoundException(`User ${id} not found`);

    await this.supabaseAdmin.auth.admin.deleteUser(id);
  }

  async getById(id: string): Promise<User> {
    const result = await this.drizzleProvider.db.execute(sql`
      SELECT ${USER_SELECT_COLS}
      FROM users WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1
    `);
    const rows = result as unknown as User[];
    if (!rows.length) throw new NotFoundException(`User ${id} not found`);
    return rows[0];
  }
}
