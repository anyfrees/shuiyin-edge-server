# EdgeOne Makers deployment

## Storage bindings

- Bind KV as `PROVENANCE_KV`. It stores identities, sessions, template metadata, grants and auxiliary indexes.
- Bind Makers Blob as `PROVENANCE_BLOB`. Registration requires conditional `onlyIfNew` writes and strong reads; KV must not replace it.
- Bind a second Makers Blob as `TEMPLATE_BLOB`. It stores signed template packages and preview images.

## Secrets and variables

Configure these with the Makers secret/environment facility; never commit real values:

- `WECHAT_APP_ID`, `WECHAT_APP_SECRET`
- `JILU_IDENTITY_HMAC_KEY`, `JILU_SUBJECT_DERIVATION_KEY`
- `JILU_CAPTURE_TICKET_KEYS`, `JILU_PROVENANCE_RECEIPT_KEYS`
- `JILU_TEMPLATE_PACKAGE_KEYS`, `JILU_TEMPLATE_LEASE_KEYS`
- `JILU_TEMPLATE_DOWNLOAD_TOKEN_KEY`
- `TENCENT_MAP_KEY` and optional `TENCENT_MAP_SECRET`
- `ALLOWED_ORIGIN=https://shuiyin.nnu.cn`
- optional `ADMIN_TOKEN` for the template administration compatibility endpoints

Key-list variables are JSON arrays. Private signing material must only be present in the corresponding server-side signing key configuration; public-key responses expose only active public material.

## Routes

`edge-functions/[[default]].js` is the Makers root multi-level dynamic route. It closes identity, location, template runtime, V2 registration/verification, V3 verification exchange and template administration paths. Exact files such as `/health` and `/v2/capture-ticket` remain valid and take precedence.

## Build and smoke test

Run:

```bash
npm ci
npm test
npm run edgeone:build
```

Deploy `dist/`, then verify:

```bash
curl -i https://YOUR_DOMAIN/health
curl -i -X OPTIONS https://YOUR_DOMAIN/v3/provenance/verify/prepare \
  -H "Origin: https://shuiyin.nnu.cn" \
  -H "Access-Control-Request-Method: POST"
```

After configuring a valid mini-program login and storage bindings, test `/v2/auth/wechat`, `/v2/location/reverse`, `/v2/capture-ticket`, `/v2/provenance/register`, both V3 verification endpoints, and the template catalog/download/preview/lease flow.
