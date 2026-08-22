# Cloudflare deployment

Apply `migrations/0002_provenance_v2.sql` to the configured `PROVENANCE_D1` before deployment. Store the real `JILU_PROVENANCE_RECEIPT_KEYS` with Wrangler secrets; never put it in `wrangler.jsonc`.

Use `wrangler secret put` for `WECHAT_APP_SECRET` and `TENCENT_MAP_KEY`; configure `TENCENT_MAP_SECRET` only when SK verification is enabled. Do not put real values in `wrangler.jsonc` or `.dev.vars.example`.

Run `npm ci`, `npm test`, and `npm run check` before deployment. This alternative deployment must not dual-write production data with EdgeOne.
