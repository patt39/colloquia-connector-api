import { VtigerApiError } from './vtiger.errors';
import { VtigerService } from './vtiger.service';
import type { VtigerConfig } from './vtiger.types';

const config: VtigerConfig = {
  baseUrl: 'https://crm.example.test',
  username: 'integration-user',
  accessKey: 'test-access-key',
  timeoutMs: 15000,
};

describe('VtigerService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends authenticated GET requests and unwraps the vTiger result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: [{ id: '1' }] })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const service = new VtigerService(config);

    await expect(service.query('select * from Accounts;')).resolves.toEqual([
      { id: '1' },
    ]);

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://crm.example.test/restapi/v1/vtiger/default/query?query=select+*+from+Accounts%3B',
    );
    expect(new Headers(options.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('integration-user:test-access-key').toString('base64')}`,
    );
  });

  it('sends Create elementType and JSON element as URL-encoded text fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, result: { id: 'account-1' } }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const service = new VtigerService(config);

    await expect(
      service.create('Accounts', { accountname: 'Example' }),
    ).resolves.toEqual({ id: 'account-1' });

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = options.body as URLSearchParams;
    expect(options.method).toBe('POST');
    expect(url.toString()).toBe(
      'https://crm.example.test/restapi/v1/vtiger/default/create',
    );
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body.get('elementType')).toBe('Accounts');
    expect(body.get('element')).toBe(
      JSON.stringify({ accountname: 'Example' }),
    );
  });

  it('uploads a file to the vTiger Documents module as multipart form-data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { id: '7xB', filename: 'translation.pdf' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new VtigerService(config);

    await expect(
      service.createDocument(
        {
          notes_title: 'Translation source',
          filelocationtype: 'I',
          filestatus: '1',
          assigned_user_id: '19x1',
        },
        {
          buffer: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          filename: 'translation.pdf',
          contentType: 'application/pdf',
        },
      ),
    ).resolves.toMatchObject({ id: '7xB', filename: 'translation.pdf' });

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = options.body as FormData;
    expect(url.toString()).toBe(
      'https://crm.example.test/restapi/v1/vtiger/default/create',
    );
    expect(body.get('elementType')).toBe('Documents');
    expect(JSON.parse(String(body.get('element')))).toMatchObject({
      notes_title: 'Translation source',
      filelocationtype: 'I',
      filestatus: '1',
      assigned_user_id: '19x1',
    });
    expect(body.get('filename')).toBeInstanceOf(File);
    expect((body.get('filename') as File).name).toBe('translation.pdf');
  });

  it('links a vTiger Document with the add_related form fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: true })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const service = new VtigerService(config);

    await service.addRelated('72xA', '7xB', 'Documents');

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = options.body as URLSearchParams;
    expect(url.pathname).toBe('/restapi/v1/vtiger/default/add_related');
    expect(body.get('sourceRecordId')).toBe('72xA');
    expect(body.get('relatedRecordId')).toBe('7xB');
    expect(body.get('relationIdLabel')).toBe('Documents');
  });

  it('throws a typed error for vTiger API failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'AUTH_ERROR', message: 'Invalid access key' },
          }),
        ),
      ),
    );
    const service = new VtigerService(config);

    await expect(service.me()).rejects.toMatchObject<VtigerApiError>({
      name: 'VtigerApiError',
      code: 'AUTH_ERROR',
      message: 'Invalid access key',
    });
  });
});
