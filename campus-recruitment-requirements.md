# 校招官网模块需求文档

## 1. 背景

当前项目主要围绕多平台岗位抓取、岗位库管理、AI Agent 查询与确认抓取展开，数据来源以 BOSS 直聘、智联招聘、前程无忧、实习僧等岗位列表为主。

接下来计划新增一个独立模块：**校招官网**。

该模块用于收集和管理各公司的校招/内推/招聘官网入口，例如：

- 字节跳动校招官网
- 阿里巴巴/淘宝校招官网
- 蚂蚁集团校招官网
- 腾讯校招官网
- 美团校招官网

这类数据和现有岗位库不是同一种业务对象，因此应单独存储，不混入 `jobs` 表。

## 2. 目标

### 2.1 核心目标

1. 新增“校招官网”页面，用于展示、搜索、添加、编辑、删除公司校招官网信息。
2. 校招官网数据与现有岗位数据分开存储，避免污染 BOSS 等平台岗位库。
3. 支持用户手动添加官网，例如粘贴蚂蚁集团校招/内推链接。
4. 支持 Agent 根据自然语言请求查找官网，例如用户输入“字节跳动校招官网”，Agent 自动搜索并验证官网来源。
5. 只有通过严格验证的官网才生成“打开官网”卡片，用户点击后跳转到官网。
6. 对无法验证或存在歧义的结果，系统不得提供跳转按钮，应明确返回“暂未找到可验证的官方入口”。

### 2.2 准确性原则

本模块采用“宁可找不到，也不能跳错”的失败关闭策略：

1. 搜索结果排名、页面标题和模型判断只能用于发现候选，不能单独证明链接是官网。
2. Agent 自动发现的链接必须具备可追溯的官方证据链，验证通过后才能展示“打开官网”。
3. 使用第三方招聘系统域名时，必须能从公司主站、公司官方招聘页或其他可信官方页面追溯到该链接。
4. 无法完成验证时，系统返回未找到，不允许用“高置信度”代替验证结果。
5. 用户手动添加的链接标记为“用户确认”，与“系统已验证”分开展示。

### 2.3 非目标

v1 暂不做以下能力：

1. 不自动投递校招岗位。
2. 不自动填写校招官网表单。
3. 不绕过验证码、登录、风控。
4. 允许系统在证据不足时返回“未找到”；不允许返回未经验证的链接来凑结果。
5. 不把校招官网页面里的所有岗位详情都抓入现有 `jobs` 表。
6. 不将第三方聚合站伪装成官网。

## 3. 数据设计

### 3.1 新表：`campus_sites`

建议新增独立表：

