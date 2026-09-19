import 'dotenv/config';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph';
import { createAgent } from 'langchain';
import { createAgentTools } from './tools';
import { AGENT_SYSTEM_PROMPT } from './systemPrompt';
import { getAgentRuntimeConfig, getSafeAgentConfig } from './config';
import {
  appendMessage,
  createPendingAction,
  listPendingActions,
  listMessages,
  type AgentMessageRecord,
} from './repository';
import { PLATFORM_CONFIG, isSupportedPlatform } from '../platformRegistry';
import { getCampusSiteById } from '../services/campusSiteService';

export interface AgentArtifact {
  kind: string;
  [key: string]: unknown;
}

export interface AgentStreamCallbacks {
  onToken?: (token: string) => void;
  onToolStart?: (toolName: string, input: unknown) => void;
  onToolEnd?: (toolName: string, output: unknown) => void;
  onArtifact?: (artifact: AgentArtifact) => void;
}

export class AgentConfigurationError extends Error {}
export class AgentModelConnectionError extends Error {}

const checkpointer = new MemorySaver();
const activeThreads = new Set<string>();
let model: ChatOpenAI | null = null;

export function getAgentStatus() {
  const config = getSafeAgentConfig();
  return {
    configured: config.configured,
    model: config.model,
    baseUrl: config.baseUrl,
    provider: config.provider,
    framework: 'LangChain + LangGraph',
    capabilities: [
      'RAG 语义职位检索',
      '职位自然语言筛选',
      '职位库统计',
      '平台状态检查',
      '求职偏好记忆',
      '人工确认后抓取',
      '校招官网查询与官方入口验证',
      '外部校招官网搜索与页面交叉验证',
    ],
  };
}

function getModel() {
  const config = getAgentRuntimeConfig();
  if (!config.apiKey) {
    throw new AgentConfigurationError(
      'Agent 尚未配置模型密钥，请在 server/.env 中设置 AGENT_API_KEY 和 AGENT_MODEL。',
    );
  }
  if (model) return model;

  const baseURL = config.baseUrl;
  model = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: 0.1,
    maxRetries: 2,
    timeout: 60000,
    streamUsage: !baseURL,
    configuration: baseURL ? { baseURL } : undefined,
  });
  return model;
}

export function resetAgentModel() {
  model = null;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error || '');
}

export function normalizeAgentError(error: unknown) {
  if (error instanceof AgentConfigurationError) return error;
  if (error instanceof AgentModelConnectionError) return error;

  const message = errorText(error);
  const config = getSafeAgentConfig();
  const target = config.baseUrl || 'OpenAI 官方接口';

  if (/Connection error|fetch failed|network|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|TLS|socket/i.test(message)) {
    return new AgentModelConnectionError(
      `模型服务连接失败：当前无法连接 ${target}。请检查网络、代理、防火墙和模型服务地址；如果浏览器能访问但 Node 服务不能访问，请在启动终端配置 HTTP_PROXY/HTTPS_PROXY 后重启项目。当前模型：${config.model}。`,
    );
  }

  if (/401|unauthorized|invalid.*api.?key|incorrect.*api.?key/i.test(message)) {
    return new AgentConfigurationError('模型认证失败：API Key 无效或已过期，请在模型设置里重新填写 Key。');
  }

  if (/404|model.*not.*found|invalid.*model/i.test(message)) {
    return new AgentConfigurationError(`模型名称不可用：${config.model}。请在模型设置里改成服务商支持的模型名称，例如 DeepSeek 可先尝试 deepseek-v4-flash。`);
  }

  return error instanceof Error ? error : new Error(message || 'Agent 运行失败');
}

export async function testAgentModelConnection() {
  const startedAt = Date.now();
  try {
    const response = await getModel().invoke([
      new HumanMessage('Reply with exactly OK.'),
    ]);
    return {
      success: true,
      latencyMs: Date.now() - startedAt,
      response: contentToText(response.content).trim().slice(0, 100),
    };
  } catch (error) {
    throw normalizeAgentError(error);
  }
}

function databaseMessageToLangChain(message: AgentMessageRecord): BaseMessage {
  if (message.role === 'assistant') return new AIMessage(message.content);
  return new HumanMessage(message.content);
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block: any) => {
    if (typeof block === 'string') return block;
    if (block?.type === 'text' && typeof block.text === 'string') return block.text;
    return '';
  }).join('');
}

