# 腾讯云 EdgeOne Pages / Makers 部署指南

本文说明如何把 `shuiyin-edge-server` 部署到腾讯云 EdgeOne Pages / Makers，并为“迹录相机”小程序提供身份认证、定位解析、模板服务和照片验真能力。

当前服务版本：`1.1.0`。

> 请勿把微信密钥、管理令牌或任何私钥提交到 Git。本文中的值均为示例，真实值只能保存在 EdgeOne 项目的环境变量或 Secret 中。

## 1. 部署后的能力

| 能力 | 主要接口 |
| --- | --- |
| 服务状态 | `GET /health` |
| 微信登录与会话 | `POST /v2/auth/wechat`、`POST /v2/auth/logout` |
| 用户绑定码 | `POST /v1/auth/binding-code` |
| 腾讯地图逆地址解析 | `POST /v2/location/reverse` |
| 拍摄票据 | `POST /v2/capture-ticket` |
| V2 照片注册与验真 | `POST /v2/provenance/register`、`POST /v2/provenance/verify` |
| V3 分阶段验真 | `POST /v3/provenance/verify/prepare`、`POST /v3/provenance/verify` |
| 公钥发布 | `GET /v2/public-keys` |
| 模板目录与详情 | `/v1/templates/catalog`、`/v1/templates/detail` |
| 模板下载与预览 | `/v1/templates/download-token`、`/v1/templates/package/:id`、`/v1/templates/preview/:id` |
| 离线模板租约 | `/v1/templates/lease`、`/v1/templates/lease/renew` |
| 模板及授权管理 | `/admin/v1/*`、`/admin/v1/console/*` |

旧接口 `/api/photo-provenance` 已停用，固定返回 HTTP 410，不能再作为小程序 API 地址使用。

## 2. 部署前准备

需要准备：

1. 可登录的腾讯云账号，并已开通 EdgeOne Pages / Makers。
2. 可访问仓库 `https://github.com/anyfrees/shuiyin-edge-server` 的 GitHub 账号。
3. 微信小程序的 AppID 和 AppSecret。
4. 腾讯位置服务 WebService Key；如果 Key 开启了签名校验，还需要对应 Secret Key。
5. 身份派生、下载令牌及 Ed25519 签名所需的安全密钥。
6. 一个独立测试 API 域名，例如 `test.shuiyin.nnu.cn`。测试 Web 使用 `web.shuiyin.nnu.cn`；生产验收前不要修改 `api.shuiyin.nnu.cn`。

建议先在测试环境部署，验证通过后再绑定生产域名。

## 3. Makers 构建配置

在 EdgeOne Pages / Makers 中选择“从 Git 仓库导入”，连接 GitHub 后选择：

```text
仓库：anyfrees/shuiyin-edge-server
分支：main
```

仓库根目录的 `edgeone.json` 已包含构建配置，一般不需要手动修改：

```json
{
  "installCommand": "npm ci",
  "buildCommand": "npm run edgeone:build",
  "outputDirectory": "dist",
  "nodeVersion": "22.11.0"
}
```

如果控制台要求手动填写，请保持一致：

