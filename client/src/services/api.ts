import axios from 'axios';
import type {
  Statistics, Resume, DeliverySetting, DeliveryRecordsResponse, Platform,
  JobsResponse, CrawlResult,
  CampusSite, CampusSitesResponse,
  AgentStatus, AgentConversation, AgentMessage, AgentArtifact,
  AgentModelConfig, AgentConnectionTest,
} from '../types';

const http = axios.create({ baseURL: '/api' });

// ========== 统计 ==========
export const fetchStatistics = () =>
  http.get<Statistics>('/statistics').then(r => r.data);

// ========== 简历 ==========
export const fetchResumes = () =>
  http.get<Resume[]>('/resumes').then(r => r.data);

export const createResume = (data: { name: string; content?: object; isDefault?: boolean }) =>
  http.post<Resume>('/resumes', data).then(r => r.data);

export const updateResume = (id: string, data: { name?: string; content?: object; isDefault?: boolean }) =>
  http.put<Resume>(`/resumes/${id}`, data).then(r => r.data);

export const deleteResume = (id: string) =>
  http.delete(`/resumes/${id}`).then(r => r.data);

// ========== 平台 ==========
export const fetchPlatforms = (params?: { verify?: boolean }) =>
  http.get<Platform[]>('/platforms', {
    params: params?.verify ? { verify: '1' } : undefined,
  }).then(r => r.data);

export const bindPlatform = (name: string, data: { account: string; password: string }) =>
  http.post(`/platforms/${name}/bind`, data).then(r => r.data);

export const logoutPlatform = (name: string) =>
  http.delete(`/platforms/${name}/logout`).then(r => r.data);

export const loginPlatform = (name: string) =>
  http.post(`/platforms/${name}/login`, {}, { timeout: 180000 }).then(r => r.data);

// ========== 投递设置 ==========
export const fetchDeliverySettings = () =>
  http.get<DeliverySetting>('/delivery/settings').then(r => r.data);

export const updateDeliverySettings = (data: Partial<DeliverySetting>) =>
  http.put('/delivery/settings', data).then(r => r.data);

// ========== 投递记录 ==========
export const fetchDeliveryRecords = (params: { page?: number; size?: number; platform?: string; clickedDate?: string }) =>
  http.get<DeliveryRecordsResponse>('/delivery/records', { params }).then(r => r.data);

// ========== 职位 ==========
export const crawlJobs = (data: { platform: string; query: string; city?: string; pages?: number }) =>
  http.post<CrawlResult>('/jobs/crawl', data, { timeout: 180000 }).then(r => r.data);

export const fetchJobs = (params: {
  page?: number;
  size?: number;
  platform?: string;
  keyword?: string;
  city?: string;
  salaryStatus?: string;
  companyStatus?: string;
  clickStatus?: string;
  unclicked?: string;
  crawledDate?: string;
  semantic?: string;
}) =>
  http.get<JobsResponse>('/jobs', { params }).then(r => r.data);

export const clickJob = (id: string) =>
  http.post<{ success: boolean; url: string; alreadyClicked: boolean }>(`/jobs/${id}/click`).then(r => r.data);

export const deleteJob = (id: string) =>
  http.delete<{ success: boolean; deleted: number }>(`/jobs/${id}`).then(r => r.data);

export const deleteJobs = (ids: string[]) =>
  http.post<{ success: boolean; deleted: number }>('/jobs/bulk-delete', { ids }).then(r => r.data);

// ========== 校招官网 ==========
export const fetchCampusSites = (params?: {
  page?: number;
  size?: number;
  keyword?: string;
  sourceType?: string;
  verificationStatus?: string;
  status?: string;
}) => http.get<CampusSitesResponse>('/campus-sites', { params }).then(r => r.data);

