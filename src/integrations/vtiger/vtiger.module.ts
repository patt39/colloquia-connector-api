import { Module } from '@nestjs/common';
import { config } from '../../app/config';
import { VTIGER_CONFIG, VtigerService } from './vtiger.service';

@Module({
  providers: [
    {
      provide: VTIGER_CONFIG,
      useValue: config.connector_access.vTiger,
    },
    VtigerService,
  ],
  exports: [VtigerService],
})
export class VtigerModule {}
