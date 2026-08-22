# 水印验证边缘服务

Phase 8C uses Cloudflare D1 atomic batch/uniqueness or EdgeOne Makers Blob immutable `onlyIfNew` commits with strong conflict reads. `PROVENANCE_KV` remains auxiliary and must never decide ticket consumption. ESA without authoritative persistence returns a 503 capability error.

Keep only `JILU_PROVENANCE_RECEIPT_KEYS=[]` in examples. EdgeOne writes one authoritative object and about 11 secondary objects. At roughly 10–20 KiB per record/commit, 1 GiB is approximately 50,000–100,000 registrations before index overhead.

为“迹录相机”小程序提供照片水印注册、盲标记验真、视觉相似验真和水印完整性检查。一个代码库可部署到 Cloudflare Workers 或 EdgeOne Makers，API 与现有验证服务保持一致。

## 腾讯位置服务 Secret

`POST /v2/location/reverse` 由服务端调用腾讯位置服务；小程序不持有 Key，也不直连 `apis.map.qq.com`。

```text
TENCENT_MAP_KEY=
TENCENT_MAP_SECRET=
```

`TENCENT_MAP_SECRET` 仅在腾讯 WebService 签名校验启用时配置。真实值不得写入 Git、前端、API 响应或日志。接口使用 Subject+IP 限流，并缓存经过清理的逆地址结果。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/anyfrees/shuiyin-edge-server)
[![Deploy to EdgeOne](https://edgeone.ai/media/34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b.png)](https://edgeone.ai/pages/new?repository-url=https://github.com/anyfrees/shuiyin-edge-server)

## 接口

- `GET /health`：运行状态
- `/api/photo-provenance`：已退休，固定返回 HTTP 410 `LEGACY_PROVENANCE_RETIRED`；不再读取或写入 V1 记录。

请求体上限为 64 KiB。记录默认保留 365 天。底层使用边缘 KV，数据为最终一致，跨区域更新和验真次数统计可能有短暂延迟。

## Cloudflare Workers

1. 执行 `npm ci`。
2. 设置微信密钥：`npx wrangler secret put WECHAT_APP_SECRET`。
3. 按需修改 `wrangler.jsonc` 中的 `WECHAT_APP_ID` 和 `ALLOWED_ORIGIN`。
4. 执行 `npm run cf:deploy`。首次部署时 Wrangler 会为 `PROVENANCE_KV` 自动配置 KV 命名空间。

本地开发可将 `.dev.vars.example` 复制为 `.dev.vars`，然后运行 `npm run cf:dev`。

## EdgeOne Makers

1. 在 EdgeOne Makers 中导入本仓库；`edgeone.json` 已声明构建命令和 `dist` 输出目录。
2. 创建并绑定 `PROVENANCE_KV`；两个 Blob 命名空间由官方 `@edgeone/pages-blob` SDK 在首次请求时自动创建。
3. 按 [DEPLOY_EDGEONE.md](DEPLOY_EDGEONE.md) 配置身份、验真、模板签名、腾讯位置服务和 CORS 环境变量。
4. 触发部署。之后连接的 GitHub 分支每次推送都会自动构建。

EdgeOne 入口位于 `edge-functions/`；根级 `[[default]].js` 承接所有多层动态 API。Cloudflare 入口位于 `src/cloudflare.js`，业务逻辑共用 `src/core.js`。

## 本地校验

```bash
npm ci
npm test
npm run edgeone:build
npm run check
```

微信 App Secret 只应通过平台 Secret/环境变量设置，不要提交到仓库。
