import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { UsersService } from './modules/users/users.service';
import { DatabaseService } from './app/database/database.service';
import { TenantsService } from './modules/tenants/tenants.service';
import { UserTenantsService } from './modules/user-tenants/user-tenants.service';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    // ObserveModule.forRoot({
    //   appKey: 'YOUR_APP_KEY',
    //   appSecret: 'YOUR_APP_SECRET',
    //   serviceId: 'colloquia-connector-api',
    // }),
  ],
  controllers: [],
  providers: [
    UsersService,
    DatabaseService,
    TenantsService,
    UserTenantsService,
  ],
})
export class AppModule {}
