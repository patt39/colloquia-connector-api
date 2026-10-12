# vTiger CRM integration

`VtigerService` wraps the vTiger Cloud REST API at
`/restapi/v1/vtiger/default`. It uses HTTP Basic Auth and form-encoded POST
bodies, matching the linked Postman collection.

## Configuration

Set these variables in the application environment:

```dotenv
VTIGER_BASE_URL=https://your-instance.vtiger.com
VTIGER_USERNAME=your-vtiger-user
VTIGER_ACCESS_KEY=your-vtiger-api-access-key
VTIGER_TIMEOUT_MS=15000
```

vTiger expects the user's API access key, not their web-login password. Never
commit credentials or expose them in logs.

## Usage

Import `VtigerModule` in a Nest module, then inject `VtigerService`:

```ts
const currentUser = await this.vtiger.me();
const accounts = await this.vtiger.query(
  "select * from Accounts where accountname = 'Example';",
);
```

The service includes helpers for `me`, `describe`, `listTypes`, `query`,
`retrieve`, `create`, `update`, `revise`, `delete`, and file downloads. Use
`request(operation, options)` for the other collection operations such as
related records, sync, lookup, tags, account hierarchy, picklist dependencies,
and reopen. POST form values that are objects are JSON-encoded automatically.

Errors are raised as `VtigerApiError`; messages do not include credentials.
The service does not retry writes, avoiding accidental duplicate CRM records.
