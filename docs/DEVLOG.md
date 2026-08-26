# EU Tax SaaS 开发日志（CHANGELOG / DEVLOG）

> 目标：持续记录项目的每次变更，让任何人（包括未来的自己）都能快速了解项目进展到哪一步、为什么这么做。
>
> 维护约定：
> - **新条目加在最上面**（倒序），写清楚 日期 / 变更内容 / 为什么 / 验证方式。
> - 一次部署对应一个条目；大特性拆多个 commit 时合并为一条。
> - 状态图例：✅ 已上线生产 · 🔄 部分完成 · ⏳ 计划中
> - 查看某条目细节：`git log <hash>` / `git show <hash>`

---

## 2026-08-25 · 双语改造波：€29 创始价落地页 + 全站中英双语 ✅

**这波发生了什么**：按更新后的营销 spec（定价从"Beta 免费"改为 **€29/年创始价**）交付英文落地页 + waitlist 邮箱捕获，同时完成全站中英双语改造（i18n 基建 + 全部 SPA 页面 + 22 策略双语数据 + /compare 双语）。多智能体团队（landing-eng / i18n-core / i18n-pages / strategy-i18n / reviewer）并行开发，中途全员切换模型路由（tengxun-tokenhub -> volcano-plan）零工作损失。

### 1. 英文落地页（spec 五屏，€29 创始价叙事）

- **重写** `src/landing/pages.ts` homePage()：Hero（"€29/year while it's in this state, €99 when it's finished"）/ 五国法条卡 / 功能四卡（"in code, not vibes"）/ 诚实声明（UK 8/17、西班牙 foral、荷兰 Box 3、AI 建议可能中文）/ waitlist / 966 tests 自嘲页脚；语气红线（零感叹号、无黑话）测试锁定
- **已登录 302**：GET / 检测 session 跳 /app
- **pricing 页整卡重写**：单一创始价卡（€29 现价 + €99 未来价 + 三涨价条件 + 锁价永久），旧 €10/€190 移除

### 2. waitlist 邮箱捕获（新增变现资产）

- `waitlist` 表 + 迁移 0009；`POST /api/waitlist`：201 新 / 200 重复 / 422 非法 / 429 每日 5 次/IP 限流；防邮箱枚举
- commit `a8b8e1c`

### 3. 全站中英双语（i18n 零依赖方案）

- **基建** `src/frontend/i18n/`：locale signal + t() 插值/回退 + localStorage 持久化 + ZH/EN 切换器（App 头部）+ `<html lang>` 同步
- **全部页面**：App 外壳 10 tab + Dashboard/Account/Onboarding + Strategies/Residency/RAG/Deadlines/FilingDraft/Calendar/Compare/PaywallCard，聚合字典 414+ key，切换响应式无需刷新
- **策略库**：22 策略 titleEn/descriptionEn/reasonEn（法条级英语，非机翻），注册守卫 + 22×5×6 矩阵测试强制完整性；`/evaluate` 双语对并行输出，服务端不感知 locale
- **/compare?lang=en** 整页英文（MESSAGES 字典），无 JS 提交保持语言
- commit `1d39e8c` / `8167cb9` / `5dccae0`

### 4. Beta 付费豁免开关（BETA_ALL_PRO）

- `subscription.ts` 新增 `isBetaAllPro(env)`：true = 登录用户全免 Pro 费（促销用）；**默认 false**（Beta 正常收 €29）
- `/api/me` 回显 betaAllPro，前端 isPro() OR 闭环（开关切换前后端同步生效）

### 5. 质量与验证

- 测试基线 84 文件/896 -> **89 文件/972 全绿**（+76 用例）；四件套（typecheck/lint/test/build:app）全绿
- 本地运行时验证：落地页五屏渲染、waitlist 四分支、BETA_ALL_PRO=false 下 free 用户 402、/compare 双语、语言切换 + 持久化全部通过
- commit：`a8b8e1c` / `1d39e8c` / `8167cb9` / `5dccae0` / `30fd7b1`（诚实声明更新）

