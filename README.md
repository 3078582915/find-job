# 多平台找工作助手

> ⚠️ **风险提示：本项目仅供学习研究使用，请勿用于生产环境或高频、大规模自动化操作。招聘平台（如 BOSS 直聘）对自动化访问有严格的反爬与风控策略，使用本项目存在账号被封禁、登录态失效、IP 被限制等风险。强烈建议使用小号/测试账号进行操作，切勿使用重要求职账号。**

一个本地运行的求职 Agent。项目使用 **LangChain + LangGraph** 理解自然语言，通过受控工具查询 SQLite 职位库、统计数据、检查平台状态、保存求职偏好，并在用户确认后调用现有抓取服务。最终投递仍由用户在招聘平台官网完成。

## 功能亮点

- 🤖 **自然语言交互**：用聊天方式找职位，例如“找北京 15K 以上、经验不限的 Agent 岗位”。
- 🧠 **RAG 语义检索**：本地哈希向量索引职位库，支持“相关岗位、类似方向”等模糊语义召回，无需外部 Embedding API。
- 🎓 **校招官网模块**：独立管理公司校招/内推官网入口，支持投递状态跟踪；Agent 可通过外部搜索 + 页面内容交叉验证动态发现官网，证据不足时标记“待人工确认”，遵循“宁可找不到，也不能跳错”原则。
- 🔍 **多平台职位聚合**：支持 BOSS 直聘、智联招聘、前程无忧、实习僧等平台登录与职位抓取。
- 💾 **本地数据持久化**：职位、点击记录、会话、求职偏好全部保存在本地 SQLite。
- 🛡️ **人工确认机制**：抓取属于有副作用操作，Agent 只创建确认卡片，用户确认后才执行。
- 🔐 **安全存储 API Key**：模型配置保存在本地 `server/data/agent-model.json`，不会提交到 Git。
- 📊 **职位库统计**：实时查看总职位数、薪资缺失、公司缺失、已查看/未查看等统计。

## 目录