function extractFinalText(output: any): string {
  const messages = output?.messages;
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const type = typeof message?._getType === 'function' ? message._getType() : message?.type;
    if (type === 'ai' || message?.constructor?.name?.includes('AIMessage')) {
      const text = contentToText(message.content);
      if (text) return text;
    }
  }
  return '';
}

function parseToolOutput(output: any) {
  const content = typeof output === 'string' ? output : output?.content;
  if (typeof content !== 'string') return output;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function artifactKey(artifact: AgentArtifact) {
  const action = artifact.action as any;
  if (action?.id) return `${artifact.kind}:${action.id}`;
  const jobs = artifact.jobs as any[] | undefined;
  if (jobs?.length) return `${artifact.kind}:${jobs.map((job) => job.id).join(',')}`;
  const campusSites = artifact.campusSites as any[] | undefined;
  if (campusSites?.length) return `${artifact.kind}:${campusSites.map((site) => site.url).join(',')}`;
  return JSON.stringify(artifact);
}

function campusPersistenceReceipt(receipts: any[]) {
  if (!receipts.length) return '';

  const reportedSavedCount = receipts.reduce((total, receipt) => total + Number(receipt.savedCount || 0), 0);
  const recordIds = [...new Set(receipts.flatMap((receipt) => Array.isArray(receipt.recordIds) ? receipt.recordIds : []))];
  const verifiedSavedCount = recordIds.filter((id) => typeof id === 'string' && Boolean(getCampusSiteById(id))).length;
  const existingCount = receipts.reduce((total, receipt) => total + Number(receipt.existingCount || 0), 0);
  const reportedFailedCount = receipts.reduce((total, receipt) => total + Number(receipt.failedCount || 0), 0);
  const processedCount = reportedSavedCount + existingCount + reportedFailedCount;
  const unverifiableCount = Math.max(0, reportedSavedCount - verifiedSavedCount);
  const failedCount = reportedFailedCount + unverifiableCount;
  return `数据库入库回执：本轮处理 ${processedCount} 条，新增 ${reportedSavedCount} 条（写入后复核成功 ${verifiedSavedCount} 条），本轮重复未新增 ${existingCount} 条，失败 ${failedCount} 条。该回执为本轮操作统计，不代表库内总记录数。`;
}

function normalizeCampusSiteUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.hash === '#' || url.hash === '#/') url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    url.searchParams.sort();
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function campusSiteCardKey(site: any) {
  return `${String(site?.companyName || '').trim().toLowerCase()}|${normalizeCampusSiteUrl(String(site?.url || ''))}`;
}

function coalesceCampusSiteArtifacts(artifacts: AgentArtifact[]) {
  const merged: AgentArtifact[] = [];
  let campusArtifact: AgentArtifact | undefined;
  const campusSiteIndexes = new Map<string, number>();

  for (const artifact of artifacts) {
    const sites = Array.isArray(artifact.campusSites) ? artifact.campusSites as any[] : [];
    if (artifact.kind !== 'campus_sites' || !sites.length) {
      merged.push(artifact);
      continue;
    }
    if (!campusArtifact) {
      campusArtifact = { kind: 'campus_sites', campusSites: [] };
      merged.push(campusArtifact);
    }
    const mergedSites = campusArtifact.campusSites as any[];
    for (const site of sites) {
      const key = campusSiteCardKey(site);
      const existingIndex = campusSiteIndexes.get(key);
      if (existingIndex === undefined) {
        campusSiteIndexes.set(key, mergedSites.length);
        mergedSites.push(site);
        continue;
      }
      const current = mergedSites[existingIndex];
      const saved = Boolean(current.saved || site.saved);
      mergedSites[existingIndex] = {
        ...current,
        ...site,
        verificationStatus: current.verificationStatus === 'verified' || site.verificationStatus === 'verified'
          ? 'verified'
          : 'user_confirmed',
        evidenceUrls: [...new Set([...(current.evidenceUrls || []), ...(site.evidenceUrls || [])])],
        saved,
        saveable: saved || current.saveable === false || site.saveable === false ? false : site.saveable,
      };
    }
  }
  return merged;
}