| 项目 | 值 |
| --- | --- |
| 根目录 | 仓库根目录 |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run edgeone:build` |
| 输出目录 | `dist` |
| Node.js | `22.11.0` 或兼容的 Node.js 22 |

不要把输出目录设置为 `edge-functions`。构建脚本会把运行代码和 Edge Functions 一起复制到 `dist`。

## 4. 创建并绑定存储资源

服务需要一个 KV 和两个相互独立的 Blob 命名空间。KV 在控制台绑定；Blob 使用腾讯云官方 `@edgeone/pages-blob` SDK，首次调用 `getStore()` 时自动创建，无需在控制台手工绑定。

### 4.1 `PROVENANCE_KV`

类型：EdgeOne KV。

用途：用户身份和登录会话、模板元数据、用户组与模板授权、辅助索引及短期缓存。

绑定变量名：

```text
PROVENANCE_KV
```

### 4.2 权威验真 Blob

类型：EdgeOne Makers Blob，默认命名空间为 `jilu-provenance`。

用途：保存照片注册的权威记录、消费票据状态和验真索引。

如需自定义命名空间名称，可设置：

```text
PROVENANCE_BLOB_STORE=jilu-provenance
```

该存储必须支持仅在对象不存在时写入（`onlyIfNew`）以及冲突后的强一致读取。不能只配置 KV 代替它，否则注册接口会返回：

```text
503 AUTHORITATIVE_PROVENANCE_STORAGE_NOT_CONFIGURED
```

### 4.3 模板 Blob

类型：另一个独立的 EdgeOne Makers Blob，默认命名空间为 `jilu-templates`。

用途：保存模板安装包、模板背景资源和预览图片。

如需自定义命名空间名称，可设置：

```text
TEMPLATE_BLOB_STORE=jilu-templates
```

两个命名空间应保持分离，便于权限隔离、容量统计和故障排查。部署后首次触发相关 API，命名空间才会显示在控制台 Blob 页面。

## 5. 配置环境变量和 Secret

在 Makers 项目的“环境变量”“Secret”或“资源绑定”页面配置。生产环境和预览环境通常需要分别设置。

### 5.1 必需变量

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `WECHAT_APP_ID` | 普通变量 | 微信小程序 AppID |
| `WECHAT_APP_SECRET` | Secret | 微信小程序 AppSecret |
| `ALLOWED_ORIGIN` | 普通变量 | 允许访问 API 的 Web 来源；测试环境填写 `https://web.shuiyin.nnu.cn`，多个来源用英文逗号分隔 |
| `ADMIN_ORIGIN` | 普通变量 | Passkey 允许的精确来源；测试环境填写 `https://web.shuiyin.nnu.cn` |
| `ADMIN_WEBAUTHN_RP_ID` | 普通变量 | 建议保持 `shuiyin.nnu.cn`，以便子域共享同一 RP 范围 |
| `ADMIN_BOOTSTRAP_TOKEN` | 加密变量 | 首次部署一次性初始化密钥，至少 32 字节随机值；创建首位管理员后入口自动关闭 |
| `JILU_IDENTITY_HMAC_KEY` | Secret | 登录会话和身份数据的 HMAC 密钥 |
| `JILU_SUBJECT_DERIVATION_KEY` | Secret | 将微信身份派生为内部用户标识的密钥 |
| `JILU_CAPTURE_TICKET_KEYS` | Secret | 拍摄票据 Ed25519 密钥列表，JSON 数组 |
| `JILU_PROVENANCE_RECEIPT_KEYS` | Secret | 照片注册回执 Ed25519 密钥列表，JSON 数组 |
| `JILU_TEMPLATE_PACKAGE_KEYS` | Secret | 模板包签名与验签密钥列表，JSON 数组 |
| `JILU_TEMPLATE_LEASE_KEYS` | Secret | 离线模板租约签名密钥列表，JSON 数组 |
| `JILU_TEMPLATE_DOWNLOAD_TOKEN_KEY` | Secret | 模板短期下载令牌密钥 |

三个普通字符串密钥应使用彼此不同、足够长的随机值，不要复用密码或微信 AppSecret。

### 5.2 腾讯位置服务

| 变量 | 类型 | 说明 |
| --- | --- | --- |
| `TENCENT_MAP_KEY` | Secret | 腾讯位置服务 WebService Key |
| `TENCENT_MAP_SECRET` | Secret | 可选；Key 开启 SK 签名校验时填写 |

逆地址解析由服务端调用腾讯位置服务。不要把 Key 或 Secret 写入小程序代码。

### 5.3 可选变量

| 变量 | 推荐值 | 说明 |
| --- | --- | --- |
| `PROVENANCE_VERIFY_RATE_LIMIT` | `60` | 单个限流维度每分钟允许的验真请求数 |
| `PROVENANCE_BLOB_STORE` | `jilu-provenance` | 权威验真 Blob 命名空间，可不设置 |
| `TEMPLATE_BLOB_STORE` | `jilu-templates` | 模板 Blob 命名空间，可不设置 |
| `ADMIN_TOKEN` | 随机高强度值 | 旧管理兼容接口使用；生产管理流程需要时配置 |
| `ENVIRONMENT` | `production` | 运行环境标识和诊断信息 |

### 5.4 Ed25519 密钥列表格式

四个 `*_KEYS` 变量必须填写为合法 JSON 数组，而不是普通逗号分隔文本。单行示例：

```json
[{"keyId":"capture-2026-01","purpose":"capture-ticket-signing","status":"ACTIVE","privateKey":"BASE64_PKCS8_PRIVATE_KEY","publicKey":"BASE64_RAW_PUBLIC_KEY"}]
```

常用 purpose：

