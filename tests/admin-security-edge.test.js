import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { createEdgeAdminHandler } from '../src/admin-security-edge.js'

class Kv {
  constructor() { this.data = new Map(); this.failNextAudit = false }
  async get(key) { return this.data.get(key) ?? null }
  async put(key, value) { if(this.failNextAudit&&key.startsWith('admin:audit:')){this.failNextAudit=false;throw new Error('AUDIT_WRITE_FAILED')}this.data.set(key, value) }
  async delete(key) { this.data.delete(key) }
  async list({ prefix = '', limit = 100 }) { if(limit>256)throw new Error('KV_LIMIT_EXCEEDED');return { keys: [...this.data.keys()].filter(key => key.startsWith(prefix)).slice(0,limit).map(name => ({ name })), list_complete: true } }
}
const migration = async password => {
  const salt = new Uint8Array(16); crypto.getRandomValues(salt)
  const hash = Buffer.from(await argon2idAsync(password, salt, { t: 1, m: 1024, p: 1, dkLen: 32 })).toString('base64url'), encoded = `$argon2id$v=19$m=1024,t=1,p=1$${Buffer.from(salt).toString('base64url')}$${hash}`
  return JSON.stringify({ schemaVersion: 1, migrationId: 'mig_test', principals: [{ adminId: 'adm_test', username: 'admin', displayName: '管理员', status: 'ACTIVE', authzEpoch: 1, passwordHash: encoded, roles: ['SUPER_ADMIN'], templateScopes: [], groupScopes: [], passkeys: [], recoveryCodes: [], createdAt: 1, updatedAt: 1 }], audits: [] })
}
const invoke = (handler, path, { method = 'GET', body, headers = {} } = {}) => handler(new Request(`https://api.example${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }))

test('signed migration preserves an Argon2 password and issues a CSRF-bound admin session', async () => {
  let forwardedAuthorization='',forwardedActor='';const forwarded=[]
  const kv = new Kv(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ADMIN_CREDENTIAL_KEY: 'test-admin-credential-key-at-least-32-bytes', ADMIN_WEBAUTHN_RP_ID: 'example', ADMIN_ORIGIN: 'https://example', ENVIRONMENT: 'test' }, handler = createEdgeAdminHandler({ kv, env, forwardToken:'internal-only', forward:async request=>{forwardedAuthorization=request.headers.get('authorization');forwardedActor=request.headers.get('x-jilu-admin-actor');forwarded.push({path:new URL(request.url).pathname,method:request.method,body:['GET','DELETE'].includes(request.method)?null:await request.json()});if(new URL(request.url).pathname.endsWith('/groups')&&request.method==='POST')return Response.json({ok:true,group:{groupId:'grp_test',name:'测试组'}},{status:201});return Response.json({ok:true,items:[]})} }), raw = await migration('correct horse battery staple'), signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url')
  let response = await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  assert.equal(response.status, 201)
  response = await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'correct horse battery staple' } })
  assert.equal(response.status, 200)
  const login = await response.json(), sessionCookie = response.headers.get('set-cookie').split(';')[0]
  response = await invoke(handler, '/admin/v1/console/me', { headers: { cookie: sessionCookie } })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).admin.superAdmin, true)
  await kv.put('subject_sub_test',JSON.stringify({subjectId:'sub_test',publicId:'JL-TEST01',status:'active',internal:false,createdAt:1,lastSeenAt:2}))
  await kv.put('public_JL-TEST01','sub_test')
  response=await invoke(handler,'/admin/v1/console/dashboard',{headers:{cookie:sessionCookie}})
  assert.equal(response.status,200)
  response=await invoke(handler,'/admin/v1/console/subjects',{headers:{cookie:sessionCookie}})
  assert.equal(response.status,200);assert.equal((await response.json()).items[0].publicId,'JL-TEST01')
  response=await invoke(handler,'/admin/v1/console/subjects/JL-TEST01/access',{headers:{cookie:sessionCookie}})
  assert.equal(response.status,200);assert.equal((await response.json()).subject.publicId,'JL-TEST01')
  response=await invoke(handler,'/admin/v1/console/templates',{headers:{cookie:sessionCookie}})
  assert.equal(response.status,200);assert.equal(forwardedAuthorization,'Bearer internal-only');assert.equal(forwardedActor,'adm_test')
  const mutationHeaders={cookie:sessionCookie,'x-csrf-token':login.csrfToken}
  await kv.put('submission:record:sub_missing_publish',JSON.stringify({submissionId:'sub_missing_publish',subjectId:'sub_test',status:'PENDING',packageChunks:1,packageSize:2}))
  await kv.put('submission:package:sub_missing_publish:0','{}')
  response=await invoke(handler,'/admin/v1/console/submissions/sub_missing_publish/approve',{method:'POST',body:{templateId:'tpl_missing_publish'},headers:mutationHeaders});assert.equal(response.status,409);assert.equal((await response.json()).code,'SUBMISSION_TEMPLATE_NOT_PUBLISHED');assert.equal(JSON.parse(await kv.get('submission:record:sub_missing_publish')).status,'PENDING');assert.equal(await kv.get('submission:package:sub_missing_publish:0'),'{}')
  await kv.put('te_tpl_tpl_publish_ok',JSON.stringify({templateId:'tpl_publish_ok',latestVersion:1,contributionType:'USER_SUBMISSION',creatorPublicId:'JL-TEST01'}));await kv.put('te_ver_tpl_publish_ok_1',JSON.stringify({templateId:'tpl_publish_ok',templateVersion:1,status:'PUBLISHED'}));await kv.put('submission:record:sub_publish_ok',JSON.stringify({submissionId:'sub_publish_ok',subjectId:'sub_test',status:'PENDING',packageChunks:1,packageSize:2}));await kv.put('submission:package:sub_publish_ok:0','{}');kv.failNextAudit=true
  response=await invoke(handler,'/admin/v1/console/submissions/sub_publish_ok/approve',{method:'POST',body:{templateId:'tpl_publish_ok'},headers:mutationHeaders});assert.equal(response.status,200);assert.equal((await response.json()).status,'APPROVED');assert.equal(JSON.parse(await kv.get('submission:record:sub_publish_ok')).status,'APPROVED')
  response=await invoke(handler,'/admin/v1/console/backup/status',{headers:{cookie:sessionCookie}});const backupStatus=await response.json();assert.equal(backupStatus.available,true);assert.equal(backupStatus.canExport,true);assert.equal(backupStatus.sections.includes('packages'),false)
  response=await invoke(handler,'/admin/v1/console/administrators',{method:'POST',body:{username:'delete.me',password:'temporary password 123',displayName:'待删除',roles:['AUDITOR'],templateScopes:[],groupScopes:[]},headers:mutationHeaders});const disposable=(await response.json()).admin;assert.equal(response.status,201)
  response=await invoke(handler,`/admin/v1/console/administrators/${disposable.admin_id}`,{method:'DELETE',body:{},headers:mutationHeaders});assert.equal(response.status,204);assert.equal(await kv.get(`admin:principal:${disposable.admin_id}`),null);assert.equal(await kv.get('admin:username:delete.me'),null)
  response=await invoke(handler,'/admin/v1/console/templates/tpl_test/disable',{method:'POST',body:{},headers:mutationHeaders})
  assert.equal(response.status,200);assert.deepEqual(forwarded.at(-1),{path:'/admin/v1/console/templates/tpl_test',method:'PATCH',body:{enabled:false,lifecycleStatus:'DISABLED'}})
  response=await invoke(handler,'/admin/v1/console/templates/tpl_test/grant-user',{method:'POST',body:{publicId:'JL-TEST01'},headers:mutationHeaders})
  assert.equal(response.status,200);assert.equal(forwarded.at(-1).path,'/admin/v1/console/templates/tpl_test/user-grants')
  response=await invoke(handler,'/admin/v1/console/groups',{method:'POST',body:{name:'测试组',initialMembers:['JL-TEST01']},headers:mutationHeaders})
  assert.equal(response.status,201);assert.equal((await response.json()).initialMemberCount,1);assert.deepEqual(forwarded.at(-1),{path:'/admin/v1/console/groups/grp_test/members',method:'POST',body:{subjectId:'sub_test',expiresAt:null}})
  await kv.put('te_audit_0000000000000002_evt_test',JSON.stringify({eventId:'evt_test',actorId:'adm_test',eventType:'GROUP_CREATE',groupId:'grp_test',timestamp:2}))
  response=await invoke(handler,'/admin/v1/console/audit',{headers:{cookie:sessionCookie}})
  assert.equal(response.status,200);assert.equal((await response.json()).items.some(item=>item.event_id==='evt_test'&&item.resource_type==='group'&&item.resource_id==='grp_test'),true)
  response=await invoke(handler,'/admin/v1/console/audit',{method:'DELETE',body:{},headers:mutationHeaders})
  assert.equal(response.status,200);assert.equal((await response.json()).deleted>0,true);assert.equal(await kv.get('te_audit_0000000000000002_evt_test'),null)
  response = await invoke(handler, '/admin/v1/console/auth/logout', { method: 'POST', body: {}, headers: { cookie: sessionCookie, 'x-csrf-token': login.csrfToken } })
  assert.equal(response.status, 204)
})

test('passkey-authenticated Edge administrator can set a new password after removal', async () => {
  const kv = new Kv(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ADMIN_CREDENTIAL_KEY: 'test-admin-credential-key-at-least-32-bytes', ENVIRONMENT: 'test' }
  const raw = await migration('temporary password 123'), signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url'), handler = createEdgeAdminHandler({ kv, env })
  await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  let response = await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'temporary password 123' } })
  const login = await response.json(), cookie = response.headers.get('set-cookie').split(';')[0]
  const principal = JSON.parse(await kv.get('admin:principal:adm_test')); principal.passwordHash = null; await kv.put('admin:principal:adm_test', JSON.stringify(principal))
  const sessionName = [...kv.data.keys()].find(name => name.startsWith('admin:session:')), session = JSON.parse(await kv.get(sessionName)); session.authMethod = 'PASSKEY'; session.authzEpoch = principal.authzEpoch; await kv.put(sessionName, JSON.stringify(session))
  response = await invoke(handler, '/admin/v1/console/password/change', { method: 'POST', body: { newPassword: 'new secure password 123' }, headers: { cookie, 'x-csrf-token': login.csrfToken } })
  assert.equal(response.status, 200)
  response = await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'new secure password 123' } })
  assert.equal(response.status, 200)
})

test('password login is progressively locked by username and client address', async () => {
  const kv = new Kv(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ADMIN_CREDENTIAL_KEY: 'test-admin-credential-key-at-least-32-bytes', ENVIRONMENT: 'test' }
  const raw = await migration('correct horse battery staple'), signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url'), handler = createEdgeAdminHandler({ kv, env })
  await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  for (let attempt = 0; attempt < 5; attempt++) await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'wrong password' }, headers: { 'x-forwarded-for': '198.51.100.8' } })
  const response = await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'correct horse battery staple' }, headers: { 'x-forwarded-for': '198.51.100.8' } }), body = await response.json()
  assert.equal(response.status, 429); assert.equal(body.code, 'ADMIN_LOGIN_RATE_LIMITED'); assert.ok(Number(response.headers.get('retry-after')) > 0)
})

test('migration import fails closed on a bad signature and is idempotent', async () => {
  const kv = new Kv(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ENVIRONMENT: 'test' }, handler = createEdgeAdminHandler({ kv, env }), raw = await migration('correct horse battery staple')
  assert.equal((await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': 'bad' } })).status, 403)
  const signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url')
  assert.equal((await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })).status, 201)
  const repeat = await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  assert.equal(repeat.status, 200); assert.equal((await repeat.json()).alreadyImported, true)
})

test('fresh Edge deployment uses a one-time bootstrap token and never a default password', async () => {
  const kv = new Kv(), env = { ADMIN_BOOTSTRAP_TOKEN: 'one-time-bootstrap-token', ADMIN_CREDENTIAL_KEY: 'test-admin-credential-key-at-least-32-bytes', ENVIRONMENT: 'test' }
  const handler = createEdgeAdminHandler({ kv, env })
  let response = await invoke(handler, '/admin/v1/console/bootstrap/status')
  assert.deepEqual(await response.json(), { ok: true, initialized: false })
  response = await invoke(handler, '/admin/v1/console/bootstrap', { method: 'POST', body: { username: 'admin', password: 'a-unique-password-123', displayName: '初始管理员' }, headers: { 'x-bootstrap-token': 'wrong' } })
  assert.equal(response.status, 403)
  response = await invoke(handler, '/admin/v1/console/bootstrap', { method: 'POST', body: { username: 'admin', password: 'a-unique-password-123', displayName: '初始管理员' }, headers: { 'x-bootstrap-token': env.ADMIN_BOOTSTRAP_TOKEN } })
  assert.equal(response.status, 201)
  const bootstrapAdminId = await kv.get('admin:username:admin')
  const bootstrapPrincipal = JSON.parse(await kv.get(`admin:principal:${bootstrapAdminId}`))
  assert.match(bootstrapPrincipal.passwordHash, /^\$hmac-sha256\$v=1\$/)
  response = await invoke(handler, '/admin/v1/console/bootstrap/status')
  assert.deepEqual(await response.json(), { ok: true, initialized: true })
  response = await invoke(handler, '/admin/v1/console/bootstrap', { method: 'POST', body: { username: 'admin2', password: 'another-password-123', displayName: '管理员 2' }, headers: { 'x-bootstrap-token': env.ADMIN_BOOTSTRAP_TOKEN } })
  assert.equal(response.status, 409)
  response = await handler(new Request('https://test.shuiyin.nnu.cn/admin/v1/console/bootstrap/reset', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bootstrap-token': env.ADMIN_BOOTSTRAP_TOKEN, 'x-bootstrap-reset': 'confirmed' }, body: '{}' }))
  assert.equal(response.status, 200); assert.equal((await response.json()).reset, true)
  response = await invoke(handler, '/admin/v1/console/bootstrap/status')
  assert.deepEqual(await response.json(), { ok: true, initialized: false })
})

test('super admin exports and restores chunked records and template packages', async () => {
  const kv = new Kv(), objects = new Map(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ENVIRONMENT: 'test' }
  const storage = {
    objectRef: (id, version) => `templates/${id}/v${version}/package.jltpkg`,
    async listPackages() { return [...objects.entries()].map(([objectRef, value]) => ({ objectRef, size: value.byteLength })) },
    async getPackage(id, version) { return objects.get(this.objectRef(id, version)) || null },
    async putPackage(id, version, value) { objects.set(this.objectRef(id, version), new Uint8Array(value)) },
  }
  const raw = await migration('correct horse battery staple'), signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url')
  const handler = createEdgeAdminHandler({ kv, env, backupStorage: storage })
  await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  let response = await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'correct horse battery staple' } })
  const login = await response.json(), cookie = response.headers.get('set-cookie').split(';')[0], auth = { cookie, 'x-csrf-token': login.csrfToken }
  await kv.put('subject_sub_backup', JSON.stringify({ subjectId: 'sub_backup', publicId: 'JL-BACKUP' }))
  await kv.put('te_s_tpl_sub_backup_tpl_backup', '1')
  await storage.putPackage('tpl_backup', 1, new Uint8Array([1, 2, 3, 4]))
  response = await invoke(handler, '/admin/v1/console/backup/status', { headers: { cookie } })
  assert.deepEqual(await response.json(), { ok: true, available: true, canExport: true, canRestore: true, packageStorage: true, schemaVersion: 1, sections: ['administrators','users','templates','groups','entitlements','audit','packages'] })
  response = await invoke(handler, '/admin/v1/console/backup/export', { headers: { cookie } })
  const manifest = await response.json()
  assert.equal(manifest.format, 'jilu-admin-backup'); assert.deepEqual(manifest.selection,['administrators','users','templates','groups','entitlements','audit','packages']); assert.equal(manifest.records.some(x => x.name === 'admin:principal:adm_test'), true); assert.equal(manifest.records.some(x => x.name === 'subject_sub_backup'), true); assert.equal(manifest.records.some(x => x.name === 'te_s_tpl_sub_backup_tpl_backup'), true); assert.deepEqual(manifest.packages, [{ templateId: 'tpl_backup', templateVersion: 1 }])
  response = await invoke(handler, '/admin/v1/console/backup/export?sections=users', { headers: { cookie } });const usersOnly=await response.json();assert.deepEqual(usersOnly.selection,['users']);assert.equal(usersOnly.records.some(x=>x.name==='subject_sub_backup'),true);assert.equal(usersOnly.records.some(x=>x.name.startsWith('admin:')),false);assert.deepEqual(usersOnly.packages,[])
  response = await invoke(handler, '/admin/v1/console/backup/packages/tpl_backup/1', { headers: { cookie } })
  const packageBytes = new Uint8Array(await response.arrayBuffer()), packageHash = response.headers.get('x-content-sha256')
  objects.clear(); await kv.delete('subject_sub_backup')
  response = await invoke(handler, '/admin/v1/console/backup/restore/records', { method: 'POST', body: { records: manifest.records.filter(x => x.name === 'subject_sub_backup') }, headers: auth })
  assert.equal(response.status, 200); assert.ok(await kv.get('subject_sub_backup'))
  response = await handler(new Request('https://api.example/admin/v1/console/backup/restore/packages/tpl_backup/1', { method: 'POST', headers: { ...auth, 'content-type': 'application/octet-stream', 'x-content-sha256': packageHash }, body: packageBytes }))
  assert.equal(response.status, 201); assert.deepEqual([...await storage.getPackage('tpl_backup', 1)], [1, 2, 3, 4])
  response = await handler(new Request('https://api.example/admin/v1/console/backup/restore/packages/tpl_backup/1', { method: 'POST', headers: { ...auth, 'content-type': 'application/octet-stream', 'x-content-sha256': await crypto.subtle.digest('SHA-256', new Uint8Array([9])).then(x=>Buffer.from(x).toString('base64url')) }, body: new Uint8Array([9]) }))
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'BACKUP_PACKAGE_CONFLICT')
})

test('admin template listing restores package previews and large mutations are buffered before forwarding', async () => {
  const kv = new Kv(), objects = new Map(), env = { ADMIN_MIGRATION_TOKEN: 'migration-secret', ENVIRONMENT: 'test' }
  const storage = {
    objectRef: (id, version) => `templates/${id}/v${version}/package.jltpkg`,
    async getPackage(id, version) { return objects.get(this.objectRef(id, version)) || null },
  }
  const previewBytes = new Uint8Array([1, 2, 3, 4])
  const previewLayout = { canvasWidth: 320, canvasHeight: 180, fields: [{ fieldId: 'field_title', sample: '现场记录' }] }
  const bundle = { manifest: { layout: { path: 'layout.json', sha256: 'layout-hash', size: 120 }, assets: [{ path: 'assets/preview.png', mimeType: 'image/png' }] }, files: { 'layout.json': Buffer.from(JSON.stringify(previewLayout)).toString('base64url'), 'assets/preview.png': Buffer.from(previewBytes).toString('base64url') } }
  objects.set(storage.objectRef('tpl_preview', 1), new TextEncoder().encode(JSON.stringify(bundle)))
  let forwardedBody = null
  const forward = async request => {
    if (request.method === 'POST') forwardedBody = await request.json()
    return Response.json({ ok: true, items: [{ templateId: 'tpl_preview', latestVersion: 1 }] })
  }
  const raw = await migration('correct horse battery staple'), signature = createHmac('sha256', env.ADMIN_MIGRATION_TOKEN).update(raw).digest('base64url')
  const handler = createEdgeAdminHandler({ kv, env, backupStorage: storage, forward, forwardToken: 'internal-only' })
  await invoke(handler, '/admin/v1/console/migration/import', { method: 'POST', body: raw, headers: { 'x-migration-signature': signature } })
  let response = await invoke(handler, '/admin/v1/console/auth/password', { method: 'POST', body: { username: 'admin', password: 'correct horse battery staple' } })
  const login = await response.json(), cookie = response.headers.get('set-cookie').split(';')[0], auth = { cookie, 'x-csrf-token': login.csrfToken }
  response = await invoke(handler, '/admin/v1/console/templates', { headers: { cookie } })
  const item = (await response.json()).items[0]
  assert.deepEqual(item.preview, previewLayout)
  assert.equal(item.previewImage, 'data:image/png;base64,AQIDBA==')
  const large = { templateVersion: 2, draft: { assets: [{ data: 'a'.repeat(800_000) }] } }
  response = await invoke(handler, '/admin/v1/console/templates/tpl_preview/versions', { method: 'POST', body: large, headers: auth })
  assert.equal(response.status, 200)
  assert.deepEqual(forwardedBody, large)
})