export const createCampusSite = (data: {
  companyName: string;
  siteName?: string;
  officialUrl: string;
  sourceType?: 'manual' | 'agent';
  sourceQuery?: string;
  confidence?: number;
  verificationStatus?: 'verified' | 'user_confirmed';
  verificationMethod?: 'official_domain' | 'official_referral' | 'manual';
  verificationEvidence?: string[];
  siteKind?: 'official_site' | 'referral_link' | 'aggregated_reference';
  tags?: string[];
  notes?: string;
}) => http.post<CampusSite>('/campus-sites', data).then(r => r.data);

export const updateCampusSite = (id: string, data: {
  companyName: string;
  siteName?: string;
  officialUrl: string;
  siteKind?: 'official_site' | 'referral_link' | 'aggregated_reference';
  tags?: string[];
  notes?: string;
  status?: 'active' | 'inactive';
}) => http.put<CampusSite>(`/campus-sites/${id}`, data).then(r => r.data);

export const deleteCampusSite = (id: string) =>
  http.delete<{ success: boolean; deleted: number }>(`/campus-sites/${id}`).then(r => r.data);

export const discoverCampusSites = (companyName: string) =>
  http.post('/campus-sites/discover', { companyName }).then(r => r.data);

export const fetchRagStatus = () =>
  http.get('/jobs/rag/status').then(r => r.data);

export const reindexRagJobs = () =>
  http.post('/jobs/rag/reindex').then(r => r.data);

// ========== Agent ==========
export const fetchAgentStatus = () =>
  http.get<AgentStatus>('/agent/status').then(r => r.data);

export const fetchAgentConfig = () =>
  http.get<AgentModelConfig>('/agent/config').then(r => r.data);

export const updateAgentConfig = (data: { apiKey?: string; model: string; baseUrl?: string }) =>
  http.put<AgentModelConfig>('/agent/config', data).then(r => r.data);

export const clearAgentApiKey = () =>
  http.delete<AgentModelConfig>('/agent/config/key').then(r => r.data);

export const testAgentConfig = () =>
  http.post<AgentConnectionTest>('/agent/config/test', {}, { timeout: 70000 }).then(r => r.data);

export const fetchAgentConversations = () =>
  http.get<AgentConversation[]>('/agent/conversations').then(r => r.data);

export const createAgentConversation = (title?: string) =>
  http.post<AgentConversation>('/agent/conversations', { title }).then(r => r.data);

export const deleteAgentConversation = (id: string) =>
  http.delete(`/agent/conversations/${id}`).then(r => r.data);

export const fetchAgentMessages = (conversationId: string) =>
  http.get<AgentMessage[]>(`/agent/conversations/${conversationId}/messages`).then(r => r.data);

export const confirmAgentAction = (id: string) =>
  http.post<{ success: boolean; action: { status: string }; message: AgentMessage }>(`/agent/actions/${id}/confirm`, {}, { timeout: 180000 }).then(r => r.data);

export const cancelAgentAction = (id: string) =>
  http.post<{ success: boolean; action: { status: string } }>(`/agent/actions/${id}/cancel`).then(r => r.data);

export interface AgentStreamHandlers {
  onConversation?: (conversation: AgentConversation) => void;
  onToken?: (token: string) => void;
  onStatus?: (status: { phase: string; label: string }) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string) => void;
  onArtifact?: (artifact: AgentArtifact) => void;
  onDone?: (message: AgentMessage) => void;
}

export async function streamAgentChat(
  data: { conversationId?: string; message: string },
  handlers: AgentStreamHandlers,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string) => {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const dataText = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!dataText) return;
    const payload = JSON.parse(dataText);
    if (event === 'conversation') handlers.onConversation?.(payload.conversation);
    else if (event === 'token') handlers.onToken?.(payload.token);
    else if (event === 'status') handlers.onStatus?.(payload);
    else if (event === 'tool_start') handlers.onToolStart?.(payload.toolName);
    else if (event === 'tool_end') handlers.onToolEnd?.(payload.toolName);
    else if (event === 'artifact') handlers.onArtifact?.(payload);
    else if (event === 'done') handlers.onDone?.(payload.message);
    else if (event === 'error') throw new Error(payload.message || 'Agent 运行失败');
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) dispatch(block);
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
}
