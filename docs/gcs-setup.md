# Google Cloud Storage setup (file uploads)

Files live in a private Cloud Storage bucket. The browser uploads and downloads directly using short-lived
signed URLs (10 min upload, 5 min download). The app only stores metadata and checks permissions.

## One-time setup

1. **Bucket**: private, uniform access control, public access prevention ON (`rokket-manager-files`).
2. **Service account** (IAM & Admin -> Service Accounts), no project roles. Create a JSON key.
3. **Grant** the service account **Storage Object Admin** on this bucket only (bucket -> Permissions).
4. **CORS** (Cloud Shell), replacing the Render URL:

       echo '[{"origin":["http://localhost:3100","https://YOUR-RENDER-URL"],"method":["PUT","GET"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]' > cors.json
       gcloud storage buckets update gs://rokket-manager-files --cors-file=cors.json

## Environment variables

| Variable                      | Where              | Value                                   |
| ----------------------------- | ------------------ | --------------------------------------- |
| `GCS_BUCKET`                  | local + Render     | bucket name                             |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | local `.env.local` | path to the JSON key (outside the repo) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Render             | full contents of the JSON key           |

Never commit the key or paste it into chat/issues. Rotate it from the service account's Keys tab.

## Behavior

- Upload: browser asks the server (permission check) -> PUT to signed URL -> server verifies object + size -> file becomes READY.
- Blocked types: executables/scripts/html/svg. Max 100 MB. Downloads are always `attachment`.
- If the bucket is not configured, uploads show "File storage is not configured yet." and nothing else breaks.
- Deleting a file/project/client removes the stored objects best-effort; orphan sweep is a Phase 6 task.
