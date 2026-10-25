# Charmé Product Studio：Shopify App Store 发布状态（2026-10-25）

`shopify.app.toml` 是公开版配置；`shopify/shopify.app.toml` 是旧草稿，不用于部署。当前提交是**代码与发布配置准备**，不是已经通过 Shopify 审核，也不会自动改变 Cloudflare 生产站点或 Shopify 已发布版本。

## 本次代码已经覆盖

- Shopify-managed installation：嵌入式 App Bridge session token 经签名、aud、有效期和商店域名校验后，交换**可刷新的 expiring offline token**；令牌用 AES-GCM 加密存入 D1，按商店隔离。
- `/shopify/` 商家入口：安装验证后标定 25 个商品模板；五套交互逻辑复用；审核设计并搜索/绑定本店 Shopify 变体。模板默认禁用，未经实物标定不会接收制作申请。
- Theme App Extension：商家在主题编辑器加 Product Studio App Block；按钮打开对应商店的 `/studio/?shop=...`，可指定模板 ID。公开扩展只包括 Studio，不把旧单店手机壳/包包 widget 和 cart transform 带给新商家。
- Studio 的公开设计、审核队列、模板和报价按 `shop_id` 隔离。旧目录后台的 App Bridge 身份只接受旧店，避免新商家访问旧店商品资料。
- 卸载及 Shopify 必需隐私 webhook：原始请求体 HMAC 校验、卸载时撤销本地令牌、`shop/redact` 删除该店 Studio 数据。匿名设计不记录 Shopify customer ID/email，因此 customer data request/redact 没有可按客户 ID 定位的记录；如用户在自由文本/图片中写入个人资料，仍需通过设计链接或客服流程处理。
- Shopify Admin GraphQL 使用 `read_products` 读取商家选定变体及当前市场报价；付款仍经商家原生 Shopify 购物车。

## 尚未完成，不能宣称“已可提审”

1. **运行环境**：在 Cloudflare Pages 生产环境设置 `SHOPIFY_CLIENT_ID`（须等于根目录配置的 client_id）、`SHOPIFY_CLIENT_SECRET`、`SHOPIFY_TOKEN_KEY`（32 个随机字节的 base64，例：`openssl rand -base64 32`）、D1 `DB`。保留 `SHOPIFY_STORE`、`ADMIN_TOKEN` 只用于旧店后台。部署本次 Pages 代码；再单独发布 Shopify app version（配置与 Theme App Extension）。这些操作尚未执行。
2. **真实安装与端到端**：在两家 Shopify development stores 安装，验证授权/刷新、跨店隔离、主题 App Block、五套交互、模板标定、制作申请、变体报价、加入购物车、下单、卸载、隐私 webhook。当前只有本地自动化测试与前端构建，不能代替商店联调。
3. **商业与履约范围**：此版为“商家人工确认制作能力再报价”的工作流。3D 是参数化预览；机器刀路、刺绣针法、量产 3D 模型、供应商物料库存与订单履约自动化尚未实现。商品模板和材料必须由商家标定，审核者也需要有可体验的已标定演示商品。若 listing 承诺自动生产或自动履约，会与产品实际能力不符。
4. **隐私与客服**：提供真实主体的隐私政策、服务条款、客服邮箱、数据保留/删除流程，并在 Partner Dashboard 填写；应给匿名设计提供客服协助删除流程。当前代码只完成按店删除，未提供自助设计删除或按 Shopify customer ID 导出/删除自由文本和图片。
5. **上架资料与审核**：完成 App Store listing、截图/视频、演示商店及登录资料、定价方案、审核说明，按 Shopify 最新要求检查。正式提审由 Partner Dashboard 完成，审核通过时间由 Shopify 决定。
6. **旧店迁移风险**：根配置复用现有 client ID，但公开版只请求 `read_products` 且不发布旧 cart transform/widget。直接发布这个 Shopify app version 可能改变旧店授权和已添加的主题块。必须先在开发店验证，并决定旧店迁移或为公开版创建独立 Shopify app/client ID；若采用新 ID，还需同步更新根配置、App Bridge meta key 和 Pages secrets。

## 操作顺序

1. 在 Shopify Dev Dashboard 核对 App 的 client ID、公开分发类型和根配置；保持 Shopify-managed installation（无需 OAuth callback URL）。
2. 在 Cloudflare Pages 配置上述 secrets 和 D1，先发布 Pages 代码；测试 `/shopify/`、`/api/shopify-app/session` 和 `/webhooks/shopify` 可用。
3. 在项目根目录运行 `shopify app deploy`，发布 app version 与主题扩展；此命令**不会**部署 Cloudflare Pages。只在核对当前 app 身份和目标环境后运行。
4. 完成双店安装、完整订单路径、卸载与 webhook 验证，并修复测试中发现的问题。
5. 发布真实法律/支持页面，准备 reviewer 可用的演示账号与已标定模板，然后在 Partner Dashboard 提交审核。

参考：[安装与身份验证](https://shopify.dev/docs/apps/build/authentication-authorization/app-installation)、[App Bridge token exchange](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange)、[隐私 webhook](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)、[App Store 要求](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)。
