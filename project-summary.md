# 求职 Agent - 项目总结

## 项目定位

项目已经从“自动投简历”调整为本地求职 Agent：用户通过聊天描述职位条件，Agent 查询本地职位库、比较岗位、检查数据质量，并在人工确认后触发职位抓取。系统不执行无人值守投递。

## 当前架构

```text
React Agent 工作台
        │ SSE / REST
Express + TypeScript
        │
LangChain createAgent
        │
LangGraph 工具循环 + MemorySaver
        │
受控工具注册表
  ├─ 职位查询
  ├─ 职位统计
  ├─ 平台状态
  ├─ 求职偏好
  ├─ 数据质量检查
  └─ 抓取确认动作
        │
SQLite + 现有 Chrome CDP 抓取器
```

## 已完成功能

- LangChain 1.x + LangGraph 1.x Agent 后端。
- SSE 流式聊天接口。
- SQLite 会话、消息、偏好、待确认动作和审计日志。
- 结构化职位查询及职位卡片。
- 职位库统计、平台状态和数据质量工具。
- 抓取任务人工确认机制。
- BOSS 直聘、智联招聘、前程无忧、实习僧抓取服务复用。
- Agent 工作台首页、历史会话和候选职位侧栏。
- 模型未配置状态和 OpenAI-compatible 配置。

## 安全边界

- 模型不能执行 SQL、Shell 或任意浏览器指令。
- 工具使用 Zod 校验参数并使用预定义 SQL。
- 职位文本视为不可信外部数据，不能改变 Agent 系统指令。
- Cookie 和登录态不会暴露给模型。
- 抓取需要确认；自动投递、验证码破解和自动聊天不提供工具。
- 所有工具调用与确认动作写入审计日志。

## 关键文件

- `server/src/agent/agentService.ts`：LangGraph Agent 和流式执行。
- `server/src/agent/tools.ts`：Agent 工具注册表。
- `server/src/agent/repository.ts`：会话、消息、偏好和动作存储。
- `server/src/services/jobService.ts`：REST 与 Agent 共用的职位服务。
- `server/src/routes/agent.ts`：Agent API 和确认接口。
- `client/src/pages/AgentWorkspace.tsx`：Agent 工作台。
- `client/src/components/agent/AgentArtifacts.tsx`：职位、统计和确认组件。

## 下一阶段

- 增加收藏、排除公司和岗位评分。
- 将薪资结构化为可排序数值字段。
- 增加会话摘要，限制长期对话上下文长度。
- 接入 LangSmith 或自建 Agent 运行追踪。
- 在取得平台许可的前提下优先改用官方 API。
