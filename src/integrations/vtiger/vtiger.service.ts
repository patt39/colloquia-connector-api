import { Inject, Injectable } from '@nestjs/common';
import { VtigerApiError } from './vtiger.errors';
import type {
  VtigerConfig,
  VtigerFile,
  VtigerOperation,
  VtigerRecord,
  VtigerRequestOptions,
  VtigerUploadFile,
} from './vtiger.types';

export const VTIGER_CONFIG = Symbol('VTIGER_CONFIG');

@Injectable()
export class VtigerService {
  constructor(@Inject(VTIGER_CONFIG) private readonly config: VtigerConfig) {}

  async request<T = unknown>(
    operation: VtigerOperation,
    options: VtigerRequestOptions = {},
  ): Promise<T> {
    const response = await this.send(operation, options);
    const text = await response.text();
    let payload: unknown;

    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      throw new VtigerApiError(
        'vTiger returned a non-JSON response.',
        response.status,
      );
    }

    if (!response.ok) {
      throw this.toApiError(payload, response.status);
    }

    if (this.isRecord(payload) && payload.success === false) {
      throw this.toApiError(payload, response.status);
    }

    if (
      this.isRecord(payload) &&
      payload.success === true &&
      'result' in payload
    ) {
      return payload.result as T;
    }

    return payload as T;
  }

  me<T = VtigerRecord>(): Promise<T> {
    return this.request<T>('me');
  }

  describe<T = VtigerRecord>(elementType: string): Promise<T> {
    return this.request<T>('describe', { query: { elementType } });
  }

  listTypes<T = unknown>(elementType?: string): Promise<T> {
    return this.request<T>('listTypes', {
      query: elementType ? { elementType } : undefined,
    });
  }

  query<T = VtigerRecord[]>(statement: string): Promise<T> {
    return this.request<T>('query', { query: { query: statement } });
  }

  retrieve<T = VtigerRecord>(
    elementType: string,
    elementId: string,
  ): Promise<T> {
    return this.request<T>('retrieve', { query: { elementType, elementId } });
  }

  create<T = VtigerRecord>(
    elementType: string,
    fields: VtigerRecord,
  ): Promise<T> {
    return this.request<T>('create', {
      method: 'POST',
      bodyFormat: 'urlencoded',
      form: { elementType, element: fields },
    });
  }

  async createDocument(
    fields: VtigerRecord,
    file: VtigerUploadFile,
  ): Promise<VtigerRecord> {
    const result = await this.request<VtigerRecord>('create', {
      method: 'POST',
      bodyFormat: 'form-data',
      form: {
        elementType: 'Documents',
        element: fields,
        filename: new File([new Uint8Array(file.buffer)], file.filename, {
          type: file.contentType,
        }),
      },
    });

    if (typeof result.filename !== 'string' || !result.filename) {
      throw new VtigerApiError(
        'vTiger created the Document record but did not confirm the uploaded filename.',
      );
    }

    return result;
  }

  addRelated(
    sourceRecordId: string,
    relatedRecordId: string,
    relationIdLabel: string,
  ): Promise<unknown> {
    return this.request('add_related', {
      method: 'POST',
      bodyFormat: 'urlencoded',
      form: { sourceRecordId, relatedRecordId, relationIdLabel },
    });
  }

  retrieveRelated<T = unknown>(
    recordId: string,
    relatedLabel: string,
    relatedType: string,
  ): Promise<T> {
    return this.request<T>('retrieve_related', {
      query: { id: recordId, relatedLabel, relatedType },
    });
  }

  update<T = VtigerRecord>(
    elementType: string,
    elementId: string,
    fields: VtigerRecord,
  ): Promise<T> {
    return this.writeRecord<T>('update', elementType, elementId, fields);
  }

  revise<T = VtigerRecord>(
    elementType: string,
    elementId: string,
    fields: VtigerRecord,
  ): Promise<T> {
    return this.writeRecord<T>('revise', elementType, elementId, fields);
  }

  delete<T = unknown>(elementType: string, elementId: string): Promise<T> {
    return this.request<T>('delete', {
      method: 'POST',
      query: { elementType, elementId },
    });
  }

  async downloadFile(documentId: string): Promise<VtigerFile> {
    const response = await this.send('files_retrieve', {
      query: { id: documentId },
      accept: '*/*',
    });
    if (!response.ok) {
      const text = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
      throw this.toApiError(payload, response.status);
    }

    const disposition = response.headers.get('content-disposition');
    const filename = disposition?.match(
      /filename\*?=(?:UTF-8''|"?)([^";]+)/i,
    )?.[1];

    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
      filename,
    };
  }

  private writeRecord<T>(
    operation: 'update' | 'revise',
    elementType: string,
    elementId: string,
    fields: VtigerRecord,
  ): Promise<T> {
    return this.request<T>(operation, {
      method: 'POST',
      query: { elementType, elementId },
      form: { element: fields },
    });
  }

  private async send(
    operation: VtigerOperation,
    options: VtigerRequestOptions,
  ): Promise<Response> {
    const { baseUrl, username, accessKey, timeoutMs } = this.config;
    if (!baseUrl || !username || !accessKey) {
      throw new VtigerApiError(
        'vTiger is not configured. Set VTIGER_BASE_URL, VTIGER_USERNAME, and VTIGER_ACCESS_KEY.',
      );
    }

    const apiRoot = '/restapi/v1/vtiger/default';
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const endpoint = normalizedBase.endsWith(apiRoot)
      ? `${normalizedBase}/${operation}`
      : `${normalizedBase}${apiRoot}/${operation}`;
    const url = new URL(endpoint);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers = new Headers({
      authorization: `Basic ${Buffer.from(`${username}:${accessKey}`).toString('base64')}`,
      accept: options.accept ?? 'application/json',
    });
    let body: URLSearchParams | FormData | undefined;

    if (options.method === 'POST') {
      body =
        options.bodyFormat === 'form-data'
          ? new FormData()
          : new URLSearchParams();
      for (const [key, value] of Object.entries(options.form ?? {})) {
        if (value !== undefined) {
          if (body instanceof FormData && value instanceof Blob) {
            body.set(key, value);
          } else {
            const serialized =
              typeof value === 'string' ? value : JSON.stringify(value);
            body.set(key, serialized);
          }
        }
      }
    }

    try {
      return await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new VtigerApiError(
          `vTiger request timed out after ${timeoutMs}ms.`,
        );
      }
      throw new VtigerApiError('Could not connect to vTiger.');
    }
  }

  private toApiError(payload: unknown, status: number): VtigerApiError {
    if (this.isRecord(payload)) {
      const error = this.isRecord(payload.error) ? payload.error : payload;
      const message =
        typeof error.message === 'string'
          ? error.message
          : `vTiger request failed with HTTP ${status}.`;
      const code = typeof error.code === 'string' ? error.code : undefined;
      return new VtigerApiError(message, status, code);
    }

    return new VtigerApiError(
      `vTiger request failed with HTTP ${status}.`,
      status,
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
