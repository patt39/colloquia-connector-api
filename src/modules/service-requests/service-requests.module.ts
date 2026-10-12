import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../app/database/database.module';
import { VtigerModule } from '../../integrations/vtiger/vtiger.module';
import { UsersModule } from '../users/users.module';
import { ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestsService } from './service-requests.service';

@Module({
  imports: [DatabaseModule, UsersModule, VtigerModule],
  controllers: [ServiceRequestsController],
  providers: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
