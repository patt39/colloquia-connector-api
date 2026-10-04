import { UserTenant } from '../../app/database/prisma';

export type GetUserTenantsSelections = {
  userId?: string;
  tenantId?: string;
};

export type GetOneUserTenantSelections = {
  userTenantId?: UserTenant['id'];
  userId?: UserTenant['userId'];
  tenantId?: UserTenant['tenantId'];
};

export type UpdateUserTenantSelections = {
  userTenantId: UserTenant['id'];
};

export type CreateUserTenantsOptions = {
  userId: UserTenant['userId'];
  tenantId: UserTenant['tenantId'];
  role?: UserTenant['role'];
};

export type UpdateUserTenantsOptions = Partial<UserTenant>;

export const UserTenantsSelect = {
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  id: true,
  role: true,
  userId: true,
  tenantId: true,
  user: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  tenant: {
    select: {
      id: true,
      name: true,
      plan: true,
      status: true,
    },
  },
};