### 待办
- [x] **Creem 后台配置**：✅ 已完成（2026-08-25）——test + live 环境均创建 €29/年创始价产品；生产 `CREEM_YEARLY_PRODUCT_ID` 已指向 live 产品 `prod_78Xrr8jY0rVMk6DhNwMzbo`，checkout 实测返回 €29 收银台
- [x] 生产 secrets 就位：✅ 已完成（2026-08-25）——`CREEM_API_KEY`（live）/ `CREEM_YEARLY_PRODUCT_ID` / `CREEM_WEBHOOK_SECRET` 均已写入生产，`wrangler secret list` 确认
- [ ] push 后线上验证已完成 ✅（落地页/定价/双语/waitlist/checkout 全链路通过）；**DEV.to 文章发布仍待办**（文案就绪：`marketing/content/devto/07-v6.md`）

---

## 2026-08-24 · 免费五国计算器落地页 + 订阅付费墙上线 ✅

**今天发生了什么**：产品从「功能完备的内部系统」转变为「可获客、可收费的产品」。两个核心商业模块同日部署到生产。多智能体团队（landing-engineer / paywall-engineer / reviewer）并行开发，文件范围隔离（landing 收敛在 `src/landing/**`，paywall 动 API 中间件与前端页面），reviewer 统一评审提交。

### 1. 免费五国税后收入对比计算器落地页（获客引擎）

- **新增** `src/landing/compare.ts`：`GET /compare` 中文 SSR 计算器页面 + `GET /api/public/compare` 公开 API
  - 无需登录、无 JS 也可用（GET 表单直出，SEO 友好）
  - 五国口径一致对比（统一无特殊身份、ES/UK 自动补 region），按到手净收入降序，「到手最高」绿底徽章
  - 转化设计：双 CTA（免费注册生成申报草稿 / 查看完整节税策略）+ 免责声明
  - 防护：每 IP 10 次/分钟 D1 原子限流（CF-Connecting-IP 优先，XFF 兜底）、zod 中文校验、D1 故障 fail-closed 503、匿名不入审计表
- **修改** `src/landing/layout.ts`：导航栏新增「五国对比」入口 + footer 链接；renderPage 支持可选 lang 参数（compare 页 zh-CN，既有 7 页默认 en 不变）
- **修改** `src/landing/index.ts`：registerLandingRoutes 末尾追加一行注册（未动 src/api/index.ts，零冲突）
- **测试**：新增 `compare.test.ts` 14 用例 + 导航断言更新（含防属性顺序脆弱的正则断言）
- **为什么**：这是营销的承接页。数字游民/跨境工作者最爱的传播点是"我在葡萄牙 vs 西班牙到手差多少"，免费工具引流 → 注册 → 付费。支持预填参数直出结果（如 `?grossIncome=60000`），营销内容可直接投放。
- **commit**：`f8e542e`（5 文件，+898/-2）

### 2. 订阅付费墙（变现闭环）

- **新增** `src/api/middleware/subscription.ts`：
  - `requireActiveSubscription({feature})` 硬门禁：401（未登录）/ 402 `subscription_required`（含 feature slug、subscriptionStatus、checkoutHint、message 四要素契约）/ 503 fail-closed（D1 故障不放大权限）
  - `requireProIfWatermarkOff()`：Pro = admin 或 active 订阅（替代原 admin-only 水印闸门，**删除** `require-admin-if-watermark-off.ts`）；past_due 拒绝；保持 bodyLimit→gate→rateLimit 次序，402 不烧免费配额
- **F3 申报 PDF**：无水印正式版从 admin-only 升级为 Pro 门禁；免费用户水印预览 10 次/日不变
- **F4 策略报告**（分两层设计）：
  - `POST /api/strategies/evaluate` 非 Pro 用户（匿名/free/past_due）**服务端裁剪**：reason 截 60 字加省略号、actionSteps/citations 置空；**保留 estimatedSavingsEur 作为转化钩子**（免费层"看到能省多少"，付费层"看到怎么做"——策略目录元数据 citation 单数字段保留，因目录端点本就公开）
  - `/ai-recommend`、`/persist` 挂 Pro 硬门禁；目录浏览 + 评估保持免费（获客漏斗）
  - DB 查询失败降级为裁剪视图（fail-safe）
- **前端**：新增 `src/frontend/paywall/`（api.ts + 共享 PaywallCard 组件，两页面复用零复制粘贴）；FilingDraftView 水印开关 Pro 化；StrategiesPage「完整 AI 策略报告」区块；AccountPage 月付/年付升级 CTA 直达 Creem 收银台（定价文案价格无关，实际价格由 Creem 产品配置决定）
- **其他**：`/api/me` 回显 subscriptionStatus（前后端单一事实源）；清理重复的 `SubscriptionRequiredError` 死代码（留注释指向单一来源）
- **为什么**：此前 Creem 支付链路已通但无任何门禁，产品等于全功能免费。付费墙把商业闭环补上。
- **commit**：`aac89e0`（16 文件，+1667/-220）

