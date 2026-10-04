import { Injectable } from '@nestjs/common';
import {
  CreateUsersOptions,
  GetOneUserSelections,
  GetUsersSelections,
  UpdateUserSelections,
  UpdateUsersOptions,
  UserSelect,
} from './users.type';
import { DatabaseService } from '../../app/database/database.service';
import { FilterGroup, Prisma, User } from '../../app/database/prisma';

@Injectable()
export class UsersService {
  constructor(private readonly client: DatabaseService) {}

  async findAll(selections: GetUsersSelections) {
    const prismaWhere: FilterGroup<Prisma.UserWhereInput> = {
      deletedAt: null,
      AND: [],
    };

    const { tenantId, userId } = selections;

    if (tenantId) {
      Object.assign(prismaWhere, { tenantId });
    }

    if (userId) {
      Object.assign(prismaWhere, { id: userId });
    }

    const users = await this.client.user.findMany({
      where: prismaWhere,
      select: UserSelect,
    });

    const rowCount = await this.client.user.count({ where: prismaWhere });
    return { rowCount, users };
  }

  /** Find one user in database. */
  async findOneBy(selections: GetOneUserSelections) {
    const prismaWhere = {} as Prisma.UserWhereInput;

    const { userId, email } = selections;

    if (userId) {
      Object.assign(prismaWhere, { id: userId });
    }

    if (email) {
      Object.assign(prismaWhere, { email });
    }
    const user = await this.client.user.findFirst({
      where: { ...prismaWhere, deletedAt: null },
    });

    return user;
  }

  /** Find one User in  database. */
  async findMe(selections: GetOneUserSelections) {
    const prismaWhereUser = {} as Prisma.UserWhereInput;
    const { userId } = selections;

    if (userId) {
      Object.assign(prismaWhereUser, { id: userId });
    }

    const user = await this.client.user.findFirst({
      where: { ...prismaWhereUser, deletedAt: null },
      select: UserSelect,
    });

    return user;
  }

  /** Create one user in database. */
  async createOne(options: CreateUsersOptions): Promise<User> {
    const { username, email, password, tenantId } = options;

    const user = this.client.user.create({
      data: {
        username,
        email,
        password,
        tenantId,
      },
    });

    return user;
  }

  /** Update one user in database. */
  async updateOne(
    selections: UpdateUserSelections,
    options: UpdateUsersOptions,
  ): Promise<User> {
    const { userId } = selections;
    const { username, email, password, tenantId } = options;
    const user = this.client.user.update({
      where: { id: userId },
      data: { username, email, password, tenantId },
    });

    return user;
  }
}
