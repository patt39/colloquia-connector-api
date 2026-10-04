/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import argon2 from 'argon2';
import { User } from '../../app/database/prisma';

export type GetUsersSelections = {
  tenantId?: string;
  userId?: User['id'];
};

export type GetOneUserSelections = {
  userId?: User['id'];
  email?: User['email'];
};

export type UpdateUserSelections = {
  userId: User['id'];
};

export type CreateUsersOptions = Partial<User>;
export type UpdateUsersOptions = Partial<User>;

export const checkIfPasswordMatch = async (
  userPassword: string,
  password: string,
): Promise<boolean> => {
  return await argon2.verify(String(userPassword), String(password));
};

export const hashPassword = async (password: string): Promise<string> => {
  return await argon2.hash(String(password), {
    type: argon2.argon2id,
    hashLength: 32,
    memoryCost: 2 ** 16,
    parallelism: 4,
  });
};

export const UserSelect = {
  createdAt: true,
  id: true,
  email: true,
  name: true,
  status: true,
  updatedAt: true,
};
