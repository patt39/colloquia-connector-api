import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { config } from '../../app/config';
import { ServiceCategory } from '../../app/database/prisma';
import { ServiceRequestsService } from './service-requests.service';
import type { RequestActor } from './service-requests.service';

const actor: RequestActor = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'user@example.com',
  username: 'Portal User',
};

const documentRequest = {
  serviceCategory: ServiceCategory.DOCUMENTS_TRADUCTION,
  title: 'Translate a contract',
  sourceLanguage: 'ITALIANO',
  targetLanguage: 'INGLESE',
};

describe('ServiceRequestsService', () => {
  it('saves a draft for the authenticated tenant without syncing to vTiger', async () => {
    const draft = {
      id: 'request-1',
      status: 'DRAFT',
      crmSyncStatus: 'PENDING',
      documents: [],
    };
    const database = {
      serviceTenant: {
        findFirst: vi.fn().mockResolvedValue({ id: 'service-tenant-1' }),
      },
      serviceRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(draft),
      },
    };
    const vtiger = { me: vi.fn() };
    const service = new ServiceRequestsService(
      database as never,
      vtiger as never,
    );

    await expect(service.create(actor, documentRequest)).resolves.toMatchObject(
      draft,
    );
    expect(database.serviceRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: actor.id,
          tenantId: actor.tenantId,
          serviceTenantId: 'service-tenant-1',
        }),
      }),
    );
    expect(vtiger.me).not.toHaveBeenCalled();
  });

  it('rejects a request when the service is not enabled for the tenant', async () => {
    const database = {
      serviceTenant: { findFirst: vi.fn().mockResolvedValue(null) },
      serviceRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    };
    const service = new ServiceRequestsService(database as never, {} as never);

    await expect(service.create(actor, documentRequest)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(database.serviceRequest.create).not.toHaveBeenCalled();
  });

  it('lists only services enabled for the authenticated tenant', async () => {
    const database = {
      serviceTenant: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new ServiceRequestsService(database as never, {} as never);

    await expect(
      service.listAvailableServices(actor.tenantId),
    ).resolves.toEqual([]);
    expect(database.serviceTenant.findMany).toHaveBeenCalledWith({
      where: { tenantId: actor.tenantId, deletedAt: null },
      select: { serviceCategory: true },
    });
  });

  it('rejects phone interpreting until a matching vTiger request module is configured', async () => {
    const database = { serviceRequest: { create: vi.fn() } };
    const service = new ServiceRequestsService(database as never, {} as never);

    await expect(
      service.create(actor, {
        ...documentRequest,
        serviceCategory: ServiceCategory.PHONE_CALL,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.serviceRequest.create).not.toHaveBeenCalled();
  });

  it('requires at least one uploaded document before submitting a translation request', async () => {
    const draft = {
      id: 'request-1',
      userId: actor.id,
      tenantId: actor.tenantId,
      status: 'DRAFT',
      serviceCategory: ServiceCategory.DOCUMENTS_TRADUCTION,
      documents: [],
    };
    const database = {
      serviceRequest: {
        findFirst: vi.fn().mockResolvedValue(draft),
        updateMany: vi.fn(),
      },
    };
    const service = new ServiceRequestsService(database as never, {} as never);

    await expect(service.submit(actor, draft.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(database.serviceRequest.updateMany).not.toHaveBeenCalled();
  });

  it('does not create CRM records when an existing client Contact is missing', async () => {
    const request = {
      id: 'request-1',
      userId: actor.id,
      tenantId: actor.tenantId,
      status: 'SUBMITTED',
      crmRecordId: null,
      crmSyncStatus: 'FAILED',
      documents: [],
      user: {
        id: actor.id,
        username: actor.username,
        email: actor.email,
        vtigerContactId: null,
      },
      tenant: {
        id: actor.tenantId,
        name: 'Client tenant',
        vtigerAccountId: null,
      },
      serviceTenant: { voxGentiumServiceId: 'service-1' },
      serviceCategory: ServiceCategory.FACE2FACE_VIDEO,
      title: 'Interpretation request',
      sourceLanguage: 'it',
      targetLanguage: 'en',
      requestedFor: new Date(Date.now() + 60 * 60 * 1000),
      details: {},
    };
    const database = {
      serviceRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue(request),
      },
    };
    const vtiger = {
      me: vi.fn().mockResolvedValue({ id: 'owner-1' }),
      query: vi
        .fn()
        .mockImplementation((query: string) =>
          Promise.resolve(
            query.includes('Accounts') ? [{ id: 'account-1' }] : [],
          ),
        ),
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
    };
    const service = new ServiceRequestsService(
      database as never,
      vtiger as never,
    );

    await service.retryCrmSync(actor, request.id);

    expect(vtiger.create).not.toHaveBeenCalled();
    expect(vtiger.update).not.toHaveBeenCalled();
    expect(database.serviceRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ crmSyncStatus: 'FAILED' }),
      }),
    );
  });

  it('creates a translation in vtcmtraduzioni using the existing Account and Contact', async () => {
    const request = {
      id: 'request-1',
      userId: actor.id,
      tenantId: actor.tenantId,
      status: 'SUBMITTED',
      crmRecordId: null,
      crmSyncStatus: 'PENDING',
      documents: [],
      user: { ...actor, vtigerContactId: null },
      tenant: {
        id: actor.tenantId,
        name: 'Client tenant',
        vtigerAccountId: null,
      },
      serviceTenant: { voxGentiumServiceId: 'service-1' },
      serviceCategory: ServiceCategory.DOCUMENTS_TRADUCTION,
      title: 'Translate contract',
      sourceLanguage: 'ITALIANO',
      targetLanguage: 'INGLESE',
      createdAt: new Date('2026-10-06T10:00:00.000Z'),
      requestedFor: null,
      details: {},
    };
    const database = {
      serviceRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue(request),
      },
      tenant: { update: vi.fn() },
      user: { update: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const vtiger = {
      me: vi.fn().mockResolvedValue({ id: 'owner-1' }),
      query: vi.fn().mockImplementation((query: string) => {
        if (query.includes('Accounts')) {
          return Promise.resolve([{ id: 'account-1' }]);
        }
        if (query.includes('Contacts')) {
          return Promise.resolve([
            { id: 'contact-1', account_id: 'account-1' },
          ]);
        }
        return Promise.resolve([]);
      }),
      describe: vi.fn().mockResolvedValue({
        fields: [
          {
            name: 'fld_linguasource_2339',
            type: { picklistValues: [{ value: 'ITALIANO' }] },
          },
          {
            name: 'fld_linguatarget_2341',
            type: { picklistValues: [{ value: 'INGLESE' }] },
          },
        ],
      }),
      create: vi.fn().mockImplementation((module: string) =>
        Promise.resolve({
          id: module === 'vtcmtraduzioni' ? 'translation-1' : 'comment-1',
        }),
      ),
      update: vi.fn(),
    };
    const service = new ServiceRequestsService(
      database as never,
      vtiger as never,
    );

    await service.retryCrmSync(actor, request.id);

    expect(vtiger.create).toHaveBeenCalledWith(
      'vtcmtraduzioni',
      expect.objectContaining({
        fld_vtcmtraduzioniname: expect.stringContaining('Translate contract'),
        assigned_user_id: 'owner-1',
        cf_vtcmtraduzioni_cliente: 'account-1',
        cf_vtcmtraduzioni_riferimentorichiedente: actor.email,
        fld_linguasource_2339: 'ITALIANO',
        fld_linguatarget_2341: 'INGLESE',
        fld_stato_2337: 'NUOVO',
      }),
    );
    expect(
      vtiger.create.mock.calls.some(([module]) =>
        ['Accounts', 'Contacts'].includes(module),
      ),
    ).toBe(false);
    expect(database.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { vtigerContactId: 'contact-1' },
      }),
    );
  });

  it('creates the translation before uploading and linking its vTiger document', async () => {
    const documentId = 'portal-document-1';
    const pendingDocument = {
      id: documentId,
      serviceRequestId: 'request-1',
      vtigerDocumentId: null,
      idempotencyKey: 'upload-1',
      fileSha256: 'hash',
      originalName: 'contract.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4,
      uploadStatus: 'PENDING_UPLOAD',
      relatedAt: null,
    };
    const request = {
      id: 'request-1',
      userId: actor.id,
      tenantId: actor.tenantId,
      status: 'DRAFT',
      crmRecordId: null,
      crmSyncStatus: 'PENDING',
      serviceCategory: ServiceCategory.DOCUMENTS_TRADUCTION,
      title: 'Translate contract',
      sourceLanguage: 'ITALIANO',
      targetLanguage: 'INGLESE',
      createdAt: new Date('2026-10-07T10:00:00.000Z'),
      requestedFor: null,
      details: {},
      user: { ...actor, vtigerContactId: 'contact-1' },
      tenant: {
        id: actor.tenantId,
        name: 'Client tenant',
        vtigerAccountId: 'account-1',
      },
      serviceTenant: { voxGentiumServiceId: 'service-1' },
      documents: [pendingDocument],
    };
    const availableDocument = {
      ...pendingDocument,
      vtigerDocumentId: '7xB',
      uploadStatus: 'AVAILABLE',
      uploadedAt: new Date(),
      relatedAt: new Date(),
    };
    const database = {
      serviceRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValueOnce(request)
          .mockResolvedValueOnce({ crmRecordId: '72xA' }),
        update: vi.fn().mockResolvedValue(request),
      },
      serviceRequestDocument: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(pendingDocument),
        update: vi.fn().mockResolvedValue(availableDocument),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValueOnce({ ...availableDocument, relatedAt: null })
          .mockResolvedValueOnce(availableDocument),
      },
      tenant: { update: vi.fn() },
      user: { update: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const events: string[] = [];
    const vtiger = {
      me: vi.fn().mockResolvedValue({ id: '19x1' }),
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: 'contact-1', account_id: 'account-1' }),
      describe: vi.fn().mockResolvedValue({
        fields: [
          {
            name: 'fld_linguasource_2339',
            type: { picklistValues: [{ value: 'ITALIANO' }] },
          },
          {
            name: 'fld_linguatarget_2341',
            type: { picklistValues: [{ value: 'INGLESE' }] },
          },
        ],
      }),
      query: vi.fn().mockImplementation((query: string) => {
        if (query.includes('vtcmtraduzioni')) return Promise.resolve([]);
        if (query.includes('Documents')) return Promise.resolve([]);
        return Promise.resolve([]);
      }),
      create: vi.fn().mockImplementation((module: string) => {
        events.push(`create:${module}`);
        return Promise.resolve({ id: '72xA' });
      }),
      createDocument: vi.fn().mockImplementation(() => {
        events.push('create:Documents');
        return Promise.resolve({ id: '7xB', filename: 'contract.pdf' });
      }),
      addRelated: vi.fn().mockImplementation(() => {
        events.push('add_related');
        return Promise.resolve({ success: true });
      }),
      retrieveRelated: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: '7xB' }]),
      update: vi.fn(),
    };
    const service = new ServiceRequestsService(
      database as never,
      vtiger as never,
    );

    try {
      const result = await service.uploadDocument(
        actor,
        request.id,
        {
          buffer: Buffer.from('%PDF'),
          originalname: 'contract.pdf',
          mimetype: 'application/pdf',
          size: 4,
        },
        'upload-1',
      );

      expect(result).toMatchObject({
        id: documentId,
        originalName: 'contract.pdf',
      });
      expect(events).toEqual([
        'create:vtcmtraduzioni',
        'create:Documents',
        'add_related',
      ]);
      expect(vtiger.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          notes_title: expect.stringContaining('contract.pdf'),
          filelocationtype: 'I',
          filestatus: '1',
          assigned_user_id: '19x1',
        }),
        expect.objectContaining({ filename: 'contract.pdf' }),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});