```sql
CREATE TABLE campus_sites (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  site_name TEXT,
  official_url TEXT NOT NULL,
  domain TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_query TEXT,
  confidence INTEGER DEFAULT 100,
  verification_status TEXT NOT NULL DEFAULT 'user_confirmed',
  verification_method TEXT,
  verification_evidence TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT,
  notes TEXT,
  last_checked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

字段说明：

| 字段 | 含义 |
|---|---|
| `company_name` | 公司名称，例如“蚂蚁集团” |
| `site_name` | 站点名称，例如“蚂蚁集团校招官网” |
| `official_url` | 官网链接 |
| `domain` | 域名，便于去重和展示 |
| `source_type` | 来源：`manual` 手动添加，`agent` Agent 发现 |
| `source_query` | Agent 搜索时的原始问题 |
| `confidence` | 候选排序分，0-100，不作为允许跳转的依据 |
| `verification_status` | 验证状态：`verified`、`user_confirmed`、`unverified`、`rejected` |
| `verification_method` | 验证方式，例如 `official_domain`、`official_referral`、`manual` |
| `verification_evidence` | 验证证据 JSON，保存官方来源页、最终落地页和校验说明 |
| `status` | 状态：`active`、`inactive`、`pending_review` |
| `tags` | 标签 JSON，例如 `["校招", "内推", "技术岗"]` |
| `notes` | 用户备注 |
| `last_checked_at` | 最近一次检查时间 |

### 3.2 可选表：`campus_site_visits`

v1 可先不做。后续如果要统计访问历史，可新增：

```sql
CREATE TABLE campus_site_visits (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES campus_sites(id) ON DELETE CASCADE
);
```

## 4. 页面设计

### 4.1 新增导航

侧边栏新增一级菜单：

```text
校招官网
```

建议放在“职位广场”附近，因为它也是求职入口类数据。

### 4.2 页面功能

页面标题：`校招官网`

主要区域：

1. 顶部统计卡片
   - 官网总数
   - 系统已验证
   - 用户手动确认
   - 验证失败/失效

2. 搜索与筛选
   - 公司名搜索
   - 标签筛选
   - 来源筛选：全部 / 手动 / Agent
   - 验证筛选：全部 / 系统已验证 / 用户确认 / 验证失败
   - 状态筛选：全部 / 正常 / 失效

3. 官网列表
   - 公司名称
   - 官网名称
   - 域名
   - 来源
   - 验证状态
   - 验证依据
   - 最近检查时间
   - 操作：打开、编辑、重新验证、删除

“打开”按钮必须由验证状态控制：仅 `verified` 和用户亲自录入的 `user_confirmed` 记录可见；`unverified`、`rejected` 和 `inactive` 记录不可跳转。

4. 手动添加弹窗
   - 公司名称
   - 官网链接
   - 官网名称
   - 标签
   - 备注

### 4.3 手动添加示例

用户可添加如下链接：

```text
公司名称：蚂蚁集团
官网名称：蚂蚁集团校招/内推官网
官网链接：https://hrrecommend.antgroup.com/job-list.html?source=campus_external_recommend&code=T_dN2oDMsas%2F7M1pcbeNZgPQyH2sYJEaioT37binMeo%3D
来源：manual
标签：校招、内推、技术岗
```

## 5. Agent 工作流

### 5.1 用户输入示例

```text
字节跳动校招官网
```

或：

```text
帮我找一下蚂蚁集团校招官网
```

### 5.2 Agent 处理流程

1. Agent 判断这是“校招官网查找”意图。
2. 调用 `discover_campus_site` 工具。
3. 工具基于搜索引擎或浏览器自动化查询候选官网。
4. 后端对候选链接执行域名、页面内容、重定向和官方证据链验证。
5. 可信度只负责候选排序，验证状态负责决定是否允许跳转。
6. 如果有且只有一个通过验证的官网：
   - 展示“打开官网”按钮。
   - 展示“保存到校招官网库”按钮。
7. 如果存在多个已验证入口，例如校招主页和校招职位列表：
   - 展示每个入口的用途和官方验证依据。
   - 用户选择后再打开或保存。
8. 如果所有候选均无法验证：
   - 返回“暂未找到可验证的官方入口”。
   - 不展示外部跳转按钮，不保存到正式官网库。

### 5.3 Agent 工具设计

#### `discover_campus_site`

用途：根据公司名称搜索校招官网候选。

输入：

```ts
{
  companyName: string;
  keyword?: string; // 默认“校招 官网”
  limit?: number;
}
```

输出：

```ts
{
  candidates: Array<{
    companyName: string;
    siteName: string;
    url: string;
    domain: string;
    confidence: number;
    verificationStatus: 'verified' | 'unverified' | 'rejected';
    verificationMethod?: 'official_domain' | 'official_referral';
    evidenceUrls: string[];
    reason: string;
  }>
}
```

#### `save_campus_site`

用途：保存用户确认过的校招官网。

输入：

```ts
{
  companyName: string;
  siteName?: string;
  officialUrl: string;
  sourceQuery?: string;
  confidence?: number;
  tags?: string[];
  notes?: string;
}
```

#### `search_campus_sites`

用途：查询本地已经保存的校招官网库。

输入：

```ts
{
  keyword?: string;
  sourceType?: 'manual' | 'agent';
  status?: 'active' | 'inactive' | 'pending_review';
  limit?: number;
}
```

## 6. 官网验证规则

Agent 自动发现官网时不能只拿搜索结果第一条就保存。搜索负责召回候选，验证器负责决定候选能否打开。

### 6.1 可直接验证的官方域名

满足以下全部条件时，可标记为 `verified / official_domain`：

1. 域名属于公司已确认的官方根域名或其子域名，例如：
   - `bytedance.com`
   - `jobs.bytedance.com`
   - `antgroup.com`
   - `alibaba.com`
2. 页面可正常访问，最终重定向后仍位于已确认的官方域名内。
3. 页面标题或正文同时包含公司标识及招聘语义，例如：
   - 校招
   - 校园招聘
   - campus
   - career
   - careers
   - jobs
4. 使用 HTTPS，且不是广告、新闻、论坛或第三方聚合页。

### 6.2 第三方招聘系统验证

`moka`、`italent`、`hirede` 等第三方域名不能仅凭页面标题判定为官网入口。只有满足以下条件才能标记为 `verified / official_referral`：

1. 公司官方主站或官方招聘页面存在指向该第三方地址的可追溯链接；或
2. 公司已确认的官方域名通过 HTTP 重定向到该第三方地址；并且
3. 第三方页面展示的公司名称与用户查询公司一致；
4. 保存官方来源页 URL、最终落地 URL 和验证时间作为证据。

### 6.3 必须拒绝的情况

1. 域名属于第三方招聘平台：
   - `zhipin.com`
   - `zhaopin.com`
   - `51job.com`
   - `liepin.com`
   - `nowcoder.com`
   - `shixiseng.com`
2. URL 明显是新闻、论坛、帖子、博客。
3. 页面标题只有“招聘信息汇总”但不属于公司官方域名。
4. 搜索结果来源不明确。
5. 只有搜索摘要或大模型推断，无法找到官方来源页。
6. 公司名称存在歧义，且无法确认目标主体。

### 6.4 跳转与保存策略

| 验证状态 | 行为 |
|---|---|
| `verified` | 可展示“打开官网”和“保存”按钮 |
| `user_confirmed` | 用户手动录入，可打开；界面标记“用户确认” |
| `unverified` | 只显示未验证说明和证据缺口，不提供跳转按钮 |
| `rejected` | 不展示为官网，记录拒绝原因避免重复误判 |

`confidence` 只用于排列待验证候选，任何分数都不能绕过 `verification_status`。

### 6.5 验证执行顺序

1. 优先查询本地已验证官网库和公司官方根域名白名单。
2. 本地没有结果时，再通过搜索召回候选链接。
3. 访问候选页并记录完整重定向链、最终 URL、页面标题和公司标识。
4. 校验最终域名是否属于已验证官方根域名；若属于则按 `official_domain` 验证。
5. 若最终域名属于第三方招聘系统，必须反向找到公司官方页面指向该链接的证据，按 `official_referral` 验证。
6. 命中第三方聚合站、公司主体不一致、证据链断裂或页面不可访问时，标记为 `rejected` 或 `unverified`。
7. 只有 `verification_status = verified` 的 Agent 结果才能发送给前端作为可点击官网。

验证器访问外部链接时还必须限制协议为 HTTP/HTTPS、阻止本机及内网地址、限制重定向次数和请求超时，避免恶意 URL 触发服务端请求风险。

## 7. 后端 API 设计

### 7.1 校招官网 CRUD

```http
GET /api/campus-sites
POST /api/campus-sites
PUT /api/campus-sites/:id
DELETE /api/campus-sites/:id
```

### 7.2 打开记录

v1 可选：

```http
POST /api/campus-sites/:id/visit
```

### 7.3 Agent 发现官网

```http
POST /api/campus-sites/discover
```

请求：

```json
{
  "companyName": "字节跳动"
}
```

响应：

```json
{
  "candidates": [
    {
      "companyName": "字节跳动",
      "siteName": "字节跳动校园招聘",
      "url": "https://jobs.bytedance.com/campus/",
      "domain": "jobs.bytedance.com",
      "confidence": 95,
      "verificationStatus": "verified",
      "verificationMethod": "official_domain",
      "evidenceUrls": ["https://www.bytedance.com/zh/careers"],
      "reason": "链接位于字节跳动官方根域名的招聘子域名，页面公司标识和校招语义一致"
    }
  ]
}
```

## 8. 前端类型设计

```ts
export interface CampusSite {
  id: string;
  company_name: string;
  site_name: string | null;
  official_url: string;
  domain: string | null;
  source_type: 'manual' | 'agent';
  source_query: string | null;
  confidence: number;
  verification_status: 'verified' | 'user_confirmed' | 'unverified' | 'rejected';
  verification_method: 'official_domain' | 'official_referral' | 'manual' | null;
  verification_evidence: string | null;
  status: 'active' | 'inactive' | 'pending_review';
  tags: string | null;
  notes: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}