### 3. 测试与部署

- 测试基线 82 文件/853 → **84 文件/896 用例全绿**（+43，零破坏）
- 部署后线上验证（taxmora.com）：`/compare` SSR 渲染 ✓、五国数值与本地逐位一致（UK €48,568 / DE €45,585 / ES €44,996 / PT €41,334.51 / NL €39,216）✓、匿名 401 / free 402 完整契约 ✓、生产限流第 9 次起 429 ✓、导航入口生效 ✓

### 待办（接下来）
- [ ] 营销启动：`/compare` 链接投放（支持预填参数）
- [ ] 埋点：免费计算器 → 注册 → 付费转化漏斗数据（当前无任何用户行为追踪）
- [ ] 生产开启 `requireEmailVerification`（auth.ts 中当前为 false）
- [ ] 已知小 bug：`src/strategies/es.beckham.ts` 的 `citation.lastVerified` 是 `'2020-01-01'`（其余 21 个策略均为 `2026-06-08`），会被 F4 LLM harness 的 H1 时间门控静默丢弃——待修复并补防回归测试

---

## 2026-08-09 · Solid SPA 上线 /app + 登录注册页 ✅

- `241cc43`（00:34）feat(landing): 登录/注册页 + 导航入口，落地页体系补全
- `98b5a9b`（00:49）feat(app): **Solid SPA 经 Workers static assets 部署到 `/app`**——应用主体从内部工具页升级为正式产品入口；未命中资产的请求回落到 Worker（API + 落地页）
- 影响架构：vite 构建产物挂载 `assets = { directory = "./dist", binding = "ASSETS" }`，`/app` 与 `/api`、落地页在同一 Worker 内共存

## 2026-08-01 · DeepSeek 模型迁移 + CI 调通 ✅

- `dc7ad59`（11:21）**DeepSeek 模型迁移**：deepseek-chat / deepseek-reasoner 别名退役 → `deepseek-v4-flash`（chat 用非思考模式，H6 自检用思考模式——自此 H6 是同模型自检，代码内已有 model-identity 警告机制）
- `1540b92` → `ea79fcd`：CI 修复系列——Cloudflare secrets 配好后触发 workflow、pnpm 版本对齐 package.json（11.5.1）、允许 pnpm 11 依赖构建脚本
- `194e409`（13:30）：biome 格式化修复通过 CI lint
- **里程碑意义**：`main` push → GitHub Actions（typecheck + lint + test）→ build:app → D1 迁移 → `wrangler deploy --env production` 全链路首次跑通，taxmora.com 自动部署生效

## 2026-07-22 · Creem 支付集成 + CI/CD 工作流 ✅

- `b97de4c`（17:28）**Creem 支付集成**：checkout 创建 / 重定向签名验证（SHA-256 常量时间比较）/ webhook HMAC 验证 / D1 订阅状态更新 + 账户订阅管理页面
- `d118662`（17:45）：GitHub Actions CI/CD workflow 首次落地（test job + deploy job）
- **商业意义**：变现基础设施就位（但此时还没有付费墙——门禁是 2026-08-24 才补上的）

## 2026-07-02 ~ 07-03 · Dashboard + Onboarding + 设计系统 ✅

- 07-02 上午：`bf3e07f` 支付字段去 Paddle 化（provider-agnostic 重构，换 PSP 不迁移）；`dc4db07` + `a3b7d88` + `496d36c` dashboard 聚合路由 + 页面 + 导航
- 07-02 晚（19:11-19:12 一批提交）：`4f8d4de` **DESIGN.md 设计系统**（中文优先、色彩/间距/组件规范）；`170ac9e` → `57e5fda` 完整 onboarding 体系（`user_onboarding` 表 + 迁移、类型与服务层、API 路由、dashboard 状态暴露、前端 API client、**5 步向导**：隐私 → 国家 → 收入 → 状态 → 完成）；`4325001` 导航接线
- 07-03 上午：移动端适配三连修（特殊状态占位符截断、onboarding 完成后隐藏操作 footer、移动端 footer 按钮堆叠）；`b0e4b86` gitignore Playwright 视觉 QA 截图
- **用户旅程意义**：新用户从落地到看到自己数据的完整路径成型