function hasCampusSaveIntent(message: string) {
  return /校招|招聘|官网/.test(message) && /入库|保存|写入|整理.*库|汇总.*库/.test(message);
}

function pendingActionToArtifact(action: any): AgentArtifact | null {
  if (action.action_type !== 'crawl_jobs') return null;
  const payload = action.payload || {};
  const platform = PLATFORM_CONFIG.find((item) => item.name === payload.platform);
  const label = platform?.label || payload.platform || '招聘平台';
  return {
    kind: 'confirmation',
    action: {
      id: action.id,
      actionType: action.action_type,
      title: `抓取 ${label} 职位`,
      description: `${payload.query || ''} · ${payload.city || '全国'} · ${payload.pages || 1} 页`,
      payload,
      expiresAt: action.expires_at,
      status: action.status,
    },
  };
}

function appendMissingPendingActionArtifacts(
  conversationId: string,
  userId: string,
  artifacts: AgentArtifact[],
  seenArtifacts: Set<string>,
) {
  for (const action of listPendingActions(conversationId, userId, ['pending', 'processing'])) {
    const artifact = pendingActionToArtifact(action);
    if (!artifact) continue;
    const key = artifactKey(artifact);
    if (seenArtifacts.has(key)) continue;
    seenArtifacts.add(key);
    artifacts.push(artifact);
  }
}

function hasConfirmationArtifact(artifacts: AgentArtifact[]) {
  return artifacts.some((artifact) => artifact.kind === 'confirmation' && (artifact.action as any)?.id);
}