| 变量 | `purpose` |
| --- | --- |
| `JILU_CAPTURE_TICKET_KEYS` | `capture-ticket-signing` |
| `JILU_PROVENANCE_RECEIPT_KEYS` | `provenance-receipt-signing` |
| `JILU_TEMPLATE_PACKAGE_KEYS` | `template-package-signing` |
| `JILU_TEMPLATE_LEASE_KEYS` | `template-entitlement-lease` |

密钥状态：

- `ACTIVE`：当前用于签名和验签；每种用途应只保留一个活动密钥。
- `VERIFY_ONLY`：不签发新数据，只验证历史数据，用于密钥轮换。
- `RETIRED`：完全停用，不再对外发布。

`privateKey` 使用 Base64 编码的 PKCS#8 Ed25519 私钥，`publicKey` 使用 Base64 编码的 Raw Ed25519 公钥。私钥只能存在于服务端 Secret；`GET /v2/public-keys` 不应返回私钥。

尚未启用的密钥列表可临时填写合法空数组 `[]`，但依赖它签发的接口无法正常工作，正式验收前必须配置对应的 `ACTIVE` 密钥。

## 6. 配置检查表

```text
[ ] GitHub 仓库为 anyfrees/shuiyin-edge-server
[ ] 部署分支为 main
[ ] 构建输出目录为 dist
[ ] PROVENANCE_KV 已绑定
[ ] 首次验真请求后 jilu-provenance Blob 自动创建
[ ] 首次模板存储请求后 jilu-templates Blob 自动创建
[ ] WECHAT_APP_ID 与当前小程序一致
[ ] WECHAT_APP_SECRET 已作为 Secret 保存
[ ] 身份 HMAC 与 Subject 派生密钥已分别配置
[ ] 拍摄票据和注册回执均有 ACTIVE 签名密钥
[ ] 模板包和离线租约密钥已配置
[ ] 模板下载令牌密钥已配置
[ ] 腾讯位置服务 Key 已配置
[ ] ALLOWED_ORIGIN 使用完整 HTTPS 来源且末尾无多余路径
[ ] 测试 API 绑定 test.shuiyin.nnu.cn，测试 Web 绑定 web.shuiyin.nnu.cn
[ ] 未把 admin/admin 或其他固定弱密码写入代码、文档或环境变量
[ ] 生产和预览环境均配置了各自需要的变量与绑定
```

## 7. 路由工作方式

`edge-functions/[[default]].js` 是根级多层动态路由，负责把身份、定位、模板、V2/V3 验真以及管理后台接口统一交给 `src/core.js`。

以下精确路由文件仍然保留，并优先于动态路由：

- `/health`
- `/api/photo-provenance`
- `/v2/capture-ticket`
- `/v2/public-keys`
- `/v2/provenance/register`

不要删除 `[[default]].js`。如果它没有进入构建产物，`/v3/*`、模板动态下载和部分管理接口会返回 404。

## 8. 部署前本地检查

在仓库根目录执行：

```bash
npm ci
npm test
npm run edgeone:build
```

预期结果：测试全部通过；终端显示 `EdgeOne output created in dist/`；`dist/edge-functions/[[default]].js` 存在。

如同时维护 Cloudflare 版本，可再执行：

```bash
npm run check
```

该命令包含 TypeScript 检查和 Cloudflare dry-run，不会正式发布。

## 9. 首次部署

### 9.1 首次管理员初始化

全新数据空间不会内置 `admin/admin`。打开测试管理台后，页面检测到尚无管理员时会显示“首次部署初始化”。输入部署时配置的 `ADMIN_BOOTSTRAP_TOKEN`、自定义账号和不少于 12 位的新密码。首位超级管理员创建成功后，该接口永久返回 `BOOTSTRAP_CLOSED`。

完成登录后，可在“安全与会话 → 完整备份与恢复”导出迁移文件。导出内容包含管理员、通行密钥、用户、用户备注、用户组、授权、模板配置、索引、审计和模板资源包；恢复时配置记录每 50 条提交一次，模板包逐个提交，以避开 EdgeOne 单请求 1 MB 限制。备份含密码哈希、TOTP 密文等敏感管理数据，必须存放在受控位置。

导入和导出期间管理台会显示全屏进度：导出依次汇总配置、下载模板包并生成文件；恢复依次上传模板包、写入用户与授权，最后恢复管理员。不要在进度完成前关闭页面。容器版和 Edge 版使用相同的 `jilu-admin-backup` 第 1 版格式，可以双向迁移。环境变量、域名、Secret、KV/Blob 绑定和临时会话不在备份内，目标环境仍须单独配置。

