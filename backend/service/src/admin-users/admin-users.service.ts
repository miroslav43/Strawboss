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
  /** Exactly two words: Surname Firstname (e.g. "Maletici Miroslav"). */
  fullName: string;
  role: UserRole;
  phone?: string | null;
  /** Optional: admin can override the auto-generated username before submit. */
  usernameOverride?: string;
}

export interface UpdateUserDto {
  fullName?: string;
  role?: UserRole;
  phone?: string | null;
  isActive?: boolean;
  /** UUID of the machine to assign, or null to unassign. */
  assignedMachineId?: string | null;
  /** Admin can change the username (must be unique). */
  username?: string;
  /** Admin can change the 4-digit PIN (also updates Supabase Auth password). */
  pin?: string;
}

/** Maps each operator role to its compatible machine type. */
const ROLE_MACHINE_TYPE: Partial<Record<UserRole, MachineType>> = {
  loader_operator: MachineType.loader,
  baler_operator:  MachineType.baler,
  driver:          MachineType.truck,
};

/**
 * Supabase Auth enforces a minimum password length of 6 chars, but our PINs
 * are 4 digits. We deterministically pad the PIN before storing/verifying it
 * against Supabase Auth. Mobile + admin-web login helpers apply the same
 * transformation so the end-user only ever types 4 digits.
 *
 * Must stay in sync with:
 *  - apps/mobile/app/(auth)/login.tsx            → pinToAuthPassword
 *  - apps/admin-web/src/app/(auth)/login/page.tsx → pinToAuthPassword
 */
function pinToAuthPassword(pin: string): string {
  return `sb_${pin}`;
}

/** Shared SELECT projection for the users table. */
const USER_SELECT_COLS = sql`
  id, email, username, pin, phone, full_name AS "fullName",
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
    const { username, email, pin } = await this.generateCredentials(
      dto.fullName,
      dto.usernameOverride,
    );

    // 1. Create the auth account in Supabase Auth. The user types the raw PIN
    // but we pad it to satisfy Supabase's minimum-password-length policy.
    const { data, error } = await this.supabaseAdmin.auth.admin.createUser({
      email,
      password: pinToAuthPassword(pin),
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
      INSERT INTO users (id, email, username, pin, phone, full_name, role, is_active, locale)
      VALUES (
        ${authId}::uuid,
        ${email},
        ${username},
        ${pin},
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
      dto.assignedMachineId !== undefined ||
      dto.username !== undefined ||
      dto.pin !== undefined;

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

    // Check username uniqueness before update.
    if (dto.username !== undefined) {
      const existing = await this.drizzleProvider.db.execute(sql`
        SELECT id FROM users
        WHERE username = ${dto.username} AND id != ${id}::uuid
        LIMIT 1
      `);
      if ((existing as unknown as { id: string }[]).length) {
        throw new ConflictException('Username already taken');
      }
    }

    // Update Supabase Auth role if changed.
    if (dto.role) {
      const { error: roleError } = await this.supabaseAdmin.auth.admin.updateUserById(id, {
        app_metadata: { role: dto.role },
      });
      if (roleError) {
        throw new InternalServerErrorException(
          `Supabase Auth role update failed: ${roleError.message}`,
        );
      }
    }

    // Update Supabase Auth password if PIN changed. Use the padded form so
    // Supabase's 6-char minimum is satisfied (raw PIN stays in users.pin).
    if (dto.pin !== undefined) {
      const { error: pinError } = await this.supabaseAdmin.auth.admin.updateUserById(id, {
        password: pinToAuthPassword(dto.pin),
      });
      if (pinError) {
        throw new InternalServerErrorException(
          `Supabase Auth password update failed: ${pinError.message}`,
        );
      }
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
        username            = COALESCE(${dto.username ?? null}, username),
        pin                 = CASE WHEN ${dto.pin !== undefined} THEN ${dto.pin ?? null} ELSE pin END,
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

  /**
   * Resolve a username (or email) to an email address.
   * Used by the public /auth/resolve endpoint for username-based login.
   */
  async resolveLogin(login: string): Promise<string> {
    if (login.includes('@')) return login;

    const result = await this.drizzleProvider.db.execute(sql`
      SELECT email FROM users
      WHERE username = ${login} AND deleted_at IS NULL
      LIMIT 1
    `);
    const rows = result as unknown as { email: string }[];
    if (!rows.length) throw new NotFoundException('User not found');
    return rows[0].email;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async generateCredentials(
    fullName: string,
    usernameOverride?: string,
  ): Promise<{ username: string; email: string; pin: string }> {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) {
      throw new BadRequestException('fullName must be exactly 2 words: Surname Firstname');
    }
    const [rawSurname, rawFirstname] = parts;
    const surname   = this.slugify(rawSurname);
    const firstname = this.slugify(rawFirstname);

    const baseUsername = usernameOverride ?? (firstname[0] + surname);
    const baseEmail    = `${firstname}.${surname}@nortiauno.ro`;

    const username = await this.uniqueUsername(baseUsername);
    const email    = await this.uniqueEmail(baseEmail);
    const pin      = String(Math.floor(1000 + Math.random() * 9000));

    return { username, email, pin };
  }

  private slugify(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private async uniqueUsername(base: string): Promise<string> {
    let candidate = base;
    let n = 2;
    for (;;) {
      const rows = await this.drizzleProvider.db.execute(sql`
        SELECT 1 FROM users WHERE username = ${candidate} LIMIT 1
      `);
      if (!(rows as unknown as unknown[]).length) return candidate;
      candidate = base + n++;
    }
  }

  private async uniqueEmail(base: string): Promise<string> {
    const atIdx    = base.lastIndexOf('@');
    const local    = base.slice(0, atIdx);
    const domain   = base.slice(atIdx + 1);
    let candidate  = base;
    let n = 2;
    for (;;) {
      const rows = await this.drizzleProvider.db.execute(sql`
        SELECT 1 FROM users WHERE email = ${candidate} LIMIT 1
      `);
      if (!(rows as unknown as unknown[]).length) return candidate;
      candidate = `${local}${n++}@${domain}`;
    }
  }
}
