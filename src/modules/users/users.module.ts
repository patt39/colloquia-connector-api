import { Module } from '@nestjs/common';
import { UsersAuthController } from './users.controller';
import { UsersService } from './users.service';
import { CheckUserService } from './middleware/check-user.service';
import { UserAuthStrategy } from './middleware';

@Module({
  controllers: [UsersAuthController],
  providers: [UsersService, CheckUserService, UserAuthStrategy],
})
export class UsersModule {}