## 2026-06-30 · F5 RAG 税法问答（Wave 2）+ F9 截止日 ✅

一天 12 个提交，两个功能模块并行完成：

- **F5 RAG**（15:07-18:18）：
  - `84a7380` F5 Wave 2 向量化税法问答管线（BGE-M3 嵌入 + Vectorize + KV 分块存储 + `/api/rag/qa`）
  - `038d010` AI Gateway API token 可选化（支持非认证网关）
  - `691f5c3` 评审修复：错误泄露、prompt injection、结构化输出、原子 upsert
  - `0346126` preview KV/R2 绑定 + RAG 远程冒烟脚本
  - `8106b10` 文档要求的安全护栏：时间门控、制度排除、黑名单、topK=5、30 测试
- **F9 截止日**（20:30 一批）：`5fbbc8e` schema + 迁移；`dc4c19c` API + repository + 测试；`b1e7288` **每日 cron 提醒触发器**；`33333d7` 前端四个新页面（deadline / residency / strategies / rag）

## 2026-06-22 ~ 06-23 · 部署阻塞修复 ✅

- `75a348b`（06-22）：Workers 构建环境 Date 冻结问题处理 + free plan 配置适配（limits 注释掉）
- `3d700f9`：lint 清理 + README 更新 + pnpm 配置
- `09adc87`（06-23）：解决阻塞 wrangler deploy 的 TypeScript 错误
- **意义**：跨过"本地能跑、部署不了"的阶段，为 08-01 的 CI 全链路通铺路

## 2026-06-16 · 生产资源落位 ✅

- `0a4f4de`：wrangler.toml 填入真实 D1 / KV 资源 ID——项目从"本地模拟"转向"真实 Cloudflare 资源"

## 2026-06-11 · RAG 基础设施 + Cloudflare 文档日 ✅

一天 10 个提交，两线并行：

- **RAG 基线**（20:32 一批）：`3cffea6` 官方税法源清单（manifest）；`80c67dc` 受限爬虫（guard）；`2466667` ingest CLI；`398db7c` ingest 工作流文档；`ecb315f` Vectorize 设置 runbook
- `6cbeb3c`：better-auth 升级修 Kysely 0.29 构建兼容
- **Cloudflare 从零文档**（23:13-23:47）：`27633a2` CLOUDFLARE-SETUP-OVERVIEW.md 中文总入口；`076783f` 配置链接；`71060c8` 部署就绪清单；`6deaab2` 上线就绪对齐文档

## 2026-06-08 · F4 策略库完成日（17 个提交）✅

项目最密集的一天，F4 策略推荐从零到全：

- **骨架与确定性策略**（12:02-12:28）：`25c393b` 类型 + 注册表骨架（含 ID 唯一/引用完整/日期合法的注册校验）；`05eb820` **8 个 A-tier 确定性策略**；`e2ee721` **14 个 B-tier 半确定性策略 + 56 测试**；`bf03eba` /api/strategies 端点 + 9 契约测试
- **Oracle 评审修复**（13:37-13:49）：ES region 默认 MAD、`_resetRegistryForTests` 生产守卫、evaluate 30/min 限流、对抗性测试（废弃制度不可出现）、kirchensteuer SolZ 感知修正
- **LLM 接入**（15:23-15:43）：`5b491aa` DeepSeek V4 client（AI Gateway 代理 + 工具调用）；`6eab84b` **6 层 Harness 接线** + ai-recommend 端点；`9a35772` C-tier 8 个种子策略目录 + 4 对抗回归测试
- **加固**（17:44-17:56）：Oracle Wave C P1+P2——region 白名单防 prompt injection、H5 对无计算器种子强制 null（关掉"编造节省额"逃生门）、H1 严格 ISO 日期、H3 Zod 参数校验、同模型自检检测、可配置定价；C-tier 种子补可验证源 URL；pt.despesas_saude 修为 null 而非 €1,000 天花板；结构化 assumptions 字段
- **至此 F4 完成**：22 个 A/B 策略 + LLM C-tier，全部带法条引用与 lastVerified

## 2026-06-04 · W4 PDF 渲染 Oracle 修复轮 ✅

