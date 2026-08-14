# 水印验证边缘服务

为“迹录相机”小程序提供照片水印注册、盲标记验真、视觉相似验真和水印完整性检查。一个代码库可部署到 Cloudflare Workers 或 EdgeOne Makers，API 与现有验证服务保持一致。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/anyfrees/shuiyin-edge-server)
[![Deploy to EdgeOne](https://edgeone.ai/media/34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b.png)](https://edgeone.ai/pages/new?repository-url=https://github.com/anyfrees/shuiyin-edge-server)

## 接口

- `GET /health`：运行状态
- `POST /api/photo-provenance`：`register-hash`、`authorize-wechat-share`、`verify`、`verify-watermark`、`verify-watermark-integrity`

请求体上限为 64 KiB。记录默认保留 365 天。底层使用边缘 KV，数据为最终一致，跨区域更新和验真次数统计可能有短暂延迟。

## Cloudflare Workers

1. 执行 `npm ci`。
2. 设置微信密钥：`npx wrangler secret put WECHAT_APP_SECRET`。
3. 按需修改 `wrangler.jsonc` 中的 `WECHAT_APP_ID` 和 `ALLOWED_ORIGIN`。
4. 执行 `npm run cf:deploy`。首次部署时 Wrangler 会为 `PROVENANCE_KV` 自动配置 KV 命名空间。

本地开发可将 `.dev.vars.example` 复制为 `.dev.vars`，然后运行 `npm run cf:dev`。

## EdgeOne Makers

1. 在 EdgeOne Pages/Makers 中导入本仓库；`edgeone.json` 已声明构建命令和 `dist` 输出目录。
2. 创建 KV 命名空间，并将变量名绑定为 `PROVENANCE_KV`。
3. 配置环境变量 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 和 `ALLOWED_ORIGIN`。
4. 触发部署。之后连接的 GitHub 分支每次推送都会自动构建。

EdgeOne 入口位于 `edge-functions/`；Cloudflare 入口位于 `src/cloudflare.js`，业务逻辑共用 `src/core.js`。

## 本地校验

```bash
npm ci
npm test
npm run edgeone:build
npm run check
```

微信 App Secret 只应通过平台 Secret/环境变量设置，不要提交到仓库。
