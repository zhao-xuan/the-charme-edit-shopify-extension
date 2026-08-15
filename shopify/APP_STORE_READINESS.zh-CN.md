# Charm customiser 上架打包与过审清单

本文面向当前架构：前端和 API 托管在 `charme-customizer.pages.dev`，通过 Shopify App 安装后给商家提供 App Block + Admin 嵌入页。

## 1) 当前已完成（可用于上架基础）

- 已有 Shopify app 配置：`shopify.app.toml`（embedded app）。
- 已有 Function 扩展：`extensions/charme-bundle`（cart transform）。
- 已新增 Theme App Extension：`extensions/charme-customizer-theme`（app block，商家无需手工粘贴 snippet）。
- 自定义器核心可从 CDN 加载：`https://charme-customizer.pages.dev/widget/charme-customizer.js`。

## 2) 一键打包与发布命令

在仓库根目录执行：

```bash
npm install
npm run build:shopify
npm run build
shopify app deploy
```

说明：

- `npm run build:shopify` 负责生成 storefront widget 到 `public/widget`。
- `npm run build` 负责生成 Cloudflare Pages 发布物（含 Functions）。
- `shopify app deploy` 负责发布 App 配置与扩展（Theme App Extension + Function）。

## 3) 上架前必须补齐（阻断项）

### 3.1 OAuth 回调地址

`shopify.app.toml` 的 `[auth].redirect_urls` 目前为空。公开上架必须提供有效回调 URL，并在 Partner Dashboard 保持一致。

建议至少包含：

- `https://<你的应用域名>/auth/callback`
- `https://<你的应用域名>/auth/shopify/callback`

### 3.2 合规 Webhook（GDPR + 卸载）

公开应用必须实现并可验证：

- `customers/data_request`
- `customers/redact`
- `shop/redact`
- `app/uninstalled`

要求：

- 接口返回 200。
- 校验 webhook HMAC。
- 有审计日志与幂等处理。

### 3.3 最小权限原则（Scopes）

当前 scopes 偏大，建议拆成“上架必需”与“内部运维”两组。

高风险权限（过审会重点问用途）：

- `write_themes`
- `read_themes`
- `read_all_cart_transforms`

建议动作：

- 删除不必要 scope。
- 在审核说明中逐条解释每个写权限的业务必要性。

### 3.4 应用信息与法务页面

Partner Dashboard 必填且需可访问：

- App 名称、Logo、客服邮箱。
- 隐私政策 URL。
- 服务条款 URL。
- 数据保留与删除说明（与 GDPR webhook 一致）。

## 4) 强烈建议（非阻断，但影响通过率）

### 4.1 从“手工注入脚本”迁移到“App Block 为主”

本仓库已新增 `extensions/charme-customizer-theme/blocks/charme-customizer.liquid`。

审核期应避免要求商家去主题代码里粘贴脚本；推荐流程：

- 安装 app。
- 在主题编辑器添加 App Block。
- 完成配置即可使用。

### 4.2 限制外部资源依赖与域名说明

当前依赖 `charme-customizer.pages.dev`。审核说明需明确：

- 外域仅用于渲染器与应用 API。
- 不接管 Shopify checkout。
- 不篡改支付流程。

### 4.3 首屏性能与降级

建议保留并验证：

- 资源懒加载。
- API 失败时回退逻辑。
- 低网速下可恢复。

## 5) 审核自测清单（提审前逐条验证）

- 可在开发店安装并打开嵌入式 Admin 页面。
- App Block 可添加、保存、前台可见。
- 打开编辑器、加入购物车、下单链路可完成。
- 卸载 app 后，相关 webhook 可收到并处理。
- GDPR 三个 webhook 的测试 payload 可处理。
- 隐私政策和条款页面可公开访问。
- Scope 与应用描述一致，无多余高权限。

## 6) 你现在可以直接做的下一步

1. 在 Partner Dashboard 填写应用公开资料（隐私、条款、支持联系方式）。
2. 在 `shopify.app.toml` 补齐 `redirect_urls` 并收敛 scopes。
3. 增加并联调 GDPR/卸载 webhook 路由。
4. 在开发店跑一轮完整审核脚本（安装、配置、下单、卸载、GDPR）。