如果管理员已经删除密码，必须先使用通行密钥登录，再到“安全与会话 → 新增密码”设置新密码；此流程以当前 Passkey 会话作为身份验证，不再要求不存在的旧密码。仍有密码时，修改密码依旧需要验证当前密码。

用户目录中的“手动授权用户”和“自动上线用户”是智能目录，不会创建额外权限组：存在直接模板授权的用户进入前者，仅通过小程序登录且尚无直接授权的用户进入后者。用户卡片可直接授权、撤销、编辑备注和加入分组。超级管理员可清除历史审计，清除动作本身会保留一条记录；建议清除前先导出备份。

从现有生产服务迁移时，先登录仍指向 `api.shuiyin.nnu.cn` 的管理台并导出完整备份。传统服务只显示“导出”，不会在原库上执行覆盖恢复。随后打开 `web.shuiyin.nnu.cn`，确认其 API 请求指向 `test.shuiyin.nnu.cn`，登录测试 EdgeOne 管理台后选择该备份恢复。恢复完成后重新登录，并逐项验收管理员、用户、用户组、授权、模板预览和模板安装。生产 DNS 在全部验收通过前保持不变。

1. 完成构建配置、资源绑定和环境变量配置。
2. 在 Makers 控制台触发“重新部署”或“部署最新提交”。
3. 确认构建日志中 `npm ci` 和 `npm run edgeone:build` 均成功。
4. 确认部署产物目录为 `dist`。
5. 先使用平台测试域名检查，再绑定生产 API 域名。

当前最低部署版本：

```text
branch: main
commit: 920192d 或更新版本
serviceVersion: 1.1.0
```

## 10. 部署后验证

将 `YOUR_DOMAIN` 替换为实际 API 域名。

### 10.1 健康检查

```bash
curl -i https://YOUR_DOMAIN/health
```

应返回 HTTP 200，并包含：

```json
{
  "ok": true,
  "service": "jilu-photo-provenance-edge",
  "serviceVersion": "1.1.0",
  "platform": "edgeone-makers"
}
```

如果版本不是 `1.1.0`，说明 Makers 仍在运行旧构建或部署分支选错。

### 10.2 CORS 预检

```bash
curl -i -X OPTIONS https://YOUR_DOMAIN/v3/provenance/verify/prepare \
  -H "Origin: https://shuiyin.nnu.cn" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization, Content-Type"
```

预期为 HTTP 204，`Access-Control-Allow-Origin` 应与 `ALLOWED_ORIGIN` 一致。

### 10.3 路由检查

缺少业务参数时可以返回 400、401 或 503，但不应该返回 Makers 的 HTML 404 页面：

```bash
curl -i -X POST https://YOUR_DOMAIN/v2/auth/wechat \
  -H "Content-Type: application/json" \
  --data '{}'

curl -i -X POST https://YOUR_DOMAIN/v3/provenance/verify/prepare \
  -H "Content-Type: application/json" \
  --data '{}'
```

### 10.4 真机业务验收顺序

1. 小程序微信登录成功。
2. `/v2/location/reverse` 可以返回定位信息。
3. `/v2/capture-ticket` 可以签发在线和离线票据。
4. 拍照后 `/v2/provenance/register` 注册成功。
5. `/v3/provenance/verify/prepare` 与 `/v3/provenance/verify` 完整通过。
6. 模板目录、详情和预览正常加载。
7. 模板下载令牌与安装包下载正常。
8. 已授权模板可以签发和续期离线租约。
9. 管理端发布、授权后，小程序可以看到并安装对应模板。

## 11. 域名和小程序配置

部署验证通过后，将生产 API 域名绑定到 Makers 项目并配置 HTTPS。

同时在微信公众平台的小程序后台配置：

- request 合法域名：实际 API HTTPS 域名；
- downloadFile 合法域名：模板包和预览图最终使用的 HTTPS 域名；
- uploadFile 合法域名：若存在直接上传流程，则配置对应域名。

小程序 API Base URL 必须指向 Makers API 域名，不能指向 GitHub 地址、Makers 控制台地址或已退休的 `/api/photo-provenance`。

## 12. 常见故障

### 12.1 `/health` 返回 404 或 HTML

