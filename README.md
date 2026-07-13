# 多平台自动投简历

一个本地运行的招聘职位聚合与投递辅助工具。当前重点支持 BOSS 直聘登录态复用、职位抓取、职位入库、职位筛选、点击记录、简历管理和投递策略配置。

> 注意：本项目用于个人求职辅助。抓取与访问招聘平台时，请遵守目标平台服务条款、robots/反爬策略和当地法律法规。

## 功能概览

- BOSS 直聘扫码登录，并在本地保存登录态。
- 按关键词、城市、页数抓取职位。
- 自动保存职位到本地 SQLite 数据库。
- 支持按平台、关键词、城市、薪资状态、公司名状态、查看状态筛选职位库。
- 记录点击过的职位，区分已查看和未查看。
- 解码 BOSS 直聘薪资中的私有字体数字，例如 `-K·薪` 会显示为 `11-20K·14薪`。
- 管理简历版本和默认简历。
- 配置投递关键词、期望薪资、地点、公司规模、经验、每日上限和打招呼语。
- 提供统计页面和投递记录页面。

## 技术栈

- 前端：React 18、Vite、TypeScript、Tailwind CSS、Zustand、Recharts
- 后端：Express、TypeScript、better-sqlite3
- 浏览器控制：Chrome CDP、Playwright 依赖
- 数据库：SQLite

## 目录结构

```text
.
├── client/                 # React 前端
│   ├── src/pages/          # 页面：职位广场、平台管理、简历管理等
│   ├── src/services/       # API 请求封装
│   ├── src/store/          # Zustand 状态管理
│   └── src/utils/          # 前端显示清洗与薪资解码
├── server/                 # Express 后端
│   ├── src/crawlers/       # Chrome/CDP 与 BOSS 抓取逻辑
│   ├── src/routes/         # API 路由
│   ├── src/database.ts     # SQLite 表结构与种子数据
│   └── src/salaryCodec.ts  # BOSS 薪资私有字体数字解码
├── server/data/            # 本地数据库、Chrome profile、登录态，已被 .gitignore 忽略
├── package.json            # 根目录脚本
└── README.md
```

## 环境要求

- Node.js 18+，建议 20+
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
5. 登录成功后进入“职位广场”。
6. 输入关键词、城市和页数，点击“开始抓取”。
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
- `platform_accounts`：平台账号状态。
- `resumes`：简历数据。
- `delivery_settings`：投递设置。

`server/data/` 包含数据库、Chrome profile 和登录态信息，已被 `.gitignore` 忽略，不应提交到 Git 仓库。

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
*.log
.env
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

- 当前重点支持 BOSS 直聘，其他平台仍是预留结构。
- 自动抓取稳定性受目标平台安全策略影响。
- 自动投递动作尚未做成完整闭环，目前主要是职位聚合、筛选和点击跳转。
- 部分职位信息可能只在详情页展示，列表页无法 100% 获取。

## 后续计划

- 增加详情页补抓，用于补全缺失薪资、地点和公司信息。
- 增加职位收藏、隐藏、不感兴趣标记。
- 增加薪资区间结构化字段，支持按数值排序和筛选。
- 增加导出 CSV / Excel。
- 接入智联招聘、前程无忧、拉勾等平台。
- 增加更清晰的抓取日志和失败原因统计。