- [功能概览](#功能概览)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [环境要求](#环境要求)
- [安装依赖](#安装依赖)
- [配置 Agent 模型](#配置-agent-模型)
- [启动开发环境](#启动开发环境)
- [构建项目](#构建项目)
- [常用脚本](#常用脚本)
- [使用流程](#使用流程)
- [数据存储](#数据存储)
- [职位库筛选](#职位库筛选)
- [主要 API](#主要-api)
- [查看数据库](#查看数据库)
- [Git 初始化建议](#git-初始化建议)
- [常见问题](#常见问题)
- [当前限制](#当前限制)
- [后续计划](#后续计划)
- [免责声明](#免责声明)

## 功能概览

- 使用自然语言筛选职位，支持精确关键词与 RAG 语义检索两种模式。
- LangGraph 驱动模型与工具循环，并保存多轮会话。
- 聊天结果直接展示职位、公司、薪资、城市和官方链接卡片。
- 查询职位库统计、缺失薪资、缺失公司和平台登录状态。
- 保存关键词、城市、最低薪资和平台等求职偏好。
- 支持 BOSS 直聘、智联招聘、前程无忧和实习僧登录/抓取适配。
- 自动保存职位到本地 SQLite 数据库，并增量构建语义索引（`job_embeddings`）。
- 支持按平台、关键词、城市、薪资状态、公司名状态、查看状态筛选职位库。
- 记录点击过的职位，区分已查看和未查看。
- 解码 BOSS 直聘薪资中的私有字体数字，例如 `-K·薪` 会显示为 `11-20K·14薪`。
- 校招官网模块：展示、搜索、添加、编辑、删除公司校招/内推官网入口，区分“系统已验证”与“用户已确认”两种可信来源，并支持按投递状态筛选与标记（未投递 / 已投递 / 流程终止）。
- Agent 发现校招官网时优先查本地官网库，未命中时通过外部搜索 + 页面内容交叉验证（域名归属、校招语义、多查询互证）动态发现；高置信度结果自动入库，证据不足时展示“待人工确认”候选卡片，绝不提供未经验证的跳转链接。
- 提供数据概览、查看记录和校招官网管理页面。

## 技术栈

- 前端：React 18、Vite、TypeScript、Tailwind CSS、Zustand、Recharts、Lucide
- Agent：LangChain 1.x、LangGraph 1.x、结构化工具调用、SSE 流式输出
- 模型：OpenAI，或支持工具调用的 OpenAI-compatible API
- 后端：Express、TypeScript、Zod、better-sqlite3
- 检索：本地哈希词袋向量（512 维）+ 余弦相似度，同义词扩展，无需外部 Embedding 服务
- 浏览器控制：Chrome CDP
- 数据库：SQLite

## 目录结构

```text
.
├── client/                 # React 前端
│   ├── src/pages/          # 页面：职位广场、平台管理、简历管理、校招官网、Agent 聊天等
│   ├── src/services/       # API 请求封装
│   ├── src/store/          # Zustand 状态管理
│   └── src/utils/          # 前端显示清洗与薪资解码
├── server/                 # Express 后端
│   ├── src/agent/          # LangGraph Agent、工具、提示词、会话仓储
│   ├── src/crawlers/       # Chrome/CDP 与 BOSS 抓取逻辑
│   ├── src/routes/         # API 路由（含校招官网 campusSites.ts）
│   ├── src/services/       # 职位业务、RAG 语义检索、校招官网服务
│   ├── src/database.ts     # SQLite 表结构与种子数据
│   └── src/salaryCodec.ts  # BOSS 薪资私有字体数字解码
├── server/data/            # 本地数据库、Chrome profile、登录态、模型配置，已被 .gitignore 忽略
├── campus-recruitment-requirements.md  # 校招官网模块需求文档
├── package.json            # 根目录脚本
└── README.md
```

## 环境要求

- Node.js 20+
- npm
- Windows + Chrome 浏览器
- PowerShell 或 CMD

## 安装依赖

在项目根目录执行：

```powershell
cd "D:\VibeCoding\多平台自动投简历"
npm.cmd run install:all
```

如果你的 PowerShell 没有执行策略限制，也可以用：

```powershell
npm run install:all
```

## 配置 Agent 模型

推荐直接打开 `http://localhost:5173/`，点击 Agent 页右上角的“模型设置”按钮。界面支持：

- DeepSeek、OpenAI 和自定义 OpenAI-compatible 服务
- 填写 API Key、模型名称和服务地址
- 连接测试、密钥掩码显示和清除密钥
- 保存后立即生效，无需重启服务

界面保存的配置位于本机 `server/data/agent-model.json`。该目录已被 Git 忽略，后端接口不会向浏览器返回 Key 明文。

也可以继续通过环境变量配置。复制配置示例：

```powershell
Copy-Item server/.env.example server/.env
```

使用 OpenAI：

```dotenv
AGENT_API_KEY=你的密钥
AGENT_MODEL=gpt-4.1-mini
AGENT_BASE_URL=
```

使用支持工具调用的 OpenAI-compatible 服务时，同时填写对应地址：

```dotenv
AGENT_API_KEY=你的密钥
AGENT_MODEL=服务商提供的模型名称
AGENT_BASE_URL=https://example.com/v1
```

界面配置优先于环境变量。密钥只由后端读取；`server/.env`、`server/data`、数据库、Cookie 和 Chrome profile 均已被 `.gitignore` 忽略。

## 启动开发环境

```powershell
npm.cmd run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health

如果出现 `npm.ps1` 执行策略错误，使用 `npm.cmd` 版本命令即可：

```powershell
npm.cmd run dev
npm.cmd run build
```

## 构建项目

```powershell
npm.cmd run build
```

构建会依次执行：

- `server` TypeScript 编译
- `client` TypeScript 检查和 Vite 打包

## 常用脚本

```powershell
npm.cmd run dev            # 同时启动前后端开发服务
npm.cmd run dev:client     # 只启动前端
npm.cmd run dev:server     # 只启动后端
npm.cmd run build          # 构建前后端
npm.cmd run install:all    # 安装根目录、前端、后端依赖
```

## 使用流程

1. 启动项目。
2. 打开前端：http://localhost:5173
3. 进入“平台管理”。
4. 点击 BOSS 直聘扫码登录。
5. 登录成功后进入“职位广场”或“求职 Agent”。
6. 用自然语言描述需求，或在职位广场输入关键词、城市和页数抓取。
7. 抓取结果会自动写入本地数据库。
8. 使用职位库筛选项查看、筛选、点击跳转投递。

## 数据存储

本项目使用 SQLite，本地数据库路径：

```text
server/data/app.db
```

核心表：

- `jobs`：职位库，保存平台、职位名、公司名、薪资、地点、经验、学历、URL、抓取时间等。
- `job_clicks`：点击记录，用于标记已查看职位。
- `job_embeddings`：RAG 语义索引，按职位分块存储 512 维哈希向量与原始文本。
- `campus_sites`：校招官网库，保存公司名、官网链接、验证状态、验证证据、来源类型（手动/Agent）、投递状态（未投递/已投递/流程终止）等。
- `platform_accounts`：平台账号状态。
- `resumes`：简历数据。
- `delivery_settings`：投递设置。
- `agent_conversations` / `agent_messages`：Agent 会话与消息。

`server/data/` 包含数据库、Chrome profile、登录态信息和模型配置，已被 `.gitignore` 忽略，不应提交到 Git 仓库。

## 职位库筛选

前端“职位广场”支持：

- 平台筛选：全部平台 / BOSS 直聘等
- 关键词筛选：职位名或公司名
- 城市筛选
- 薪资筛选：全部薪资 / 有薪资 / 薪资缺失
- 公司筛选：全部公司 / 有公司名 / 公司名缺失
- 查看状态：全部查看状态 / 未查看 / 已查看

后端接口同样支持这些筛选参数：

```text
GET /api/jobs?keyword=测试开发
GET /api/jobs?salaryStatus=missing
GET /api/jobs?salaryStatus=present
GET /api/jobs?companyStatus=missing
GET /api/jobs?companyStatus=present
GET /api/jobs?clickStatus=unclicked
GET /api/jobs?clickStatus=clicked
```

职位库统计接口：

```text
GET /api/jobs/library-summary
```

返回示例：

```json
{
  "totalJobs": 68,
  "salaryPresent": 44,
  "salaryMissing": 24,
  "companyPresent": 56,
  "companyMissing": 12,
  "clicked": 8,
  "unclicked": 60,
  "databasePath": "server/data/app.db"
}
```

## 主要 API

```text
GET    /api/health
GET    /api/statistics

GET    /api/agent/status
GET    /api/agent/conversations
POST   /api/agent/conversations
GET    /api/agent/conversations/:id/messages
DELETE /api/agent/conversations/:id
POST   /api/agent/chat                       # SSE
POST   /api/agent/actions/:id/confirm
POST   /api/agent/actions/:id/cancel

GET    /api/platforms
POST   /api/platforms/boss/login
DELETE /api/platforms/:name/logout
GET    /api/platforms/:name/login-status

POST   /api/jobs/crawl
GET    /api/jobs
GET    /api/jobs/statistics
GET    /api/jobs/library-summary
POST   /api/jobs/:id/click

GET    /api/resumes
POST   /api/resumes
PUT    /api/resumes/:id
DELETE /api/resumes/:id

GET    /api/delivery/settings
PUT    /api/delivery/settings
GET    /api/delivery/records

GET    /api/campus-sites
GET    /api/campus-sites/stats
GET    /api/campus-sites/:id
POST   /api/campus-sites
POST   /api/campus-sites/discover
PUT    /api/campus-sites/:id
PATCH  /api/campus-sites/:id/application-status
DELETE /api/campus-sites/:id
```

## 查看数据库

推荐方式：

1. 使用页面筛选查看职位库。
2. 使用接口查看，例如：

```text
http://localhost:3001/api/jobs?salaryStatus=missing
http://localhost:3001/api/jobs/library-summary
```

3. 使用 SQLite 工具打开：

```text
D:\VibeCoding\多平台自动投简历\server\data\app.db
```

可选工具：

- DB Browser for SQLite
- VS Code SQLite 插件
- JetBrains Database 工具

## Git 初始化建议

如果这是一个新项目仓库：

```powershell
cd "D:\VibeCoding\多平台自动投简历"
git init
git branch -M main
git add .
git commit -m "Initial project snapshot"
```

如果要推送到远程仓库：

```powershell
git remote add origin <你的仓库地址>
git push -u origin main
```

已忽略的重要目录：

```text
node_modules/
client/node_modules/
server/node_modules/
client/dist/
server/dist/
server/data/
server/.env
*.log
```

## 常见问题

### PowerShell 提示无法加载 npm.ps1

使用 `npm.cmd`：

```powershell
npm.cmd run dev
```

### BOSS 页面跳转到 about:blank

通常是平台访问限制、安全验证或调试浏览器状态异常。建议：

- 暂停连续抓取。
- 在弹出的 Chrome 中手动打开 BOSS 直聘并正常搜索一次。
- 如出现验证，先手动完成。
- 等一段时间后只抓 1 页重试。
- 必要时在平台管理里退出 BOSS 登录后重新扫码登录。

### 部分职位没有薪资

可能原因：

- BOSS 卡片本身没有展示薪资。
- 岗位显示为面议、薪资 open 或详情页才显示。
- 页面结构变化导致选择器未命中。

项目已处理 BOSS 私有字体薪资数字，并尽量从职位卡片中提取 `11-20K·14薪`、`250-400元/天`、`薪资open`、`面议` 等格式。

### 已抓取的历史数据不更新

项目使用 `job_hash` 去重。同一职位再次抓取时会执行 upsert，刷新职位名、公司名、薪资、地点、标签等字段。

### Chrome 登录态保存在哪里

在：

```text
server/data/storage-boss.json
server/data/chrome-profile-boss/
```

这些文件属于本地敏感数据，不要提交到 Git。

## 当前限制

- Agent 必须连接支持结构化工具调用的聊天模型。
- 当前使用内存 checkpointer 保存运行期 LangGraph 状态，同时将用户/助手消息持久化到 SQLite；服务重启后会从消息表恢复上下文。
- 自动抓取稳定性受目标平台安全策略影响。
- Agent 不会破解验证码，也不会自动投递或自动联系招聘方。
- 抓取动作必须由用户在聊天界面确认，目前单次最多 3 页。
- 部分职位信息可能只在详情页展示，列表页无法 100% 获取。

## 后续计划

- 增加详情页补抓，用于补全缺失薪资、地点和公司信息。
- 增加 Agent 候选清单、隐藏和不感兴趣标记。
- 增加导出 CSV / Excel。
- 持续维护智联招聘、前程无忧、实习僧等平台适配。
- 持续扩充校招官网域名提示库，提升外部搜索交叉验证的覆盖与准确率。
- 增加 LangSmith 可观测性、工具耗时和失败原因统计。

## 免责声明

1. **学习研究目的**：本项目仅供个人学习、研究浏览器自动化、数据抓取和全栈开发技术使用。
2. **合规使用**：使用本项目访问任何第三方平台时，请严格遵守目标平台的用户协议、服务条款、robots 协议及相关法律法规。请勿用于商业用途、批量爬取、绕过平台安全机制或干扰平台正常运营。
3. **账号风险**：自动化操作可能导致目标平台账号被封禁、登录态失效、IP 受限等后果。**强烈建议使用不重要的测试账号/小号进行操作，切勿使用主求职账号。**
4. **责任自负**：作者不对因使用本项目而产生的任何账号损失、数据丢失、法律纠纷或其他后果承担责任。使用即表示您已充分理解并自愿承担相关风险。
5. **数据隐私**：项目运行过程中会在本地保存 cookies、登录态、简历等敏感信息，请妥善保管本地 `server/data/` 目录，避免泄露或被提交到公开仓库。
