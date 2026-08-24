# EU Tax SaaS 开发日志（CHANGELOG / DEVLOG）

> 目标：持续记录项目的每次变更，让任何人（包括未来的自己）都能快速了解项目进展到哪一步、为什么这么做。
>
> 维护约定：
> - **新条目加在最上面**（倒序），写清楚 日期 / 变更内容 / 为什么 / 验证方式。
> - 一次部署对应一个条目；大特性拆多个 commit 时合并为一条。
> - 状态图例：✅ 已上线生产 · 🔄 部分完成 · ⏳ 计划中

---

## 2026-08-24 · 免费五国计算器落地页 + 订阅付费墙上线 ✅

**今天发生了什么**：产品从「功能完备的内部系统」转变为「可获客、可收费的产品」。两个核心商业模块同日部署到生产。

### 1. 免费五国税后收入对比计算器落地页（获客引擎）

- **新增** `src/landing/compare.ts`：`GET /compare` 中文 SSR 计算器页面 + `GET /api/public/compare` 公开 API
  - 无需登录、无 JS 也可用（GET 表单直出，SEO 友好）
  - 五国口径一致对比（统一无特殊身份），按到手净收入降序，「到手最高」绿底徽章
  - 转化设计：双 CTA（免费注册生成申报草稿 / 查看完整节税策略）+ 免责声明
  - 防护：每 IP 10 次/分钟 D1 原子限流（CF-Connecting-IP 优先）、zod 中文校验、D1 故障 fail-closed 503、匿名不入审计表
- **修改** `src/landing/layout.ts`：导航栏新增「五国对比」入口 + footer 链接（t4）；renderPage 支持可选 lang 参数
- **为什么**：这是营销的承接页。数字游民/跨境工作者最爱的传播点是"我在葡萄牙 vs 西班牙到手差多少"，免费工具引流 → 注册 → 付费。
- **commit**：`f8e542e`（含 t4 导航入口，5 文件，+898/-2）

### 2. 订阅付费墙（变现闭环）

- **新增** `src/api/middleware/subscription.ts`：
  - `requireActiveSubscription({feature})` 硬门禁：401（未登录）/ 402 `subscription_required`（含 feature slug、subscriptionStatus、checkoutHint、message）/ 503 fail-closed
  - `requireProIfWatermarkOff()`：Pro = admin 或 active 订阅（替代原 admin-only 水印闸门，删除 `require-admin-if-watermark-off.ts`）
- **F3 申报 PDF**：无水印正式版从 admin-only 升级为 Pro 门禁；免费用户水印预览 10 次/日不变（402 不烧配额）
- **F4 策略报告**：
  - `POST /api/strategies/evaluate` 非 Pro 用户**服务端裁剪**：reason 截 60 字、actionSteps/citations 置空；**保留 estimatedSavingsEur 作为转化钩子**（免费层"看到能省多少"，付费层"看到怎么做"）
  - `/ai-recommend`、`/persist` 挂 Pro 门禁；目录浏览 + 评估保持免费（获客漏斗）
- **前端**：新增 `src/frontend/paywall/`（api.ts + 共享 PaywallCard）；FilingDraftView / StrategiesPage / AccountPage 接入 402 升级卡片；AccountPage 月付/年付 CTA 直达 Creem 收银台
- **为什么**：此前 Creem 支付链路已通但无任何门禁，产品等于全功能免费。付费墙把商业闭环补上。
- **commit**：`aac89e0`（16 文件，+1667/-220）

### 3. 测试与部署

- 测试基线 82 文件/853 → **84 文件/896 用例全绿**（+43，零破坏）
- 部署后线上验证：`/compare` SSR 渲染 ✓、五国数值与本地逐位一致 ✓、匿名 401 / free 402 契约 ✓、生产限流第 9 次起 429 ✓、导航入口生效 ✓

### 待办（接下
- [ ] 营销启动：`/compare` 链接投放（支持预填参数，如 `?grossIncome=60000`）
- [ ] 埋点：免费计算器 → 注册 → 付费转化漏斗数据（当前无任何用户行为追踪）
- [ ] 生产开启 `requireEmailVerification`（auth.ts 中当前为 false）
- [ ] 已知小 bug：`src/strategies/es.beckham.ts` 的 `citation.lastVerified` 是 `'2020-01-01'`（其余 21 个策略均为 `2026-06-08`），会被 F4 LLM harness 的 H1 时间门控静默丢弃——待修复并补防回归测试

---

## 2026-08-09 · Solid SPA 上线 /app ✅

- `98b5a9b` feat(app): serve Solid SPA at /app via Workers static assets——应用主体从内部工具页升级为正式 /app 入口
- `241cc43` feat(landing): 登录/注册页 + 导航入口，落地页体系补全

## 2026-08-01 · CI/CD 与支付集成 ✅

