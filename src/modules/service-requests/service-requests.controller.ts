import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { UserAuthGuard } from '../users/middleware';
import type {
  RequestActor,
  UploadedTranslationFile,
} from './service-requests.service';
import { ServiceRequestsService } from './service-requests.service';
import { CreateServiceRequestDto } from './service-requests.dto';

type AuthenticatedRequest = Request & { user: RequestActor };

@Controller('service-requests')
@UseGuards(UserAuthGuard)
export class ServiceRequestsController {
  constructor(private readonly serviceRequests: ServiceRequestsService) {}

  @Get('services')
  listAvailableServices() {
    return this.serviceRequests.listAvailableServices();
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateServiceRequestDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.serviceRequests.create(request.user, body, idempotencyKey);
  }

  @Get()
  listMine(@Req() request: AuthenticatedRequest) {
    return this.serviceRequests.listMine(request.user);
  }

  @Get(':requestId')
  getOne(
    @Req() request: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.serviceRequests.getOne(request.user, requestId);
  }

  @Post(':requestId/submit')
  submit(
    @Req() request: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.serviceRequests.submit(request.user, requestId);
  }

  @Post(':requestId/sync')
  retryCrmSync(
    @Req() request: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.serviceRequests.retryCrmSync(request.user, requestId);
  }

  @Post(':requestId/refresh-status')
  refreshCrmStatus(
    @Req() request: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.serviceRequests.refreshCrmStatus(request.user, requestId);
  }

  @Post(':requestId/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    }),
  )
  uploadDocument(
    @Req() request: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @UploadedFile() file: UploadedTranslationFile,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.serviceRequests.uploadDocument(
      request.user,
      requestId,
      file,
      idempotencyKey,
    );
  }
}
