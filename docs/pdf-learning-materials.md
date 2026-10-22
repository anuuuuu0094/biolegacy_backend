# Private PDF learning materials

BioLegacy stores PDF metadata in PostgreSQL and PDF bytes in a private Cloudflare R2 bucket. Administrators manage files from `/admin/learning`; enrolled students view them from `/dashboard`.

## Why the file is not stored in PostgreSQL or the frontend

- PostgreSQL keeps titles, course/module relationships, permissions, file size, and the private object key. It does not carry large binary files.
- The frontend `public` directory would make PDFs public and would require a new deployment for every change.
- A private object bucket supports direct uploads, byte-range PDF viewing, and short-lived links without routing large files through the Render process.

Cloudflare R2's Standard storage currently includes a monthly free allocation. This is free only while the account remains within Cloudflare's published limits; it is not unlimited storage.

## Data and access model

Each material belongs to one course and can optionally belong to one learning module. A material has three upload states:

- `PENDING`: an administrator created an upload but it has not been verified.
- `READY`: storage contains a verified PDF and it can be published.
- `FAILED`: verification rejected the upload.

Published `READY` materials are returned only when the student has an active or completed enrollment whose purchase grant is still valid. If a material is attached to an archived module, it is also hidden.

The backend creates a short-lived signed R2 URL after every access check. The bucket remains private and no permanent public URL is stored. `Allow download` removes the explicit download action, but no browser-based viewer can prevent screenshots or a determined user from saving content that their browser is allowed to display.

## Cloudflare R2 setup

1. In Cloudflare, open **R2 Object Storage** and create a Standard bucket named `biolegacy-pdfs`.
2. Leave public development URLs and custom domains disabled for this bucket.
3. Create an R2 API token scoped to this one bucket with object read and write permission.
4. Add the following backend-only values to local `.env` and the Render environment:

```env
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=biolegacy-pdfs
PDF_MAX_FILE_SIZE_MB=25
PDF_STORAGE_QUOTA_MB=9000
PDF_SIGNED_URL_TTL_SECONDS=600
```

`R2_ENDPOINT` is optional. The backend derives `https://<account-id>.r2.cloudflarestorage.com` when it is empty.

Never place these credentials in the frontend or use a `NEXT_PUBLIC_` variable.

The default 9,000 MB application quota leaves headroom below R2's 10 GB free storage allocation. Pending and ready files both reserve quota so interrupted uploads cannot silently bypass this guard. Cloudflare request-operation limits still apply, so enable billing notifications and review usage in the R2 dashboard.

## Required bucket CORS policy

Direct browser uploads require R2 CORS. Replace the example origins with the exact local and production frontend origins:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://biolegacy.vercel.app"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Preview or custom domains must be listed explicitly if administrators upload from them.

## Upload lifecycle

1. The admin API validates the `.pdf` name, MIME type, declared size, course, and administrator session.
2. PostgreSQL receives a `PENDING` record with an unpredictable object path.
3. The API returns a short-lived signed `PUT` URL.
4. The browser uploads directly to the private R2 bucket.
5. The completion API reads object metadata and the first five bytes. It rejects oversized files or files that do not start with `%PDF-`.
6. The record becomes `READY` and uses the administrator's publication settings.

Archive is reversible because it only hides the record. Permanent delete removes the R2 object and database record and cannot be undone.

## Deployment and verification

The normal server startup applies `004_learning_materials.sql`. After adding the R2 environment values and CORS policy:

1. Deploy or restart the backend.
2. Open `/admin/learning`, select a course, and upload a small PDF.
3. Confirm the item shows `READY` and `Published`.
4. Sign in as an enrolled student and open the PDF from `/dashboard`.
5. Confirm a student without enrollment receives no metadata or signed link.

If upload creation says storage is not configured, check all four required R2 variables. If the direct upload fails in the browser, check the bucket CORS origins and the browser network response. If completion says the upload was not found, verify the bucket name and token scope.
