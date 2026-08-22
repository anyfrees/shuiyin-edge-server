# Security

EdgeOne KV is not a one-time-consume primitive. Phase 8C uses Makers Blob conditional create/strong read or D1 uniqueness. Receipt secrets exist only in `JILU_PROVENANCE_RECEIPT_KEYS`; responses and logs exclude private material.

Tencent Map Key rotation is **EXTERNAL ACTION REQUIRED** and remains pending until the old console credential is disabled or deleted.

Store `WECHAT_APP_SECRET`, `TENCENT_MAP_KEY`, and optional `TENCENT_MAP_SECRET` as EdgeOne/Cloudflare runtime secrets. Never log environment values or full upstream URLs because those URLs contain the Tencent Key.

The reverse-geocoder authenticates the WeChat subject, rate-limits by subject plus IP, rounds coordinates for a bounded cache key, and returns only sanitized place data. Optional SK signing is computed server-side.