- `b97de4c` Creem 支付集成（checkout / webhook HMAC / D1 订阅状态更新）+ 账户订阅管理
- `d118662` → `ea79fcd` GitHub Actions CI（typecheck + lint + test → build → D1 迁移 → wrangler deploy --env production），main push 自动部署 taxmora.com
- `dc7ad59` DeepSeek 模型迁移：deepseek-chat/deepseek-reasoner → deepseek-v4-flash（旧别名退役）
- `194e409` biome 格式化对齐 CI

## 2026-07-22 · Onboarding 用户旅程 ✅

- 5 步 onboarding 向导（隐私 → 国家 → 收入 → 状态 → 完成）+ `user_onboarding` 表 + dashboard 聚合路由与页面
- 移动端适配修复（footer 按钮堆叠、占位符截断）
- `4f8d4de` 新增 DESIGN.md 设计系统参考（中文优先、色彩/间距/组件规范）

## 2026-07-02 ~ 07-03 · F5 RAG 税法问答 + F9 截止日 ✅

- F5 Wave 2：Vectorize 向量检索 + BGE-M3 嵌入 + KV 分块存储 + `/api/rag/qa`；安全加固（时间门控、制度黑名单、prompt injection 防护、topK=5 限制、30 测试）
- F9：截止日表 + API + 每日 cron 提醒触发器
- 前端四个新页面：deadline / residency / strategies / rag

## 2026-06-30 · F4 策略库完成（A/B/C 三层）✅

- 22 个确定性/半确定性策略（8 A-tier + 14 B-tier）全部带法条引用 + lastVerified 日期
- 6 层 LLM Harness 接入 DeepSeek（H1 时间门控 → H2 Zod → H3 工具调用 → H4 规则注入 → H5 数值校验覆盖 → H6 自检）
- 对抗性测试：废弃制度黑名单（PT NHR / UK non-dom / NL 30% 滑动档）不可被推荐
- C-tier 8 个种子策略目录（LLM 生成类，预估节省强制 null 防"编造数字"）

## 2026-06-22 ~ 06-23 · Cloudflare 基础设施文档 ✅

- CLOUDFLARE-SETUP-OVERVIEW.md 中文总入口（账号 → D1/KV/R2/Queue/Vectorize → secrets → 部署清单）
- wrangler.toml 填入真实资源 ID，free plan 配置适配

## 2026-06-16 · RAG 基础设施 ✅

- 官方税法源清单（manifest）+ 受限爬虫 + ingest CLI

## 2026-06-11 · W4 PDF 渲染管线（Oracle 评审修复轮）✅

- 修复 Oracle P1/P2 系列问题：R2 上限、body-limit、D1 原子限流（INSERT...ON CONFLICT）、字段 transform 接线、WinAnsi NFC 归一化、成本模型
- 此前已完成：overlay 坐标 schema、YAML mapping 加载器、AcroForm 字段提取 CLI、DE Mantelbogen 首个真实表单映射、pdf-fill 渲染引擎 + 每页 DRAFT 水印、e2e 冒烟测试

## 2026-06-08 · F1 计算器核心 + F2/F3/F6 基础 ✅

- W2：ES IRPF（4 个自治区）+ UK SRT（法定居留测试 + ties 规则）计算器；5 国居留判定决策树；CompareView UI
- W3：F2 days API + F6 日历 UI（拖拽涂色、批量 POST、颜色图例）+ 审计中间件 + admin 路由 + PDF ingest
- W4 波 0：overlay 坐标 schema + Better Auth 字段 + Miniflare 测试 harness

## 2026-06-04 · F1 首批计算器 ✅

- DE §32a EStG（2025/2026 双年度，纯税率函数 + Splittingverfahren + SolZ）+ NL Box1/2/3 + PT IRS（含 IFICI）
- F4 LLM harness prompt 骨架 + D1 schema 基线

## 2026-06-03 · 项目启动 ✅

- `2a15c30` Cloudflare Workers + Hono + Drizzle + Solid 脚手架
- 技术选型定稿：SolidStart + Hono + D1 + Better Auth + Creem（支付字段 provider-agnostic，换 PSP 不迁移）

---

## 附录：项目状态快照（2026-08-24）

| 维度 | 状态 |
|---|---|
| 功能 | F1 计算器 / F2 居留 / F3 PDF / F4 策略 / F5 RAG / F6 日历 / F7 dashboard+onboarding / F9 截止日 全部上线 |
| 商业 | 免费获客引擎（/compare）+ Pro 付费墙已上线；Creem 支付闭环 |
| 测试 | 84 文件 / 896 用例全绿；CI 四件套（typecheck/lint/test/build） |
| 部署 | main push → CI → taxmora.com，约 2 分钟生效 |
| 已知债务 | email 验证未开启；队列 consumer 未实现；前端无 router/共享组件库；es.beckham lastVerified 待修 |