- **P1/P2 修复**（11:52-13:00）：R2 上限、body-limit、国家枚举、lazy pdf-lib；结构化警告、前端 UX、水印几何；**D1 原子限流**（INSERT...ON CONFLICT 模式，替代 KV 读-写竞态）；字段 transform 从 YAML 接线到渲染（修复"德语日期格式静默失效"）；WinAnsi NFC 归一化 + getByPath 原型链守卫
- **工程规范**（13:06）：drizzle migrations/meta 入库（跨机 drizzle-kit 连续性）
- **审计与跟进**（17:17）：响应哈希切片 + 跳过 GET/HEAD（Oracle P1-NEW-1+2）；成本模型 + transform 警告 + header 上限 + body-clone 测试 + lazy 扫尾（P1-NEW-3..7）

## 2026-06-03 · 项目启动日：从脚手架到 PDF 管线（20 个提交）✅

史诗级的第一天（18:50 - 21:33，约 3 小时），W1-W4 核心骨架全部落地：

- **脚手架**（18:50）：`2a15c30` Cloudflare Workers + Hono + Drizzle + Solid；技术选型定稿（SolidStart + Hono + D1 + Better Auth，支付字段 provider-agnostic）
- **计算器基线**（18:50）：`9cbc32b` **F1 计算器 DE/NL/PT**（DE §32a EStG 纯税率函数 + Splittingverfahren + SolZ）+ F4 LLM harness prompt 骨架 + D1 schema 基线
- **扩展到五国**（18:51）：`1fb71a6` **ES IRPF（4 自治区）+ UK SRT** 计算器 + 5 国居留判定决策树 + CompareView UI；`ebf8b16` F2 days API + F3 日历 + UK SRT ties + 审计中间件 + admin 路由 + PDF ingest
- **W4 PDF 渲染管线**（18:52-20:59）：overlay 坐标 schema + Better Auth 字段 + Miniflare 测试 harness；YAML mapping 加载器 + AcroForm 字段提取 CLI + D1 ingest CLI；form_mapping_versions 表（缓存失效账本）；动态 AcroForm 测试 PDF 构建器（不提交二进制）；**DE Mantelbogen ESt 1 A 2024 首个真实表单**（字段清单 + YAML 映射）；GET /api/forms 端点（ETag/Cache-Control）；pdf-fill 渲染引擎 + transforms；每页 DRAFT 水印；WinAnsi 守卫（确定性音译）；POST render 端点（auth + KV 限流）；FilingDraftView Solid tab；e2e 冒烟测试
- **文档与首轮评审**（21:01-21:33）：W4-PDF-RENDERING.md 管线指南；**Oracle P0-1..P0-5 修复**（水印闸门、TBD 拒绝、CORS 白名单、PDF 元数据、typed eqAllActive）

---

## 附录一：项目状态快照（2026-08-24）

| 维度 | 状态 |
|---|---|
| 功能 | F1 计算器 / F2 居留 / F3 PDF / F4 策略 / F5 RAG / F6 日历 / F7 dashboard+onboarding / F9 截止日 全部上线 |
| 商业 | 免费获客引擎（/compare）+ Pro 付费墙已上线；Creem 支付闭环 |
| 测试 | 84 文件 / 896 用例全绿；CI 四件套（typecheck/lint/test/build） |
| 部署 | main push → CI → taxmora.com，约 2 分钟生效 |
| 已知债务 | email 验证未开启；队列 consumer 未实现；前端无 router/共享组件库；es.beckham lastVerified 待修 |

## 附录二：开发节奏一览（按提交密度）

| 日期 | 提交数 | 主题 |
|---|---|---|
| 2026-06-03 | 20 | 项目启动：脚手架 → 五国计算器 → PDF 管线 |
| 2026-06-04 | 9 | W4 Oracle P1/P2 修复轮 |
| 2026-06-08 | 17 | F4 策略库完成（A/B/C 三层 + LLM harness） |
| 2026-06-11 | 10 | RAG 基础设施 + Cloudflare 文档 |
| 2026-06-16 ~ 06-23 | 4 | 生产资源落位 + 部署阻塞修复 |
| 2026-06-30 | 12 | F5 RAG Wave 2 + F9 截止日 |
| 2026-07-02 ~ 07-03 | 16 | Dashboard + Onboarding + 设计系统 |
| 2026-07-22 | 5 | Creem 支付 + CI/CD |
| 2026-08-01 | 5 | DeepSeek 迁移 + CI 调通 |
| 2026-08-09 | 2 | SPA 上线 /app |
| 2026-08-24 | 3 | 落地页 + 付费墙 + 本日志 |
