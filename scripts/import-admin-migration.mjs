import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const [endpoint, file] = process.argv.slice(2)
const token = process.env.ADMIN_MIGRATION_TOKEN
if (!endpoint || !file || !token) {
  console.error('用法: 设置 ADMIN_MIGRATION_TOKEN 后运行 node scripts/import-admin-migration.mjs <Edge API 根地址> <迁移 JSON>')
  process.exit(2)
}
const raw = await readFile(file, 'utf8')
const signature = createHmac('sha256', token).update(raw).digest('base64url')
const response = await fetch(`${endpoint.replace(/\/$/, '')}/admin/v1/console/migration/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-migration-signature': signature }, body: raw })
const result = await response.json().catch(() => ({ ok: false, code: `HTTP_${response.status}` }))
if (!response.ok) { console.error(JSON.stringify({ status: response.status, code: result.code })); process.exit(1) }
console.log(JSON.stringify({ status: response.status, ...result }))
