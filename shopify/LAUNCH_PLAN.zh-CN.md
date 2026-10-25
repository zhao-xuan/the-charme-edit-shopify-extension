# Charmé Product Studio：密钥、审核演示与旧店迁移

本文件是执行清单。当前代码在 Git 上并不代表 Cloudflare Pages 或 Shopify 已发布版本已更新；任何发布都需要单独核对目标环境。

## 1. 配置密钥（值只放密钥管理器和平台，不提交 Git）

1. 在 Shopify Dev Dashboard 打开目标 **public app**，记录 Client ID、Client secret 和 app handle；在 Partner Dashboard 记录 app 的数字 ID、Partner organization ID。确认 `shopify.app.toml` 的 `client_id` 与目标 app 一致。若为公开版新建 app，必须同步修改 `index.html` 的 App Bridge API key，并在新 app 发布对应 Theme App Extension；不能把新旧 Client secret 混用。
2. 在本机安全终端运行 `openssl rand -base64 32`，把输出作为 `SHOPIFY_TOKEN_KEY` 存入密钥管理器；不要粘贴进聊天、工单、Git 或截图。该值丢失会导致 D1 中已加密的安装令牌无法解密；轮换需安排重授权或实施双密钥迁移。
3. Cloudflare Dashboard → Workers & Pages → `charme-customizer` Pages 项目 → Settings → Environment variables（或 Variables and Secrets）：在 **Production** 环境设置 `SHOPIFY_CLIENT_ID`、`SHOPIFY_CLIENT_SECRET`、`SHOPIFY_TOKEN_KEY`。使用加密 secret 选项。Preview 是另一套环境，测试时分别设置，不能让 Preview 使用生产密钥和生产 D1。
4. Cloudflare Pages → Settings → Bindings：绑定 D1 数据库为 `DB`。验证 Production 与 Preview 指向的数据库及迁移策略。现有 Studio 表会在首次请求时创建；正式上线前先备份原 D1。
5. 若启用 Shopify App Pricing，在 Partner Dashboard 设置计划和 handle；Cloudflare Production 增加 `SHOPIFY_APP_HANDLE`、`SHOPIFY_PARTNER_ORG_ID`、`SHOPIFY_APP_GID`（`gid://shopify/App/<数字 ID>`）、`SHOPIFY_PARTNER_API_ACCESS_TOKEN`。Partner API client 至少授予 **Manage apps**。未配置时 Subscription tab 会显示“无法验证”，不会伪称免费或无订阅。
6. `SHOPIFY_STORE`、`ADMIN_TOKEN` 是旧单店后台配置，只为迁移期保留；公开版新商店依靠 Shopify session token 与各店离线令牌。生产不能把 `ADMIN_TOKEN` 发给新商家。`STUDIO_ALLOWED_ORIGINS` 仅在确有额外受信域名时添加，逐个核对。
7. 部署 Pages 后先用开发店测试 `/shopify/` 登录、`/api/shopify-app/session`、五个 tab、模板保存、Customizers 发布、App Block 和 webhook。Shopify app version/Theme App Extension 需另行发布；Cloudflare 部署不会替代它。

## 2. 审核演示计划

准备两家开发店 A/B（A 为演示店，B 检查隔离），至少一个可售测试商品和可用变体。先在 A 店标定一个拖拽模板，再分别为文字、图片替换、部件组合、3D 首饰准备可演示模板；每个模板的材料、安全区域、生产说明都应与演示商品吻合。给审核者一个能进入开发店的有效账号；不要把账号明文放在公开仓库。

英语旁白或英文字幕的视频按以下顺序录制：安装并进入嵌入式应用 → New Customizer 选模板/建草稿 → 打开 `/studio` 体验编辑 → Setting 校准和启用模板 → 发布定制器 → My Customizer 复制 ID → 主题编辑器添加并保存 App Block → 店面作为顾客编辑、保存和提交 → 商家审核并绑定**包含全部定制费用**的 Shopify 变体 → 顾客取得报价并进入原生 Shopify cart → Subscription 查看/更改计划 → Analytics 查看该店数据 → 下架定制器并确认顾客链接失效。清楚说明 3D 是参数化预览、生产文件及工艺需人工确认。

审核说明提供：演示店 URL、登录凭据、商品 URL、已发布 Customizer ID、五类交互的入口、如何完成制作申请、如何在审核队列审批、测试订单步骤、付费计划和测试方式、隐私/条款 URL、客服与紧急联系人。视频和截图必须与当前生产版本一致。再做桌面/移动端、无痕模式、重装、跨店隔离、HMAC 失败、`shop/redact` 的实际回归。Shopify App Store review 页面自动检查通过后再提交。

## 3. 旧店迁移（建议双应用并行）

当前根 `shopify.app.toml` **复用旧 client ID**，但公开版只包含新的 Theme App Extension，且 scope 变为 `read_products`。若直接对旧 app 发布该配置，旧店已发布的扩展/Cart Transform/授权可能被改变。先决定使用新的 public app ID，还是排维护窗口做原 app 原地切换。推荐独立公开 app ID，让旧店现有 checkout 和主题维持运行，直到新 app 验证通过。

1. 盘点旧店主题版本、旧 App Block/自定义 Liquid、Cart Transform、产品与变体、旧 D1 商品/charms/patches/analytics、未完成订单及设计链接。备份主题、D1 和应用配置；记录回滚用的旧版本。
2. 新 public app 在开发店跑完整流程，确认密钥、Pages、D1、计划、法律页面、webhook 均可用。若新 app 使用独立 Pages 域名，更新 `application_url`、Theme App Block 中的 Studio URL、App Bridge key 以及 Cloudflare secrets，再重新联调。
3. 把旧店要保留的商品逐个映射到五种交互模板；**手动重新标定**尺寸、安全区域和物料。旧版手机壳/帆布包/相框设计 JSON 与新版 Studio 结构不同，不能直接导入为已审核的新设计；历史订单和生产记录保留在旧系统只读档案。
4. 在旧店安装新 app，配置、发布新定制器；先在未公开主题副本中添加 App Block，填入发布 ID，做测试下单与退款/取消演练。新旧系统并行期间不要在同一商品页显示两个定制入口。
5. 选择切换窗口发布新主题，确认商品链接、价格、购物车、订单属性和人工履约；保留旧 app 处理切换前订单和设计。观察至少一个业务周期，再移除旧区块和旧 app。卸载会触发令牌撤销与稍后的 `shop/redact`，所以先导出符合法律义务的历史记录。
6. 回滚时恢复旧主题发布版本与旧 app 入口；不要回滚已经创建的 Shopify 订单。测试新旧链接的处理与客服口径。

## 4. 上架前尚需人工确认

- 填写法律经营主体的正式名称、注册地址、适用法域，并请法律顾问审核 `/privacy/` 与 `/terms/`。当前页面为完整产品数据流草案，但尚无经确认的法律主体。
- 确定真实订阅计划、USD 价格、试用期以及 app handle；当前代码不会创建收费计划。
- 客户在自由文字或上传图中写入个人信息时，Shopify 的 customer ID 不能自动匹配匿名设计；需要客服凭设计 ID/私密链接处理个人请求，或开发更完整的数据主体映射与删除工具后再开放上传。
- 在真实开发店验证主题兼容、商家授权、订阅查询与支付后的订单路径。没有这些结果不能宣称已准备提审。

官方参考：[App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)、[主题区块 deep link](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)、[隐私 webhook](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)、[审核提交](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review)。