function lineValue(text: string, labels: string[]) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[*`>#\-•]/g, '').trim();
    if (!labels.some((label) => line.includes(label))) continue;
    const parts = line.split(/[:：]/);
    if (parts.length < 2) continue;
    return parts.slice(1).join('：').trim();
  }
  return '';
}

function normalizePlatformName(value: string) {
  const text = value.toLowerCase();
  if (/boss|直聘/.test(text)) return 'boss';
  if (/智联|zhilian|zhaopin/.test(value)) return 'zhilian';
  if (/51|前程|无忧/.test(value)) return '51job';
  if (/实习僧|shixiseng/.test(value)) return 'shixiseng';
  return 'boss';
}

function inferQueryFromUserMessage(message: string) {
  return message
    .replace(/帮我|请|麻烦|一下|查找|寻找|找找|找|搜索|搜|看看|看|获取|抓取/g, '')
    .replace(/相关的?|有关的?|匹配的?|合适的?/g, '')
    .replace(/岗位|职位|工作|专业|方向/g, '')
    .replace(/[，。！？,.!?；;：:\s]/g, '')
    .trim()
    .slice(0, 40);
}

function parseImplicitCrawlPayload(finalText: string, lastUserMessage: string) {
  const hasCrawlIntent = /抓取任务|执行抓取|创建.*抓取|确认.*抓取|请确认/.test(finalText)
    && /抓取|平台|关键词|页数/.test(finalText);
  if (!hasCrawlIntent) return null;

  const platform = normalizePlatformName(lineValue(finalText, ['平台']));
  const query = (lineValue(finalText, ['关键词', '搜索词', '职位'])
    || inferQueryFromUserMessage(lastUserMessage))
    .replace(/[，。；;].*$/, '')
    .trim()
    .slice(0, 80);
  const city = (lineValue(finalText, ['城市', '地点']) || '全国')
    .replace(/[，。；;].*$/, '')
    .trim()
    .slice(0, 20) || '全国';
  const pagesText = lineValue(finalText, ['页数', '页']);
  const pages = Math.min(3, Math.max(1, Number.parseInt(pagesText, 10) || 1));

  if (!query || !isSupportedPlatform(platform)) return null;
  return { platform, query, city, pages };
}

function appendImplicitCrawlConfirmationIfNeeded(
  conversationId: string,
  userId: string,
  finalText: string,
  lastUserMessage: string,
  artifacts: AgentArtifact[],
  seenArtifacts: Set<string>,
  callbacks: AgentStreamCallbacks,
) {
  if (hasConfirmationArtifact(artifacts)) return;

  const payload = parseImplicitCrawlPayload(finalText, lastUserMessage);
  if (!payload) return;

  const pending = createPendingAction(conversationId, 'crawl_jobs', payload, userId);
  const artifact = pendingActionToArtifact(pending);
  if (!artifact) return;

  const key = artifactKey(artifact);
  if (seenArtifacts.has(key)) return;
  seenArtifacts.add(key);
  artifacts.push(artifact);
  callbacks.onArtifact?.(artifact);
}

export async function runAgentConversation(
  conversationId: string,
  userId: string,
  callbacks: AgentStreamCallbacks = {},
  signal?: AbortSignal,
) {
  const tools = createAgentTools({ conversationId, userId });
  const agent = createAgent({
    name: 'job_search_agent',
    model: getModel(),
    tools,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    checkpointer,
  });

  const storedMessages = listMessages(conversationId, 30);
  if (storedMessages.length === 0) throw new Error('当前会话没有用户消息');

  const messages = activeThreads.has(conversationId)
    ? [databaseMessageToLangChain(storedMessages[storedMessages.length - 1])]
    : storedMessages.map(databaseMessageToLangChain);

  let streamedText = '';
  let finalOutput: any = null;
  const artifacts: AgentArtifact[] = [];
  const seenArtifacts = new Set<string>();
  const persistenceReceipts: any[] = [];
  const knownToolNames = new Set<string>(tools.map((item) => item.name));

  const eventStream = agent.streamEvents(
    { messages },
    {
      version: 'v2',
      configurable: { thread_id: conversationId },
      recursionLimit: 12,
      signal,
    },
  );

  for await (const event of eventStream) {
    if (event.event === 'on_chat_model_stream') {
      const token = contentToText((event.data as any)?.chunk?.content);
      if (token) {
        streamedText += token;
        callbacks.onToken?.(token);
      }
      continue;
    }

    if (event.event === 'on_tool_start' && knownToolNames.has(event.name)) {
      callbacks.onToolStart?.(event.name, (event.data as any)?.input);
      continue;
    }

    if (event.event === 'on_tool_end' && knownToolNames.has(event.name)) {
      const parsed = parseToolOutput((event.data as any)?.output);
      const persistence = parsed?.artifact?.persistence;
      if (persistence?.operation === 'save_campus_site' || persistence?.operation === 'save_user_confirmed_campus_sites') {
        persistenceReceipts.push(persistence);
      }
      callbacks.onToolEnd?.(event.name, parsed);
      const artifact = parsed?.artifact;
      if (artifact && typeof artifact === 'object') {
        const key = artifactKey(artifact);
        if (!seenArtifacts.has(key)) {
          seenArtifacts.add(key);
          artifacts.push(artifact);
          callbacks.onArtifact?.(artifact);
        }
      }
      continue;
    }

    if (event.event === 'on_chain_end' && event.name === 'LangGraph') {
      finalOutput = (event.data as any)?.output;
    }
  }

  const lastUserMessage = storedMessages[storedMessages.length - 1]?.content || '';
  let finalText = extractFinalText(finalOutput) || streamedText.trim() || '任务已经处理完成。';
  appendMissingPendingActionArtifacts(conversationId, userId, artifacts, seenArtifacts);
  appendImplicitCrawlConfirmationIfNeeded(
    conversationId,
    userId,
    finalText,
    lastUserMessage,
    artifacts,
    seenArtifacts,
    callbacks,
  );
  const persistenceReceipt = campusPersistenceReceipt(persistenceReceipts);
  if (persistenceReceipt) {
    finalText = `${finalText}\n\n${persistenceReceipt}`;
  } else if (hasCampusSaveIntent(lastUserMessage)) {
    finalText = `${finalText}\n\n数据库入库回执：本轮没有检测到成功的校招官网入库操作，请不要把上面的描述当作已入库结果。`;
  }
  activeThreads.add(conversationId);
  const mergedArtifacts = coalesceCampusSiteArtifacts(artifacts);
  const message = appendMessage(conversationId, 'assistant', finalText, { artifacts: mergedArtifacts });
  return { message, artifacts: mergedArtifacts };
}

export async function clearAgentThread(conversationId: string) {
  activeThreads.delete(conversationId);
  await checkpointer.deleteThread(conversationId);
}
