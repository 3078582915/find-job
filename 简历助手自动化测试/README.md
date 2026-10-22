# 简历助手自动化测试

使用 **pytest + Playwright Python + requests**。用例连接真实本地 Express、React 和独立 SQLite，模型网络请求由本地 OpenAI-compatible 模拟服务响应；Agent 的 LangGraph、工具、确认动作和数据库写入仍执行实际项目代码。

## 快速运行

需要 Python 3.10+、项目要求的 Node.js，以及已安装的前后端 npm 依赖。无需先手动启动项目。

1. 首次使用，双击本目录 `安装测试环境.cmd`，创建独立 Python 环境并安装依赖及 Chromium（需要联网）。
2. 双击 `一键测试.cmd`。
3. 打开 `reports/report.html` 查看结果。

当前电脑已有 Python、pytest、Playwright 和 requests，可直接运行测试；脚本优先使用本目录 `.venv`，不存在时使用 PATH 中的 Python。

也可以在本目录终端运行：

```powershell
python run_tests.py -q

# 仅测试后端接口
python run_tests.py -q -m api

# 仅测试浏览器流程，并显示浏览器窗口
python run_tests.py -q -m e2e --headed

# 指定已安装的 Google Chrome / Edge
python run_tests.py -q --browser-channel chrome
python run_tests.py -q --browser-channel msedge

# 只运行 Agent 相关用例
python run_tests.py -q -m agent
```

若使用安装脚本创建了虚拟环境，将上面的 `python` 替换为 `.venv\Scripts\python.exe`。默认尝试 Playwright Chromium，不存在或无权读取时使用已安装的 Chrome；都没有时运行 `python -m playwright install chromium`。

推荐使用 `run_tests.py`，它禁用电脑全局安装的第三方 pytest 插件，避免其他项目的插件影响本套测试。直接 `python -m pytest` 也会生成 HTML / JSON；JUnit XML 由运行脚本启用。请串行运行，不要使用 pytest-xdist 的 `-n`。

## 已覆盖范围

| 模块 | 核心验证 |
| --- | --- |
| 简历 | 创建、内容存储、修改、默认唯一、删除、空名称、空白名称、不存在的 ID |
| 职位 | 空库、关键词/城市/平台组合筛选、缺薪资/公司、分页边界、薪资私有字体解码 |
| 查看记录 | 重复点击不重复入库、已查看/未查看筛选、历史记录一致性 |
| 清理与统计 | 批量删除去重、关联点击和 RAG 索引清理、统计与数据库一致 |
| RAG | 建立真实本地索引并召回相关职位 |
| 校招官网 | 增改删、重复 URL、可信来源校验、收藏、状态及时间戳、按筛选导出 CSV |
| Agent | 配置密钥脱敏、本地连接测试、SSE token、真实搜索/统计工具、会话持久化和多轮对话 |
| 确认机制 | 准备不执行、取消后不能执行、重复确认被拒绝、过期拒绝、未登录时不抓取 |
| 浏览器 | 页面加载、简历新增/默认/删除、职位组合筛选/批删、校招新增/收藏/状态/下载/删除、Agent 搜索与取消、接口失败提示 |

简历的“编辑”通过 API 测试：当前简历页面没有编辑操作入口。项目“投递记录”接口实际返回 `job_clicks`，测试验证查看记录，不能据此宣称已成功投递。

## 隔离与实现说明

- 每次运行在 `.runtime/<随机编号>/` 建立独立数据库、模型配置和登录状态目录，不读取或改写 `server/data/`。
- 前后端自动选择临时端口，前端代理指向本次测试后端；结束后停止本次启动的服务。
- 每条用例前恢复初始种子数据，浏览器用例每条创建新 context，不依赖执行顺序。
- 模型只访问本机模拟服务，使用假的测试 Key；不加载真实 `server/.env`，不消耗模型额度。
- 浏览器仅允许访问本次前端地址；真实招聘网站、搜索服务、扫码登录和真实投递不属于日常自动回归范围。
- 确认执行用例使用没有登录态的 BOSS 路径，验证 `needLogin` 和禁止重复执行，不启动招聘平台浏览器。
- `.runtime` 留存假数据用于排查，可在测试结束后删除其中旧运行目录；`reports` 每次更新为最近一次测试结果。
- 项目源码仅增加 `APP_DATA_DIR`、`PORT`、`APP_CLIENT_ORIGIN` 和 `API_PROXY_TARGET` 配置支持；不设置时沿用原有路径与端口。

为了减少额外依赖，浏览器生命周期、失败截图、trace 和 HTML 报告由本目录 pytest fixtures/hooks 管理，不要求安装 pytest-playwright 或 pytest-html。

## 报告与排错

- `reports/report.html`：可直接打开的中文 HTML 结果，失败用例展开可见堆栈。
- `reports/results.json`：机器可读汇总及每条用例结果。
- `reports/junit.xml`：供 CI 使用，测试失败返回非零退出码。
- `reports/backend.log`、`reports/frontend.log`：本次自动启动服务的日志。
- `reports/artifacts/*.png`、`*-trace.zip`：浏览器用例失败时保存的截图和轨迹。

查看 trace：

```powershell
python -m playwright show-trace reports/artifacts/具体文件-trace.zip
```

测试失败需要区分产品缺陷和环境/用例问题。发现的产品缺陷保留失败断言，在 `测试发现.md` 记录复现步骤，不标记跳过或把错误行为改成预期行为。

## 当前边界

这套测试覆盖本地功能和可控模型协议联调，不能证明真实模型的理解质量、外部官网发现准确率、招聘平台页面兼容性、验证码处理或真实投递成功。性能压力、跨浏览器完整矩阵和第三方服务联调尚未覆盖。
