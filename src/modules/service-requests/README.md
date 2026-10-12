# Portal service requests

All routes are under `/api/{API_VERSION}/service-requests` and require the
portal JWT cookie or a Bearer token. User and tenant IDs come from the
authenticated account; the client must not submit those IDs.

## Create and submit

Create a draft with `POST /api/v1/service-requests`. Send an `Idempotency-Key`
header to make retries of the same request safe.

```json
{
  "serviceCategory": "DOCUMENTS_TRADUCTION",
  "title": "Translate contract",
  "sourceLanguage": "ITALIANO",
  "targetLanguage": "INGLESE",
  "details": {
    "quantity": 1200,
    "quantityUnit": "PAROLE",
    "deliveryOption": "STANDARD",
    "subject": "Legale",
    "notes": "Preserve the original layout"
  }
}
```

Use the exact picklist values returned in `formOptions` by `GET /services` for
languages, translation subject/quantity/delivery options. For
`FACE2FACE_VIDEO` and `FACE2FACE_PHYSICAL`, provide `requestedFor` as an
ISO-8601 date/time; physical requests also require `details.location`.
Interpreting forms can also send `details.startTime` and `details.endTime`.
`PHONE_CALL` is not exposed until a matching vTiger module is identified.
Document translation requires at least one uploaded document before submission.

## Upload documents

1. Call `POST /:requestId/documents` as `multipart/form-data`, with the file in
  field `file` and a unique `Idempotency-Key` header for that file.
2. The API creates or reuses the translation record, uploads the file directly
  to the vTiger `Documents` module, and links it to the translation using
  `add_related`. The response includes the portal's document ID and the
  filename vTiger confirmed.
3. Call `POST /:requestId/submit` when all required files have uploaded.
4. Download through `GET /:requestId/documents/:documentId`; the API fetches
  the file from vTiger and streams it to the authenticated portal user.

Files are limited to 25 MB each, up to 10 files per request, and common
document/image formats. vTiger must have the Documents module enabled and a
default Documents folder accessible to the API user. The API omits `folderid`
so vTiger uses that default. Files are not stored in S3 or on this API server;
PostgreSQL stores only vTiger IDs, metadata, and upload/link state.

## Read and synchronization routes

- `GET /services` lists service categories enabled for the authenticated tenant.
- `GET /` lists the authenticated user's requests.
- `GET /:requestId` reads one of that user's requests.
- `POST /:requestId/sync` retries or refreshes the related vTiger request.
- `POST /:requestId/refresh-status` reads the vTiger status back into
  PostgreSQL.
- `GET /:requestId/documents/:documentId` streams the owner-scoped file from
  vTiger.

The request is committed to PostgreSQL before CRM synchronization. A CRM error
does not discard it; `crmSyncStatus` reports the sync state, and the sync route
can retry. vTiger status is refreshed on demand, not continuously.
Failed CRM syncs are retried in the background once per minute, for up to eight
attempts; the user can also request a manual retry.

Only tenants with an enabled `ServiceTenant` mapping can request a service.
During CRM sync, the portal tenant must match an existing vTiger Account by
account name, and the portal user's email must match an existing Contact linked
to that Account. Existing stored vTiger IDs are used when present. The
integration never creates Accounts or Contacts; missing or mismatched client
records leave the request saved with a failed CRM sync for an administrator to
resolve.

Document translations map to `vtcmtraduzioni`; physical/video interpreting map
to `vtcmfacetoface`. `PHONE_CALL` remains disabled because no suitable request
module is exposed. These mappings were built from this vTiger user's live
`describe` metadata.

Apply the Prisma schema change to the database before deploying the routes.
This project currently uses `npm run db:push`; review the schema and target DB
before running it. Configure `ALLOWED_ORIGINS`, vTiger access credentials, and
an accessible vTiger Documents folder for the deployed environment.