```

## 9. 前端交互细节

### 9.1 手动添加

用户点击“添加官网”：

1. 输入公司名称和链接。
2. 前端校验 URL 格式。
3. 后端提取 domain。
4. 如果 domain + company_name 已存在，提示是否更新原记录。
5. 保存成功后刷新列表。

### 9.2 打开官网

点击“打开”按钮：

1. 前端用新标签页打开 `official_url`。
2. 可选：后端记录一次访问。

注意：不要让后端强行打开用户浏览器。浏览器跳转应由前端按钮触发，避免被浏览器弹窗策略拦截。

### 9.3 Agent 结果卡片

Agent 返回候选官网卡片：

每张卡展示：

- 公司名称
- 官网名称
- 域名
- 验证状态
- 验证方式和官方证据来源
- 判断理由
- 打开官网（仅 `verified` 或 `user_confirmed` 展示）
- 保存到官网库（Agent 结果仅 `verified` 展示）

## 10. 风险点

1. **搜索结果不稳定**
   - 不同时间、网络、搜索引擎返回结果可能不同，因此搜索结果只用于发现候选，不能直接放行跳转。

2. **官网识别误判**
   - 有些公司使用第三方招聘系统，但仍是官方入口。
   - 例如部分公司使用 `moka`、`italent`、`hirede` 等系统。
   - 必须通过公司官方页面的链接或重定向建立证据链；无法建立时不允许跳转。

3. **URL 过长或带推荐码**
   - 例如蚂蚁集团内推链接会带 `code` 参数。
   - v1 应原样保存，不强行清理参数。

4. **浏览器弹窗限制**
   - Agent 不能可靠地直接打开新标签页。
   - 应返回卡片，由用户点击打开。

5. **公司别名**
   - “淘宝”“阿里”“蚂蚁集团”可能对应不同官网。
   - v1 先按用户输入保存，后续再做公司别名表。

## 11. v1 实施顺序

建议按以下顺序开发：

1. 新增 `campus_sites` 数据表。
2. 新增后端 CRUD API。
3. 新增前端“校招官网”页面和侧边栏入口。
4. 支持手动添加、编辑、删除、打开官网。
5. 新增 Agent 工具：查询本地校招官网库。
6. 新增 Agent 工具：发现并验证校招官网候选。
7. 前端 Agent 卡片仅展示验证通过的官网入口和证据。
8. 对 `verified` 候选支持保存到校招官网库；未验证候选不得保存为可用官网。

## 12. 验收标准

### 12.1 手动添加

给定用户手动添加蚂蚁集团链接：

```text
https://hrrecommend.antgroup.com/job-list.html?source=campus_external_recommend&code=T_dN2oDMsas%2F7M1pcbeNZgPQyH2sYJEaioT37binMeo%3D
```

系统应：

1. 成功保存到 `campus_sites`。
2. 页面能展示“蚂蚁集团”。
3. 点击“打开”能在新标签页打开原始链接。
4. 不影响现有 `jobs` 岗位库。
5. 页面明确标记该记录为“用户确认”，不伪装成“系统已验证”。

### 12.2 Agent 查询本地库

给定本地已保存“蚂蚁集团校招官网”，用户问：

```text
蚂蚁集团校招官网
```

系统应优先返回本地已保存官网，而不是重新抓取岗位。

### 12.3 Agent 发现官网

给定用户问：

```text
字节跳动校招官网
```

系统应：

1. 调用官网发现工具。
2. 对搜索候选完成官方域名或官方引荐证据链验证。
3. 仅对 `verified` 结果返回带“打开官网”按钮的卡片。
4. 显示验证方式、证据来源和判断理由。
5. 如果无法验证，明确返回“暂未找到可验证的官方入口”，并且不提供跳转按钮。
6. 不得仅凭搜索排名、标题匹配或置信度分数允许跳转。

### 12.4 准确性回归用例

1. 搜索结果第一条是 BOSS、牛客或聚合页时，系统不得提供“打开官网”。
2. 第三方 ATS 页面包含公司名称，但找不到公司官方页面引荐时，系统不得提供“打开官网”。
3. 官方页面明确跳转到第三方 ATS，且落地页公司主体一致时，系统可展示跳转并保留完整证据链。
4. 链接重定向到不同公司、广告页、失效页或登录劫持页时，验证失败并禁止跳转。
5. 同名公司无法确定主体时，系统必须先要求用户补充公司全称，不能猜测官网。
6. 已验证链接定期复检；复检失败后自动转为 `inactive` 并隐藏“打开官网”按钮。

## 13. Review 结论

这个需求建议拆成两阶段：

### 阶段一：先做本地官网库

优先实现数据表、CRUD、页面、手动添加和打开官网。

原因：

- 这部分确定性最高。
- 不依赖搜索引擎。
- 能马上解决“我自己添加官网”的核心需求。
- 后续 Agent 发现结果也有地方保存。

### 阶段二：再做 Agent 自动发现官网

Agent 自动发现官网需要处理搜索结果质量、官方证据链、第三方 ATS 域名、跳转和误判，因此建议在本地官网库稳定后再接入。Agent 搜索采用失败关闭策略：允许“暂未找到”，不允许把未验证链接作为官网打开。

本次 Review 后，准确性被设为强制验收门槛：搜索召回率可以低，但对用户展示的 Agent 官网链接必须是已验证结果。模型给出的置信度不能作为跳转授权。

最终架构建议：

```text
campus_sites：校招官网主库
Agent tools：查询本地库 + 发现候选官网 + 验证官方证据链 + 保存已验证官网
前端页面：官网列表 + 手动添加 + Agent 已验证官网卡片
```

不要把校招官网混到现有 `jobs` 表里。它是“公司招聘入口”，不是“岗位记录”。
