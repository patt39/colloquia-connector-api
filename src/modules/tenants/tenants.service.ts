import { Injectable } from '@nestjs/common';
import {
  CreateTenantsOptions,
  GetOneTenantSelections,
  TenantSelect,
  UpdateTenantSelections,
  UpdateTenantsOptions,
} from './tenants.type';
import { DatabaseService } from '../../app/database/database.service';
import { FilterGroup, Prisma, Tenant } from '../../app/database/prisma';
@Injectable()
export class TenantsService {
  constructor(private readonly client: DatabaseService) {}

  async findAll() {
    const prismaWhere: FilterGroup<Prisma.TenantWhereInput> = {
      deletedAt: null,
      AND: [],
    };

    const tenants = await this.client.tenant.findMany({
      where: prismaWhere,
      select: TenantSelect,
    });

    const rowCount = await this.client.tenant.count({ where: prismaWhere });
    return { rowCount, tenants };
  }

  /** Find one tenant in database. */
  async findOneBy(selections: GetOneTenantSelections) {
    const prismaWhere = {} as Prisma.TenantWhereInput;

    const { tenantId } = selections;

    if (tenantId) {
      Object.assign(prismaWhere, { id: tenantId });
    }

    const tenant = await this.client.tenant.findFirst({
      where: { ...prismaWhere, deletedAt: null },
    });

    return tenant;
  }

  /** Create one tenant in database. */
  async createOne(options: CreateTenantsOptions): Promise<Tenant> {
    const { name } = options;

    const tenant = this.client.tenant.create({
      data: {
        name,
      },
    });

    return tenant;
  }

  /** Update one tenant in database. */
  async updateOne(
    selections: UpdateTenantSelections,
    options: UpdateTenantsOptions,
  ): Promise<Tenant> {
    const { tenantId } = selections;
    const { name, deletedAt } = options;

    const tenant = this.client.tenant.update({
      where: { id: tenantId },
      data: { name, deletedAt },
    });

    return tenant;
  }
}
