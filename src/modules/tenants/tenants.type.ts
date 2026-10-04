import { Tenant } from '../../app/database/prisma';
export type GetTenantsSelections = {
  organizationId?: string;
};

export type GetOneTenantSelections = {
  tenantId?: Tenant['id'];
};

export type UpdateTenantSelections = {
  tenantId: Tenant['id'];
};

export type CreateTenantsOptions = Partial<Tenant>;

export type UpdateTenantsOptions = Partial<Tenant>;

export const TenantSelect = {
  deletedAt: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
  id: true,
  name: true,
  plan: true,
  status: true,
};
