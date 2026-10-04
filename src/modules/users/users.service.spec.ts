import { UsersService } from './users.service';

describe('UsersService', () => {
  it('finds an active user by email', async () => {
    const user = { id: 'user-1', email: 'person@example.com' };
    const findFirst = vi.fn().mockResolvedValue(user);
    const service = new UsersService({
      user: { findFirst },
    } as never);

    await expect(service.findOneBy({ email: user.email })).resolves.toBe(user);
    expect(findFirst).toHaveBeenCalledWith({
      where: { email: user.email, deletedAt: null },
    });
  });
});
