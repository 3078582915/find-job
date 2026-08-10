import fs from 'fs';
import path from 'path';

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(SERVER_ROOT, 'data', 'agent-model.json');
const CURRENT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

interface StoredAgentConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  updatedAt?: string;
}

export interface AgentRuntimeConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  provider: 'deepseek' | 'openai' | 'custom';
  keySource: 'ui' | 'environment' | 'none';
}

export interface SafeAgentConfig {
  configured: boolean;
  apiKeyConfigured: boolean;
  keyHint: string | null;
  keySource: AgentRuntimeConfig['keySource'];
  model: string;
  baseUrl: string | null;
  provider: AgentRuntimeConfig['provider'];
}

function readStoredConfig(): StoredAgentConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as StoredAgentConfig;
  } catch (error) {
    console.warn('无法读取 Agent 模型配置，将使用环境变量：', error);
    return {};
  }
}

function providerOf(baseUrl: string): AgentRuntimeConfig['provider'] {
  if (!baseUrl) return 'openai';
  return baseUrl.toLowerCase().includes('deepseek.com') ? 'deepseek' : 'custom';
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('模型服务地址不是有效 URL');
  }
  const isLocalHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('模型服务地址必须使用 HTTPS；本机 localhost 可使用 HTTP');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('模型服务地址不能包含账号、密码、查询参数或锚点');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeModel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('模型名称不能为空');
  const model = value.trim();
  if (model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    throw new Error('模型名称格式不正确');
  }
  return model;
}

function writeStoredConfig(config: StoredAgentConfig) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const temporaryPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  fs.renameSync(temporaryPath, CONFIG_PATH);
}

export function getAgentRuntimeConfig(): AgentRuntimeConfig {
  const stored = readStoredConfig();
  const storedKey = stored.apiKey?.trim() || '';
  const environmentKey = (process.env.AGENT_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const apiKey = storedKey || environmentKey;
  const baseUrl = (stored.baseUrl ?? process.env.AGENT_BASE_URL ?? '').trim().replace(/\/$/, '');
  const configuredModel = (stored.model || process.env.AGENT_MODEL || CURRENT_DEEPSEEK_MODEL).trim();
  const model = providerOf(baseUrl) === 'deepseek' && configuredModel === 'deepseek-chat'
    ? CURRENT_DEEPSEEK_MODEL
    : configuredModel;
  return {
    apiKey,
    model,
    baseUrl,
    provider: providerOf(baseUrl),
    keySource: storedKey ? 'ui' : environmentKey ? 'environment' : 'none',
  };
}

export function getSafeAgentConfig(): SafeAgentConfig {
  const config = getAgentRuntimeConfig();
  return {
    configured: Boolean(config.apiKey),
    apiKeyConfigured: Boolean(config.apiKey),
    keyHint: config.apiKey ? `••••${config.apiKey.slice(-4)}` : null,
    keySource: config.keySource,
    model: config.model,
    baseUrl: config.baseUrl || null,
    provider: config.provider,
  };
}

export function saveAgentModelConfig(input: { apiKey?: unknown; model?: unknown; baseUrl?: unknown }) {
  const existing = readStoredConfig();
  const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim()
    ? input.apiKey.trim()
    : existing.apiKey || '';
  if (apiKey.length > 500) throw new Error('API Key 长度不正确');

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const requestedModel = normalizeModel(input.model);
  const model = providerOf(baseUrl) === 'deepseek' && requestedModel === 'deepseek-chat'
    ? CURRENT_DEEPSEEK_MODEL
    : requestedModel;
  writeStoredConfig({
    apiKey,
    model,
    baseUrl,
    updatedAt: new Date().toISOString(),
  });
  return getSafeAgentConfig();
}

export function clearStoredAgentApiKey() {
  const existing = readStoredConfig();
  writeStoredConfig({ ...existing, apiKey: '', updatedAt: new Date().toISOString() });
  return getSafeAgentConfig();
}
