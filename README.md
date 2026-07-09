# 多平台自动投简历

一个本地运行的招聘职位聚合与投递辅助工具。当前重点支持 BOSS 直聘登录态复用、职位抓取、职位列表管理、点击记录、简历管理和投递设置。

## 技术栈

- 前端：React、Vite、Tailwind CSS、Zustand、Recharts
- 后端：Express、TypeScript、better-sqlite3
- 浏览器自动化：Playwright + Chrome CDP
- 数据库：SQLite，默认写入 `server/data/app.db`

## 快速启动

```bash
npm run install:all
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health

如果在 PowerShell 中遇到 `npm.ps1` 执行策略拦截，可以改用：

```bash
npm.cmd run dev
npm.cmd run build
```

## 常用脚本

```bash
npm run dev            # 同时启动前后端开发服务
npm run dev:client     # 只启动前端
npm run dev:server     # 只启动后端
npm run build          # 构建前后端
npm run install:all    # 安装根目录、前端、后端依赖
```

## 当前能力

- 平台管理：BOSS 直聘扫码登录，保存本地登录态。
- 职位广场：按关键词、城市、页数抓取职位，支持筛选和点击跳转。
- 投递记录：记录点击过的职位，并提供统计图表。
- 简历管理：维护多个简历版本并设置默认简历。
- 投递设置：保存关键词、薪资、城市、公司规模、经验和节奏设置。

## 注意事项

- `server/data/` 会保存数据库、Chrome profile 和登录态，不应提交到版本库。
- BOSS 直聘抓取依赖真实 Chrome 和用户手动登录，抓取稳定性会受平台安全验证影响。
- 请遵守目标平台服务条款、robots/反爬策略和当地法律法规，仅用于个人合规场景。
