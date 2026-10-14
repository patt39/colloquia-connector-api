import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import {
  Prisma,
  ServiceCategory,
  ServiceRequestStatus,
} from '../../app/database/prisma';
import { DatabaseService } from '../../app/database/database.service';
import { VtigerService } from '../../integrations/vtiger/vtiger.service';
import { CreateServiceRequestDto } from './service-requests.dto';

export interface RequestActor {
  id: string;
  tenantId: string;
  email: string;
  username: string;
}

export interface UploadedTranslationFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface VtigerFieldDescription {
  name: string;
  type?: {
    picklistValues?: Array<{ label: string; value: string }>;
  };
}

interface VtigerModuleDescription {
  fields?: VtigerFieldDescription[];
}

interface VtigerRequestTarget {
  module: 'vtcmtraduzioni' | 'vtcmfacetoface';
  titleField: string;
  statusField: string;
}

const AVAILABLE_SERVICE_CATEGORIES = [
  ServiceCategory.DOCUMENTS_TRADUCTION,
  ServiceCategory.FACE2FACE_VIDEO,
  ServiceCategory.FACE2FACE_PHYSICAL,
  ServiceCategory.PHONE_CALL,
] as const;
const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
const MAX_DOCUMENTS_PER_REQUEST = 10;
const ALLOWED_DOCUMENT_TYPES: Record<string, string[]> = {
  '.doc': ['application/msword', 'application/octet-stream'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ],
  '.odt': [
    'application/vnd.oasis.opendocument.text',
    'application/octet-stream',
  ],
  '.pdf': ['application/pdf', 'application/octet-stream'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.rtf': ['application/rtf', 'text/rtf', 'application/octet-stream'],
  '.txt': ['text/plain', 'application/octet-stream'],
};

@Injectable()
export class ServiceRequestsService {
  private readonly moduleDescriptions = new Map<
    string,
    Promise<Map<string, VtigerFieldDescription>>
  >();

  constructor(
    private readonly database: DatabaseService,
    private readonly vtiger: VtigerService,
  ) {}

  async listAvailableServices() {
    return Promise.all(
      AVAILABLE_SERVICE_CATEGORIES.filter(
        (serviceCategory) => serviceCategory !== ServiceCategory.PHONE_CALL,
      ).map(async (serviceCategory) => ({
        serviceCategory,
        available: true,
        formOptions: await this.getFormOptions(serviceCategory),
      })),
    );
  }

  private getVtigerTarget(
    serviceCategory: ServiceCategory,
  ): VtigerRequestTarget {
    if (serviceCategory === ServiceCategory.DOCUMENTS_TRADUCTION) {
      return {
        module: 'vtcmtraduzioni',
        titleField: 'fld_vtcmtraduzioniname',
        statusField: 'fld_stato_2337',
      };
    }
    if (
      serviceCategory === ServiceCategory.FACE2FACE_VIDEO ||
      serviceCategory === ServiceCategory.FACE2FACE_PHYSICAL
    ) {
      return {
        module: 'vtcmfacetoface',
        titleField: 'fld_vtcmfacetofacename',
        statusField: 'cf_vtcmfacetoface_stato',
      };
    }
    throw new BadRequestException(
      'This service category is not mapped to a vTiger request module.',
    );
  }

  private async getFormOptions(serviceCategory: ServiceCategory) {
    const target = this.getVtigerTarget(serviceCategory);
    if (serviceCategory === ServiceCategory.DOCUMENTS_TRADUCTION) {
      const fields = await this.getModuleFields(target.module);
      return {
        sourceLanguages: this.getPicklistValues(
          fields,
          'fld_linguasource_2339',
        ),
        targetLanguages: this.getPicklistValues(
          fields,
          'fld_linguatarget_2341',
        ),
        subjects: this.getPicklistValues(fields, 'fld_argomento_2343'),
        quantityUnits: this.getPicklistValues(
          fields,
          'cf_vtcmtraduzioni_quantitespressain',
        ),
        deliveryOptions: this.getPicklistValues(
          fields,
          'fld_consegnagarantita_2345',
        ),
      };
    }

    const fields = await this.getModuleFields(target.module);
    return {
      requestType:
        serviceCategory === ServiceCategory.FACE2FACE_PHYSICAL
          ? 'FACE TO FACE'
          : 'VIDEO COMUNICAZIONE',
      languages: this.getPicklistValues(fields, 'fld_linguarichiesta_2383'),
    };
  }

  private async getModuleFields(
    module: VtigerRequestTarget['module'],
  ): Promise<Map<string, VtigerFieldDescription>> {
    let description = this.moduleDescriptions.get(module);
    if (!description) {
      description = this.vtiger
        .describe<VtigerModuleDescription>(module)
        .then((result) => {
          const fields = new Map(
            (result.fields ?? []).map((field) => [field.name, field]),
          );
          if (fields.size === 0) {
            throw new Error(`vTiger returned no fields for ${module}.`);
          }
          return fields;
        });
      this.moduleDescriptions.set(module, description);
      description.catch(() => this.moduleDescriptions.delete(module));
    }
    return description;
  }

  private getPicklistValues(
    fields: Map<string, VtigerFieldDescription>,
    fieldName: string,
  ): string[] {
    const field = fields.get(fieldName);
    if (!field) throw new Error(`vTiger field ${fieldName} was not described.`);
    return (field.type?.picklistValues ?? []).map((option) => option.value);
  }

  private mapCrmStatus(
    serviceCategory: ServiceCategory,
    crmStatus?: string,
  ): ServiceRequestStatus | undefined {
    if (!crmStatus) return undefined;
    const status = crmStatus.trim().toLocaleUpperCase();

    if (serviceCategory === ServiceCategory.DOCUMENTS_TRADUCTION) {
      const translationStatuses: Record<string, ServiceRequestStatus> = {
        NUOVO: 'SUBMITTED',
        PENDING: 'SUBMITTED',
        OFFERTA: 'QUOTED',
        'ASSEGNATO A MEDIATORE': 'IN_REVIEW',
        'IN LAVORAZIONE': 'IN_PROGRESS',
        CHIUSO: 'COMPLETED',
      };
      return translationStatuses[status];
    }

    const interpretingStatuses: Record<string, ServiceRequestStatus> = {
      NUOVO: 'SUBMITTED',
      'ASSEGNATO A MEDIATORE': 'IN_REVIEW',
      'IN LAVORAZIONE': 'IN_PROGRESS',
      CHIUSO: 'COMPLETED',
      ANNULLATO: 'CANCELLED',
    };
    return interpretingStatuses[status];
  }

  private getCrmTitle(requestId: string, title: string): string {
    const prefix = `VOX ${requestId} `;
    return `${prefix}${title}`.slice(0, 100);
  }

  private async buildVtigerRequestFields(
    request: {
      serviceCategory: ServiceCategory;
      sourceLanguage: string | null;
      targetLanguage: string | null;
      requestedFor: Date | null;
      createdAt: Date;
      details: Prisma.JsonValue | null;
      user: { email: string };
    },
    target: VtigerRequestTarget,
    title: string,
    accountId: string,
    contactId: string,
    assignedUserId: string,
  ): Promise<Record<string, unknown>> {
    const details = this.asDetails(request.details);
    const fields: Record<string, unknown> = {
      [target.titleField]: title,
      assigned_user_id: assignedUserId,
      [target.statusField]: 'NUOVO',
    };

    if (request.serviceCategory === ServiceCategory.DOCUMENTS_TRADUCTION) {
      fields.cf_vtcmtraduzioni_azienda = 'VOX GENTIUM';
      fields.cf_vtcmtraduzioni_cliente = accountId;
      fields.cf_vtcmtraduzioni_riferimentorichiedente = request.user.email;
      fields.cf_vtcmtraduzioni_datadirichiesta = this.formatCrmDate(
        request.createdAt,
      );
      fields.fld_linguasource_2339 = await this.resolvePicklistValue(
        target.module,
        'fld_linguasource_2339',
        request.sourceLanguage,
      );
      fields.fld_linguatarget_2341 = await this.resolvePicklistValue(
        target.module,
        'fld_linguatarget_2341',
        request.targetLanguage,
      );

      const quantity = details.quantity;
      if (typeof quantity === 'number' && Number.isFinite(quantity)) {
        fields.fld_ndiparole = quantity;
      }
      fields.fld_argomento_2343 = await this.resolveOptionalPicklistValue(
        target.module,
        'fld_argomento_2343',
        details.subject,
      );
      fields.cf_vtcmtraduzioni_quantitespressain =
        await this.resolveOptionalPicklistValue(
          target.module,
          'cf_vtcmtraduzioni_quantitespressain',
          details.quantityUnit,
        );
      fields.fld_consegnagarantita_2345 =
        await this.resolveOptionalPicklistValue(
          target.module,
          'fld_consegnagarantita_2345',
          details.deliveryOption,
        );
      return this.withoutUndefined(fields);
    }

    fields.cf_vtcmfacetoface_azienda = 'VOX GENTIUM';
    fields.cf_vtcmfacetoface_tiporichiesta =
      request.serviceCategory === ServiceCategory.FACE2FACE_PHYSICAL
        ? 'FACE TO FACE'
        : 'VIDEO COMUNICAZIONE';
    fields.cf_vtcmfacetoface_cliente = accountId;
    fields.cf_vtcmfacetoface_contacts = contactId;
    fields.fld_linguarichiesta_2383 = await this.resolvePicklistValue(
      target.module,
      'fld_linguarichiesta_2383',
      request.sourceLanguage || request.targetLanguage,
    );
    if (request.requestedFor) {
      fields.fld_datapresenzamlc = this.formatCrmDate(request.requestedFor);
    }
    fields.fld_indirizzo = details.location;
    fields.fld_struttura = details.structure;
    fields.fld_uo = details.unit;
    fields.fld_buildingpiano = details.buildingFloor;
    fields.fld_centrodicosto = details.costCenter;
    fields.fld_telefonodiriferimento = details.phone;
    fields.fld_mailreparto = details.departmentEmail;
    fields.fld_afavoredelpaziente = details.patientName;
    fields.fld_orainiziomlc = details.startTime;
    fields.fld_orafinemlc = details.endTime;
    fields.fld_motivazionecirconstanziatadellarichiesta =
      this.detailsText(details);
    fields.fld_noteaggiuntivemediazione = this.detailsText(details);
    return this.withoutUndefined(fields);
  }

  private async resolveOptionalPicklistValue(
    module: VtigerRequestTarget['module'],
    fieldName: string,
    value: unknown,
  ): Promise<string | undefined> {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return this.resolvePicklistValue(module, fieldName, value);
  }

  private async resolvePicklistValue(
    module: VtigerRequestTarget['module'],
    fieldName: string,
    value: string | null,
  ): Promise<string> {
    if (!value?.trim()) {
      throw new BadRequestException(`${fieldName} is required.`);
    }
    const fields = await this.getModuleFields(module);
    const accepted = this.getPicklistValues(fields, fieldName);
    const match = accepted.find(
      (option) =>
        option.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
    );
    if (!match) {
      throw new BadRequestException(
        `Unsupported value for ${fieldName}. Use one of the options returned by GET /service-requests/services.`,
      );
    }
    return match;
  }

  private asDetails(value: Prisma.JsonValue | null): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private detailsText(details: Record<string, unknown>): string | undefined {
    const value = details.notes ?? details.reason;
    if (typeof value === 'string' && value.trim()) return value.trim();
    return undefined;
  }

  private withoutUndefined(
    fields: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
  }

  private formatCrmDate(date: Date): string {
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${day}-${month}-${date.getUTCFullYear()}`;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryPendingCrmSyncs(): Promise<void> {
    const retryAfter = new Date(Date.now() - 60 * 1000);
    const pending = await this.database.serviceRequest.findMany({
      where: {
        status: { not: 'DRAFT' },
        crmSyncStatus: { in: ['PENDING', 'FAILED'] },
        syncAttempts: { lt: 8 },
        updatedAt: { lt: retryAfter },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    for (const request of pending) {
      await this.syncToVtiger(request.id);
    }
  }

  async create(
    actor: RequestActor,
    dto: CreateServiceRequestDto,
    rawIdempotencyKey?: string,
  ) {
    if (dto.serviceCategory === ServiceCategory.PHONE_CALL) {
      throw new BadRequestException(
        'Telephone interpreting is not yet mapped to a vTiger request module.',
      );
    }
    if (
      dto.serviceCategory === ServiceCategory.DOCUMENTS_TRADUCTION &&
      (!dto.sourceLanguage?.trim() || !dto.targetLanguage?.trim())
    ) {
      throw new BadRequestException(
        'Source and target languages are required for document translation.',
      );
    }
    if (
      dto.serviceCategory !== ServiceCategory.DOCUMENTS_TRADUCTION &&
      !dto.sourceLanguage?.trim() &&
      !dto.targetLanguage?.trim()
    ) {
      throw new BadRequestException(
        'A language is required for interpreting requests.',
      );
    }
    const idempotencyKey = rawIdempotencyKey?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > 128) {
      throw new BadRequestException(
        'Idempotency-Key must be 128 characters or fewer.',
      );
    }

    if (
      dto.details &&
      Buffer.byteLength(JSON.stringify(dto.details), 'utf8') > 15000
    ) {
      throw new BadRequestException('Request details must not exceed 15 KB.');
    }
    if (
      dto.serviceCategory === 'FACE2FACE_PHYSICAL' &&
      (typeof dto.details?.location !== 'string' ||
        !dto.details.location.trim())
    ) {
      throw new BadRequestException(
        'A location is required for in-person interpreting.',
      );
    }
    if (
      dto.serviceCategory !== 'DOCUMENTS_TRADUCTION' &&
      dto.requestedFor &&
      new Date(dto.requestedFor) <= new Date()
    ) {
      throw new BadRequestException('The appointment must be in the future.');
    }

    if (idempotencyKey) {
      const existing = await this.database.serviceRequest.findFirst({
        where: { userId: actor.id, idempotencyKey },
        include: { documents: true },
      });
      if (existing) return this.toPublicRequest(existing);
    }

    const request = await this.database.serviceRequest.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.id,
        serviceCategory: dto.serviceCategory,
        title: dto.title.trim(),
        sourceLanguage: dto.sourceLanguage?.trim(),
        targetLanguage: dto.targetLanguage?.trim(),
        requestedFor: dto.requestedFor ? new Date(dto.requestedFor) : undefined,
        details: dto.details as Prisma.InputJsonValue | undefined,
        idempotencyKey,
      },
      include: { documents: true },
    });

    return this.toPublicRequest(request);
  }

  async listMine(actor: RequestActor) {
    const requests = await this.database.serviceRequest.findMany({
      where: { userId: actor.id, tenantId: actor.tenantId },
      include: { documents: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((request) => this.toPublicRequest(request));
  }

  async getOne(actor: RequestActor, requestId: string) {
    const request = await this.database.serviceRequest.findFirst({
      where: {
        id: requestId,
        userId: actor.id,
        tenantId: actor.tenantId,
      },
      include: { documents: true },
    });
    if (!request) throw new NotFoundException('Service request not found.');
    return this.toPublicRequest(request);
  }

  async submit(actor: RequestActor, requestId: string) {
    const request = await this.database.serviceRequest.findFirst({
      where: {
        id: requestId,
        userId: actor.id,
        tenantId: actor.tenantId,
      },
      include: { documents: true },
    });
    if (!request) throw new NotFoundException('Service request not found.');
    if (request.status !== 'DRAFT') {
      throw new BadRequestException('Only draft requests can be submitted.');
    }
    if (
      request.documents.some(
        (document) => document.uploadStatus !== 'AVAILABLE',
      )
    ) {
      throw new BadRequestException(
        'Confirm or remove all pending document uploads before submitting.',
      );
    }
    if (
      request.serviceCategory === 'DOCUMENTS_TRADUCTION' &&
      request.documents.length === 0
    ) {
      throw new BadRequestException(
        'Upload at least one document to request a document translation.',
      );
    }

    const submitted = await this.database.serviceRequest.updateMany({
      where: {
        id: request.id,
        userId: actor.id,
        tenantId: actor.tenantId,
        status: 'DRAFT',
      },
      data: { status: 'SUBMITTED' },
    });
    if (submitted.count !== 1) {
      throw new BadRequestException('This request has already been submitted.');
    }

    await this.syncToVtiger(request.id);
    return this.getOne(actor, request.id);
  }

  async retryCrmSync(actor: RequestActor, requestId: string) {
    const request = await this.findOwnedRequest(actor, requestId);
    if (request.status === 'DRAFT') {
      throw new BadRequestException('Submit the request before syncing it.');
    }
    await this.syncToVtiger(requestId);
    return this.getOne(actor, requestId);
  }

  async refreshCrmStatus(actor: RequestActor, requestId: string) {
    const request = await this.findOwnedRequest(actor, requestId);
    if (!request.crmRecordId) return this.getOne(actor, requestId);

    const target = this.getVtigerTarget(request.serviceCategory);
    const record = await this.vtiger.retrieve<Record<string, unknown>>(
      target.module,
      request.crmRecordId,
    );
    const crmStatus = record[target.statusField];
    const mappedStatus = this.mapCrmStatus(
      request.serviceCategory,
      typeof crmStatus === 'string' ? crmStatus : undefined,
    );

    if (mappedStatus) {
      await this.database.serviceRequest.update({
        where: { id: request.id },
        data: { status: mappedStatus },
      });
    }
    return this.getOne(actor, requestId);
  }

  async uploadDocument(
    actor: RequestActor,
    requestId: string,
    file: UploadedTranslationFile,
    rawIdempotencyKey?: string,
  ) {
    const request = await this.findOwnedRequest(actor, requestId);
    if (request.status !== 'DRAFT') {
      throw new BadRequestException(
        'Documents can only be added to a draft request.',
      );
    }
    if (request.serviceCategory !== ServiceCategory.DOCUMENTS_TRADUCTION) {
      throw new BadRequestException(
        'File uploads are currently supported for document-translation requests.',
      );
    }

    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new BadRequestException(
        'A unique Idempotency-Key header of at most 128 characters is required for each file.',
      );
    }

    if (!file?.buffer?.length || file.size > MAX_DOCUMENT_SIZE) {
      throw new BadRequestException(
        'A non-empty document no larger than 25 MB is required.',
      );
    }

    const documentCount = await this.database.serviceRequestDocument.count({
      where: { serviceRequestId: request.id },
    });
    const filename = basename(file.originalname).replace(/[^\w. -]/g, '_');
    const extension = extname(filename).toLowerCase();
    const contentType = file.mimetype.toLowerCase();
    const allowedContentTypes = ALLOWED_DOCUMENT_TYPES[extension];
    if (
      !allowedContentTypes?.includes(contentType) ||
      file.size > MAX_DOCUMENT_SIZE
    ) {
      throw new BadRequestException(
        'Unsupported document type or document exceeds the 25 MB limit.',
      );
    }

    const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
    let document = await this.database.serviceRequestDocument.findFirst({
      where: { serviceRequestId: request.id, idempotencyKey },
    });
    if (document) {
      if (
        document.fileSha256 !== fileSha256 ||
        document.originalName !== filename
      ) {
        throw new ConflictException(
          'This Idempotency-Key was already used for a different file.',
        );
      }
      if (
        document.uploadStatus === 'AVAILABLE' &&
        document.vtigerDocumentId &&
        document.relatedAt
      ) {
        return this.publicDocument(document);
      }
    } else {
      if (documentCount >= MAX_DOCUMENTS_PER_REQUEST) {
        throw new BadRequestException(
          `A request can contain at most ${MAX_DOCUMENTS_PER_REQUEST} documents.`,
        );
      }
      document = await this.database.serviceRequestDocument.create({
        data: {
          serviceRequestId: request.id,
          idempotencyKey,
          fileSha256,
          originalName: filename,
          contentType,
          sizeBytes: file.size,
        },
      });
    }

    try {
      await this.syncToVtiger(request.id);
      const syncedRequest =
        await this.database.serviceRequest.findUniqueOrThrow({
          where: { id: request.id },
          select: { crmRecordId: true },
        });
      if (!syncedRequest.crmRecordId) {
        throw new ServiceUnavailableException(
          'The translation request could not be created in vTiger. Retry the upload with the same Idempotency-Key.',
        );
      }

      const documentTitle = `${filename}`.slice(0, 100);
      let crmDocumentId = document.vtigerDocumentId;
      if (!crmDocumentId) {
        const existingCrmDocument = await this.queryFirst(
          `select id from Documents where notes_title = '${this.escapeQuery(documentTitle)}';`,
        );
        if (existingCrmDocument) {
          crmDocumentId = this.getVtigerRecordId(existingCrmDocument);
        } else {
          const crmUser = await this.vtiger.me<Record<string, unknown>>();
          const assignedUserId = this.getVtigerRecordId(crmUser);
          const createdDocument = await this.vtiger.createDocument(
            {
              notes_title: documentTitle,
              filelocationtype: 'I',
              filestatus: '1',
              assigned_user_id: assignedUserId,
            },
            { buffer: file.buffer, filename, contentType },
          );
          crmDocumentId = this.getVtigerRecordId(createdDocument);
        }

        await this.database.serviceRequestDocument.update({
          where: { id: document.id },
          data: {
            vtigerDocumentId: crmDocumentId,
            uploadStatus: 'AVAILABLE',
            uploadedAt: new Date(),
          },
        });
      }

      await this.ensureDocumentRelated(
        request.id,
        syncedRequest.crmRecordId,
        document.id,
        crmDocumentId,
      );
      const saved =
        await this.database.serviceRequestDocument.findUniqueOrThrow({
          where: { id: document.id },
        });
      return this.publicDocument(saved);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'vTiger could not store this document. Retry with the same Idempotency-Key.',
      );
    }
  }

  private async ensureDocumentRelated(
    requestId: string,
    translationId: string,
    documentId: string,
    vtigerDocumentId: string,
  ): Promise<void> {
    const document =
      await this.database.serviceRequestDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
    if (document.relatedAt) return;

    const related = await this.vtiger.retrieveRelated<unknown>(
      translationId,
      'Documents',
      'Documents',
    );
    if (!this.containsVtigerRecord(related, vtigerDocumentId)) {
      await this.vtiger.addRelated(
        translationId,
        vtigerDocumentId,
        'Documents',
      );
    }

    const verification = await this.vtiger.retrieveRelated<unknown>(
      translationId,
      'Documents',
      'Documents',
    );
    if (!this.containsVtigerRecord(verification, vtigerDocumentId)) {
      throw new ServiceUnavailableException(
        'vTiger did not confirm that the document was linked to the translation.',
      );
    }

    await this.database.serviceRequestDocument.update({
      where: { id: documentId },
      data: { relatedAt: new Date() },
    });
  }

  private containsVtigerRecord(
    value: unknown,
    recordId: string,
    depth = 0,
  ): boolean {
    if (depth > 8) return false;
    if (Array.isArray(value)) {
      return value.some((entry) =>
        this.containsVtigerRecord(entry, recordId, depth + 1),
      );
    }
    if (!this.isRecord(value)) return false;
    if (this.getRelatedRecordId(value.id) === recordId) return true;
    return Object.values(value).some((entry) =>
      this.containsVtigerRecord(entry, recordId, depth + 1),
    );
  }

  private publicDocument<
    T extends {
      vtigerDocumentId: string | null;
      fileSha256: string | null;
      idempotencyKey: string | null;
    },
  >(document: T) {
    const {
      vtigerDocumentId: _vtigerDocumentId,
      fileSha256: _fileSha256,
      idempotencyKey: _idempotencyKey,
      ...publicDocument
    } = document;
    return publicDocument;
  }

  private async findOwnedRequest(actor: RequestActor, requestId: string) {
    const request = await this.database.serviceRequest.findFirst({
      where: {
        id: requestId,
        userId: actor.id,
        tenantId: actor.tenantId,
      },
    });
    if (!request) throw new NotFoundException('Service request not found.');
    return request;
  }

  private async syncToVtiger(requestId: string): Promise<void> {
    const staleSyncTime = new Date(Date.now() - 5 * 60 * 1000);
    const claim = await this.database.serviceRequest.updateMany({
      where: {
        id: requestId,
        OR: [
          { crmSyncStatus: { in: ['PENDING', 'FAILED'] } },
          { crmSyncStatus: 'SYNCING', crmSyncStartedAt: { lt: staleSyncTime } },
          { crmSyncStatus: 'SYNCED', crmRecordId: { not: null } },
        ],
      },
      data: {
        crmSyncStatus: 'SYNCING',
        crmSyncError: null,
        crmSyncStartedAt: new Date(),
        syncAttempts: { increment: 1 },
      },
    });
    if (claim.count !== 1) return;

    try {
      const request = await this.database.serviceRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: {
          user: true,
          tenant: true,
          serviceTenant: true,
          documents: true,
        },
      });
      const target = this.getVtigerTarget(request.serviceCategory);
      const crmUser = await this.vtiger.me<Record<string, unknown>>();
      const assignedUserId = this.getVtigerRecordId(crmUser);
      const accountId = await this.getExistingAccount(request.tenant);
      const contactId = await this.getExistingContact(request.user, accountId);
      const crmTitle = this.getCrmTitle(request.id, request.title);
      const existing = request.crmRecordId
        ? { id: request.crmRecordId }
        : await this.queryFirst(
            `select id from ${target.module} where ${target.titleField} = '${this.escapeQuery(crmTitle)}';`,
          );
      const crmFields = await this.buildVtigerRequestFields(
        request,
        target,
        crmTitle,
        accountId,
        contactId,
        assignedUserId,
      );
      const crmRecord = existing
        ? await this.vtiger.update<Record<string, unknown>>(
            target.module,
            this.getVtigerRecordId(existing),
            crmFields,
          )
        : await this.vtiger.create<Record<string, unknown>>(
            target.module,
            crmFields,
          );
      const crmRecordId = this.getVtigerRecordId(crmRecord);

      await this.database.serviceRequest.update({
        where: { id: request.id },
        data: { crmRecordId },
      });
      await this.syncRequestDocuments(
        request.id,
        crmRecordId,
        request.documents,
      );

      await this.database.$transaction([
        this.database.tenant.update({
          where: { id: request.tenantId },
          data: { vtigerAccountId: accountId },
        }),
        this.database.user.update({
          where: { id: request.userId },
          data: { vtigerContactId: contactId },
        }),
        this.database.serviceRequest.update({
          where: { id: request.id },
          data: {
            crmRecordId,
            crmSyncStatus: 'SYNCED',
            crmSyncStartedAt: null,
            crmSyncedAt: new Date(),
            crmSyncError: null,
          },
        }),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown vTiger sync error.';
      await this.database.serviceRequest.update({
        where: { id: requestId },
        data: {
          crmSyncStatus: 'FAILED',
          crmSyncStartedAt: null,
          crmSyncError: message.slice(0, 1000),
        },
      });
    }
  }

  private async syncRequestDocuments(
    requestId: string,
    translationRecordId: string,
    documents: Array<{
      id: string;
      vtigerDocumentId: string | null;
      uploadStatus: string;
      relatedAt: Date | null;
    }>,
  ): Promise<void> {
    for (const document of documents) {
      if (document.uploadStatus !== 'AVAILABLE') continue;
      if (!document.vtigerDocumentId) {
        throw new Error(
          'Every translation file must exist in vTiger Documents before submission.',
        );
      }
      await this.ensureDocumentRelated(
        requestId,
        translationRecordId,
        document.id,
        document.vtigerDocumentId,
      );
    }
  }

  private async getExistingAccount(tenant: {
    name: string;
    vtigerAccountId: string | null;
  }): Promise<string> {
    if (tenant.vtigerAccountId) return tenant.vtigerAccountId;

    const existing = await this.queryFirst(
      `select id from Accounts where accountname = '${this.escapeQuery(tenant.name)}';`,
    );
    if (!existing) {
      throw new Error(
        `No existing vTiger Account matches portal tenant "${tenant.name}".`,
      );
    }
    return this.getVtigerRecordId(existing);
  }

  private async getExistingContact(
    user: {
      email: string;
      vtigerContactId: string | null;
    },
    accountId: string,
  ): Promise<string> {
    const contactFilter = user.vtigerContactId
      ? `id = '${this.escapeQuery(user.vtigerContactId)}'`
      : `email = '${this.escapeQuery(user.email)}'`;
    const existing = await this.queryFirst(
      `select id, account_id from Contacts where ${contactFilter} and account_id = '${this.escapeQuery(accountId)}';`,
    );
    if (!existing) {
      throw new Error(
        `No existing vTiger Contact matches portal user "${user.email}".`,
      );
    }

    const contactId = this.getVtigerRecordId(existing);
    const contactAccountId = this.getRelatedRecordId(existing.account_id);
    if (contactAccountId !== accountId) {
      throw new Error(
        `The vTiger Contact for "${user.email}" is not linked to the portal tenant's Account.`,
      );
    }
    return contactId;
  }

  private getRelatedRecordId(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value !== 'object' || value === null) return undefined;

    const relation = value as Record<string, unknown>;
    if (typeof relation.value === 'string') return relation.value;
    if (typeof relation.id === 'string') return relation.id;
    return undefined;
  }

  private async queryFirst(
    query: string,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await this.vtiger.query<unknown>(query);
    if (Array.isArray(result)) {
      return result.find((row) => this.isRecord(row)) as
        Record<string, unknown> | undefined;
    }
    if (this.isRecord(result) && Array.isArray(result.records)) {
      return result.records.find((row) => this.isRecord(row)) as
        Record<string, unknown> | undefined;
    }
    return undefined;
  }

  private getVtigerRecordId(record: Record<string, unknown>): string {
    const id = record.id;
    if (typeof id !== 'string' || !id) {
      throw new Error('vTiger response did not include a record ID.');
    }
    return id;
  }

  private escapeQuery(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private toPublicRequest<
    T extends { documents: Array<Record<string, unknown>> },
  >(request: T) {
    const {
      documents,
      crmSyncError: _crmSyncError,
      idempotencyKey: _idempotencyKey,
      ...publicRequest
    } = request as T & {
      crmSyncError?: string | null;
      idempotencyKey?: string | null;
    };
    return {
      ...publicRequest,
      documents: documents.map(
        ({
          vtigerDocumentId: _vtigerDocumentId,
          fileSha256: _fileSha256,
          idempotencyKey: _documentIdempotencyKey,
          ...document
        }) => document,
      ),
    };
  }
}
