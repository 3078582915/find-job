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
  listMessages,
  type AgentMessageRecord,
} from './repository';

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

export async function testAgentModelConnection() {
  const startedAt = Date.now();
  const response = await getModel().invoke([
    new HumanMessage('Reply with exactly OK.'),
  ]);
  return {
    success: true,
    latencyMs: Date.now() - startedAt,
    response: contentToText(response.content).trim().slice(0, 100),
  };
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
  activeThreads.add(conversationId);
  const message = appendMessage(conversationId, 'assistant', finalText, { artifacts });
  return { message, artifacts };
}

export async function clearAgentThread(conversationId: string) {
  activeThreads.delete(conversationId);
  await checkpointer.deleteThread(conversationId);
}
