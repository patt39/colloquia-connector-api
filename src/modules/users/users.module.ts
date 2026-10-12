import { Module } from '@nestjs/common';
import { UsersAuthController } from './users.controller';
import { UsersService } from './users.service';
import { CheckUserService } from './middleware/check-user.service';
import { UserAuthStrategy } from './middleware';
import { DatabaseModule } from '../../app/database/database.module';
import { TenantsService } from '../tenants/tenants.service';
import { UserTenantsService } from '../user-tenants/user-tenants.service';
import { PortalInvitationsService } from './portal-invitations.service';
import { VtigerModule } from '../../integrations/vtiger/vtiger.module';
import { EmailService } from '../../integrations/email.service';
import { NodeMailerServiceAdapter } from '../../integrations/node-mailer-service-adapter';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    DatabaseModule,
    VtigerModule,
    ThrottlerModule.forRoot([{ ttl: 900000, limit: 5 }]),
  ],
  controllers: [UsersAuthController],
  providers: [
    UsersService,
    CheckUserService,
    UserAuthStrategy,
    TenantsService,
    UserTenantsService,
    PortalInvitationsService,
    EmailService,
    NodeMailerServiceAdapter,
  ],
})
export class UsersModule {}
