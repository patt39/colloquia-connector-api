import { Module } from '@nestjs/common';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), ServiceRequestsModule],
})
export class AppModule {}
