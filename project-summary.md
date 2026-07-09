# 多平台自动投简历 - 项目总结

## 1. 项目目标

打造一个真正可用的**多平台职位聚合与自动投递助手**，目前重点打通 **BOSS直聘** 平台：
- 用户扫码/验证登录 BOSS直聘
- 自动抓取目标职位列表
- 持久化登录态，支持多次抓取复用
- 前端可视化展示职位、管理平台和投递设置

## 2. 核心需求

| 模块 | 需求 |
|------|------|
| **登录** | 弹出真实 Chrome 窗口，用户完成 BOSS直聘扫码/验证登录，系统保存登录态 |
| **抓取** | 根据关键词、城市、页数抓取 BOSS直聘职位，解析标题、公司、薪资、地点、经验、学历等字段 |
| **持久化** | 登录态以 cookies 形式保存到本地文件，后端重启后可复用 |
| **展示** | 前端展示职位列表、统计、投递记录，支持筛选分页 |
| **扩展性** | 架构预留智联招聘、前程无忧、拉勾网等平台接入 |

## 3. 技术要求

- **前端**：React + Vite + Tailwind CSS + Zustand
- **后端**：Express + TypeScript + better-sqlite3
- **爬虫**：Playwright + Chrome 远程调试协议（CDP）
- **浏览器**：调用用户本机真实 Chrome，带 `--remote-debugging-port=9222`
- **反爬**：隐藏 `navigator.webdriver`、使用真实 UA、禁用自动化特征

## 4. 已完成功能

- [x] 项目基础架构搭建（前后端、数据库、路由）
- [x] BOSS直聘登录接口与真实 Chrome 弹窗
- [x] 登录态持久化（storage state / cookies）
- [x] 职位列表 API、数据库表、前端展示
- [x] 平台管理页面（登录/登出/状态显示）
- [x] 代码审查发现的 12+ 问题已修复
- [x] CORS 跨域问题修复

## 5. 核心问题与排查过程

### 5.1 问题一：Chrome 登录窗口闪退 / 跳转到 about:blank

**现象**：点击"扫码登录"后，Chrome 窗口只闪一下或短暂出现，随后自动关闭或地址栏变成 `about:blank`，用户来不及扫码。

**已尝试方案**：

| # | 方案 | 结果 |
|---|------|------|
| 1 | `launchPersistentContext` + 全局 context 复用 | 闪退 |
| 2 | `launchPersistentContext` + `channel: 'chrome'` | 报错 "Failed to open a new tab" |
| 3 | `launchPersistentContext` + stealth 脚本 + `newPage` | 跳转 about:blank |
| 4 | `spawn` 真实 Chrome + `connectOverCDP` | 窗口能保持，但 CORS 问题导致前端 500 |
| 5 | 修复 CORS + 简化参数 | **登录成功**，用户可正常扫码 |

**当前状态**：✅ **已解决**。

---

### 5.2 问题二：职位抓取触发 BOSS 反爬，页面跳转到 about:blank

**现象**：登录成功后抓取职位，第一页或第二页经常被 BOSS 反爬系统拦截，Chrome 标签页被跳转到 `about:blank`，前端只能拿到部分职位或失败。

**根因分析**：
- 登录阶段让 Chrome 自然加载页面（无自动化指纹）→ 成功
- 抓取阶段使用 Playwright 的 `page.goto()` / `page.evaluate()` → 被 BOSS 识别为自动化控制 → 拦截

**已尝试/正在尝试方案**：

| # | 方案 | 状态 |
|---|------|------|
| 1 | 复用已登录 tab、注入 stealth 脚本、降低抓取频率 | 仍被拦截 |
| 2 | 改用纯 CDP 协议：`Page.navigate` + `Runtime.evaluate`，全程不经过 Playwright 页面控制 | 已实施，待验证 |

**当前状态**：🔄 **验证中**。

---

### 5.3 问题三：薪资字段显示乱码（□□-□□K）

**现象**：前端职位列表中，职位标题、公司、经验、学历解析正确，但薪资显示为方块乱码。

**可能原因**：
- BOSS直聘使用字体反爬技术，将数字薪资映射为自定义字体/私有 Unicode 区段
- 也可能选择器匹配到的元素文本本身被特殊处理

**当前状态**：🔄 **排查中**。已在代码中加入 `[DEBUG] salary` 日志输出 salary 元素的 `outerHTML` / `textContent` / `innerText`，等待复测日志确认。

## 6. 当前运行状态

- 后端：http://localhost:3001
- 前端：http://localhost:5173
- 登录：✅ 可用
- 抓取：🔄 改用 CDP 方案后待验证
- 薪资解析：🔄 待根据调试日志确认

## 7. 待办事项

- [ ] 验证 CDP 原生导航抓取是否仍被 BOSS 拦截
- [ ] 根据调试日志定位薪资乱码根因（字体反爬 / 选择器问题）
- [ ] 如确认字体反爬，实现字体映射解析
- [ ] 优化抓取稳定性（重试、降级、人工辅助）
- [ ] 接入其他招聘平台（智联、前程无忧、拉勾）
- [ ] 增加法律风险提示与合规使用说明

## 8. 关键文件

- [server/src/crawlers/browser.ts](server/src/crawlers/browser.ts) - Chrome 启动、CDP 连接、cookie 持久化
- [server/src/crawlers/boss.ts](server/src/crawlers/boss.ts) - BOSS直聘职位抓取逻辑
- [server/src/routes/jobs.ts](server/src/routes/jobs.ts) - 职位相关 API
- [server/src/routes/platforms.ts](server/src/routes/platforms.ts) - 平台登录/登出 API
- [client/src/pages/PlatformManagement.tsx](client/src/pages/PlatformManagement.tsx) - 平台管理前端页面
- [client/src/pages/JobSquare.tsx](client/src/pages/JobSquare.tsx) - 职位广场前端页面

## 9. 备注

- 登录状态以 `data/storage-boss.json` 文件存在为唯一判断依据
- 退出登录时必须同时删除该文件并更新数据库
- 后端重启后需要重新执行 BOSS直聘登录流程（因 Chrome 调试实例未持久化保持）
