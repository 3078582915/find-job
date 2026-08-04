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
      '职位自然语言筛选',
      '职位库统计',
      '平台状态检查',
      '求职偏好记忆',
      '人工确认后抓取',
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
    return new AgentConfigurationError(`模型名称不可用：${config.model}。请在模型设置里改成服务商支持的模型名称，例如 DeepSeek 可先尝试 deepseek-chat。`);
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
  return JSON.stringify(artifact);
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

  const finalText = extractFinalText(finalOutput) || streamedText.trim() || '任务已经处理完成。';
  const lastUserMessage = storedMessages[storedMessages.length - 1]?.content || '';
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
  activeThreads.add(conversationId);
  const message = appendMessage(conversationId, 'assistant', finalText, { artifacts });
  return { message, artifacts };
}

export async function clearAgentThread(conversationId: string) {
  activeThreads.delete(conversationId);
  await checkpointer.deleteThread(conversationId);
}
