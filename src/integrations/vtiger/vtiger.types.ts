export type VtigerOperation =
  | 'describe'
  | 'query'
  | 'queryRelated'
  | 'me'
  | 'listTypes'
  | 'lookup'
  | 'create'
  | 'revise'
  | 'sync'
  | 'retrieve'
  | 'delete'
  | 'update'
  | 'files'
  | 'files_retrieve'
  | 'add_related'
  | 'retrieve_related'
  | 'deleteRelated'
  | 'relatedTypes'
  | 'tags'
  | 'addTags'
  | 'accountHierarchy'
  | 'picklistDependency'
  | 'reopen';

export type VtigerRecord = Record<string, unknown>;

export type VtigerQueryValue = string | number | boolean;

export interface VtigerRequestOptions {
  method?: 'GET' | 'POST';
  bodyFormat?: 'form-data' | 'urlencoded';
  accept?: string;
  query?: Record<string, VtigerQueryValue | undefined>;
  form?: Record<string, unknown>;
}

export interface VtigerConfig {
  baseUrl: string;
  username: string;
  accessKey: string;
  timeoutMs: number;
}

export interface VtigerFile {
  data: Uint8Array;
  contentType: string;
  filename?: string;
}

export interface VtigerUploadFile {
  buffer: Uint8Array;
  filename: string;
  contentType: string;
}