可能原因：输出目录不是 `dist`、构建失败后回退为静态站点、部署目录错误，或项目仍关联旧分支/旧提交。检查构建日志、部署提交和 `dist/edge-functions/health.js`。

### 12.2 V3、模板动态路径或管理接口返回 404

确认 `dist/edge-functions/[[default]].js` 存在并重新执行完整构建，不能只上传静态文件。

### 12.3 返回 401

说明路由已经工作，但认证失败。检查 AppID/AppSecret、小程序 Session Token、预览与生产环境 Secret，以及服务器时间。

### 12.4 返回 `AUTHORITATIVE_PROVENANCE_STORAGE_NOT_CONFIGURED`

检查 Makers Functions 是否成功加载 `@edgeone/pages-blob`，以及 `jilu-provenance` 命名空间是否在首次请求后自动出现。不能用 `PROVENANCE_KV` 代替权威 Blob。

### 12.5 返回 `PROVENANCE_STORAGE_NOT_CONFIGURED`

V2/V3 验真找不到权威注册存储。确认部署版本已包含 Makers Blob SDK 适配，并且注册和验真使用同一个 `PROVENANCE_BLOB_STORE` 名称。

### 12.6 模板目录能打开，但预览或安装失败

检查 `jilu-templates` 命名空间、模板包与预览对象、模板包签名密钥、下载令牌密钥、微信下载合法域名，以及模板元数据版本与对象路径。

### 12.7 小程序显示“离线模式”或连接很慢

先访问 `/health`，再检查小程序 API Base URL、微信合法域名、DNS/HTTPS、CORS、Makers 请求日志中的 401/404/429/5xx，以及模板文件是否通过 Blob 下载路径获取。

### 12.8 位置解析返回 `LOCATION_SERVICE_UNAVAILABLE`

未配置 `TENCENT_MAP_KEY`。若上游提示签名错误，再检查 `TENCENT_MAP_SECRET` 和腾讯位置服务控制台的 SK 校验设置。

### 12.9 JSON 密钥配置后仍无法签发

常见原因包括：JSON 外面又套了一层引号、使用中文引号、存在尾逗号或注释、没有 `ACTIVE` 密钥、密钥格式错误，或不同用途的密钥互相混用。

## 13. 更新与回滚

### 更新

1. 确认 GitHub `main` 已包含目标提交。
2. 在 Makers 中选择“部署最新提交”。
3. 部署后访问 `/health` 核对 `serviceVersion`。
4. 完成登录、模板下载和一组照片注册/验真的冒烟测试。

### 回滚

出现生产故障时，应在 Makers 部署记录中回滚到上一个已验证构建，不要清空 KV 或 Blob。回滚代码不会自动回滚数据，执行数据迁移前必须单独备份并制定恢复方案。

## 14. 密钥轮换

1. 新增一个 `ACTIVE` 密钥。
2. 将旧活动密钥改为 `VERIFY_ONLY`。
3. 部署并确认新数据使用新 `keyId`，旧数据仍可验证。
4. 等待旧票据、回执或租约超过最长有效期。
5. 再将旧密钥改为 `RETIRED`，最终移除私钥。

不要直接删除仍在验证有效期内的旧公钥，否则离线票据、历史照片回执或模板租约会突然失效。

## 15. 安全和运维要求

- 生产 Secret 只存放在平台密钥管理中。
- 生产、测试环境使用不同密钥和不同存储。
- 不记录 AppSecret、私钥、Session Token、完整下载令牌或腾讯地图 Secret。
- 定期检查请求错误率、Blob 容量、KV 使用量和接口延迟。
- 分别统计 401、403、409、429、503，不要只看总 5xx。
- 不要手工删除 `jilu-provenance` 中的权威记录和票据消费对象。

## 16. 完成标准

```text
BUILD: PASS
HEALTH: 200 / serviceVersion 1.1.0
ROUTING: V2/V3/TEMPLATE/ADMIN 无平台 404
AUTH: 微信登录成功
STORAGE: KV 已绑定，两个 Makers Blob 命名空间已自动创建
PROVENANCE: 注册及 V3 验真成功
TEMPLATE: 目录、预览、下载、安装、离线租约成功
LOCATION: 腾讯逆地址解析成功
CORS: Web 管理端来源通过
MINI PROGRAM: 真机请求域名与下载域名通过
```

完成后再将生产 API 域名写入小程序正式环境配置并发布版本。
