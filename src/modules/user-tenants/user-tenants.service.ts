import { Injectable } from '@nestjs/common';
import {
  CreateUserTenantsOptions,
  GetOneUserTenantSelections,
  GetUserTenantsSelections,
  UserTenantsSelect,
} from './user-tenants.type';
import { DatabaseService } from '../../app/database/database.service';
import { FilterGroup } from '../../app/database/prisma';
import { Prisma, UserTenant } from '../../app/database/prisma';
@Injectable()
export class UserTenantsService {
  constructor(private readonly client: DatabaseService) {}

  async findAll(selections: GetUserTenantsSelections) {
    const prismaWhere: FilterGroup<Prisma.UserTenantWhereInput> = {
      deletedAt: null,
      AND: [],
    };

    const { userId, tenantId } = selections;

    if (userId) {
      Object.assign(prismaWhere, { userId });
    }

    if (tenantId) {
      Object.assign(prismaWhere, { tenantId });
    }

    const tenants = await this.client.userTenant.findMany({
      where: prismaWhere,
      select: UserTenantsSelect,
    });

    const rowCount = await this.client.userTenant.count({ where: prismaWhere });
    return { rowCount, tenants };
  }

  async findUsersByTenant(tenantId: string) {
    return this.client.userTenant.findMany({
      where: {
        tenantId,
        deletedAt: null,
        user: {
          deletedAt: null,
        },
      },
      select: {
        role: true,
        tenantId: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  /** Find one user tenant in database. */
  async findOneBy(selections: GetOneUserTenantSelections) {
    const prismaWhere = {} as Prisma.UserTenantWhereInput;

    const { userTenantId, userId, tenantId } = selections;

    if (userTenantId) {
      Object.assign(prismaWhere, { id: userTenantId });
    }

    const userTenant = await this.client.userTenant.findFirst({
      where: { ...prismaWhere, userId, tenantId, deletedAt: null },
    });

    return userTenant;
  }

  /** Create one user tenant in database. */
  async createOne(options: CreateUserTenantsOptions): Promise<UserTenant> {
    const { role, userId, tenantId } = options;

    const userTenant = this.client.userTenant.create({
      data: {
        userId,
        tenantId,
        ...(role ? { role } : {}),
      },
    });

    return userTenant;
  }

  /** Update one user tenant in database. */
  async updateOne(
    selections: GetOneUserTenantSelections,
    options: Partial<CreateUserTenantsOptions>,
  ): Promise<UserTenant> {
    const { userTenantId, userId, tenantId } = selections;
    const { role } = options;

    const prismaWhere = {} as Prisma.UserTenantWhereUniqueInput;

    if (userTenantId) {
      Object.assign(prismaWhere, { id: userTenantId });
    }

    if (userId && tenantId) {
      Object.assign(prismaWhere, { userId_tenantId: { userId, tenantId } });
    }

    const userTenant = this.client.userTenant.update({
      where: { id: userId },
      data: { role, tenantId, userId },
    });

    return userTenant;
  }
}
