import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Send,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react';
import AgentArtifacts, { type ActionState } from '../components/agent/AgentArtifacts';
import ModelSettingsModal from '../components/agent/ModelSettingsModal';
import * as api from '../services/api';
import type {
  AgentArtifact,
  AgentConversation,
  AgentJobCard,
  AgentMessage,
  AgentStatus,
} from '../types';

const STARTERS = [
  '帮我找北京 15K 以上的 Agent 开发岗位',
  '统计职位库并检查数据质量',
  '找出薪资缺失的职位',
  '检查所有平台的登录状态',
];

const TOOL_LABELS: Record<string, string> = {
  search_jobs: '正在筛选职位库',
  get_job_detail: '正在读取职位详情',
  get_job_statistics: '正在统计职位库',
  get_platform_status: '正在检查平台状态',
  get_job_preferences: '正在读取求职偏好',
  save_job_preferences: '正在保存求职偏好',
  prepare_job_crawl: '正在准备抓取任务',
  find_data_issues: '正在检查数据质量',
};

function nowString() {
  return new Date().toISOString();
}

function artifactsOf(message: AgentMessage) {
  return message.metadata?.artifacts || [];
}

function artifactKey(artifact: AgentArtifact) {
  if (artifact.kind === 'confirmation' && artifact.action?.id) return `confirmation:${artifact.action.id}`;
  if (artifact.kind === 'crawl_result' && artifact.actionId) return `crawl_result:${artifact.actionId}`;
  if (artifact.kind === 'job_list' && artifact.jobs?.length) return `job_list:${artifact.jobs.map((job) => job.id).join(',')}`;
  return JSON.stringify(artifact);
}

function mergeArtifacts(left: AgentArtifact[], right: AgentArtifact[]) {
  const merged: AgentArtifact[] = [];
  const seen = new Set<string>();
  for (const artifact of [...left, ...right]) {
    const key = artifactKey(artifact);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(artifact);
  }
  return merged;
}

export default function AgentWorkspace() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeTool, setActiveTool] = useState('');
  const [error, setError] = useState('');
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [showConversationDrawer, setShowConversationDrawer] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = async () => {
    const data = await api.fetchAgentConversations();
    setConversations(data);
    return data;
  };

  const refreshAgentStatus = async () => {
    const next = await api.fetchAgentStatus();
    setStatus(next);
    return next;
  };

  const loadMessages = async (id: string) => {
    setConversationId(id);
    setShowConversationDrawer(false);
    setError('');
    const data = await api.fetchAgentMessages(id);
    setMessages(data);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.fetchAgentStatus(), api.fetchAgentConversations()])
      .then(([agentStatus, items]) => {
        if (cancelled) return;
        setStatus(agentStatus);
        setConversations(items);
        if (items[0]) {
          setConversationId(items[0].id);
          return api.fetchAgentMessages(items[0].id).then((data) => {
            if (!cancelled) setMessages(data);
          });
        }
      })
      .catch((reason) => setError(reason.message || 'Agent 初始化失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: sending ? 'smooth' : 'auto' });
  }, [messages, sending, activeTool]);

  const candidateJobs = useMemo(() => {
    const seen = new Set<string>();
    const jobs: AgentJobCard[] = [];
    for (const message of [...messages].reverse()) {
      for (const artifact of [...artifactsOf(message)].reverse()) {
        for (const job of artifact.jobs || []) {
          if (!seen.has(job.id)) {
            seen.add(job.id);
            jobs.push(job);
          }
        }
      }
    }
    return jobs.slice(0, 8);
  }, [messages]);

  const pendingConfirmation = useMemo(() => {
    for (const message of [...messages].reverse()) {
      for (const artifact of [...artifactsOf(message)].reverse()) {
        if (artifact.kind !== 'confirmation' || !artifact.action) continue;
        const state = actionStates[artifact.action.id] || artifact.action.status || 'pending';
        if (state === 'pending' || state === 'processing') return artifact;
      }
    }
    return null;
  }, [messages, actionStates]);

  const createNewConversation = async () => {
    if (sending) return;
    const conversation = await api.createAgentConversation();
    setConversations((current) => [conversation, ...current]);
    setConversationId(conversation.id);
    setMessages([]);
    setInput('');
    setError('');
    setShowConversationDrawer(false);
  };

  const removeConversation = async (id: string) => {
    if (sending) return;
    await api.deleteAgentConversation(id);
    const next = conversations.filter((item) => item.id !== id);
    setConversations(next);
    if (conversationId === id) {
      if (next[0]) await loadMessages(next[0].id);
      else {
        setConversationId(null);
        setMessages([]);
      }
    }
  };

  const sendMessage = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || sending || !status?.configured) return;

    setInput('');
    setError('');
    setSending(true);
    setActiveTool('');
    const temporaryUserId = `user-${Date.now()}`;
    const temporaryAssistantId = `assistant-${Date.now()}`;
    const userMessage: AgentMessage = {
      id: temporaryUserId,
      conversation_id: conversationId || '',
      role: 'user',
      content: text,
      metadata: {},
      created_at: nowString(),
    };
    const assistantMessage: AgentMessage = {
      id: temporaryAssistantId,
      conversation_id: conversationId || '',
      role: 'assistant',
      content: '',
      metadata: { artifacts: [] },
      created_at: nowString(),
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;
    let resolvedConversationId = conversationId;

    try {
      await api.streamAgentChat(
        { conversationId: conversationId || undefined, message: text },
        {
          onConversation: (conversation) => {
            resolvedConversationId = conversation.id;
            setConversationId(conversation.id);
          },
          onStatus: (value) => setActiveTool(value.label),
          onToolStart: (toolName) => setActiveTool(TOOL_LABELS[toolName] || `正在调用 ${toolName}`),
          onToolEnd: () => setActiveTool('正在整理结果'),
          onToken: (token) => setMessages((current) => current.map((message) =>
            message.id === temporaryAssistantId
              ? { ...message, content: message.content + token }
              : message
          )),
          onArtifact: (artifact: AgentArtifact) => {
            if (artifact.kind === 'confirmation' && artifact.action?.id) {
              setActionStates((current) => ({ ...current, [artifact.action!.id]: artifact.action!.status || 'pending' }));
            }
            setMessages((current) => current.map((message) =>
              message.id === temporaryAssistantId
                ? {
                    ...message,
                    metadata: {
                      artifacts: mergeArtifacts(message.metadata.artifacts || [], [artifact]),
                    },
                  }
                : message
            ));
          },
          onDone: (message) => setMessages((current) => current.map((item) =>
            item.id === temporaryAssistantId
              ? {
                  ...message,
                  metadata: {
                    ...message.metadata,
                    artifacts: mergeArtifacts(
                      item.metadata.artifacts || [],
                      message.metadata?.artifacts || [],
                    ),
                  },
                }
              : item
          )),
        },
        controller.signal,
      );
      await refreshConversations();
      if (resolvedConversationId) setConversationId(resolvedConversationId);
    } catch (reason: any) {
      if (reason.name !== 'AbortError') {
        const message = reason.message || 'Agent 运行失败';
        setError(message);
        setMessages((current) => current.map((item) =>
          item.id === temporaryAssistantId
            ? { ...item, content: item.content || `运行失败：${message}` }
            : item
        ));
      }
    } finally {
      setSending(false);
      setActiveTool('');
      abortRef.current = null;
    }
  };

  const stopGeneration = () => abortRef.current?.abort();

  const confirmAction = async (id: string) => {
    setActionStates((current) => ({ ...current, [id]: 'processing' }));
    try {
      const result = await api.confirmAgentAction(id);
      setActionStates((current) => ({ ...current, [id]: 'completed' }));
      setMessages((current) => current.some((message) => message.id === result.message.id)
        ? current
        : [...current, result.message]);
      await refreshConversations();
    } catch (reason: any) {
      setActionStates((current) => ({ ...current, [id]: 'failed' }));
      setError(reason?.response?.data?.error || reason.message || '动作执行失败');
    }
  };

  const cancelAction = async (id: string) => {
    try {
      await api.cancelAgentAction(id);
      setActionStates((current) => ({ ...current, [id]: 'cancelled' }));
    } catch (reason: any) {
      setError(reason?.response?.data?.error || reason.message || '取消失败');
    }
  };

  const recordOpenJob = (job: AgentJobCard) => {
    void api.clickJob(job.id).catch(() => undefined);
  };

  if (loading) {
    return <div className="flex h-[70vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] min-h-[640px] max-w-[1580px] overflow-hidden rounded-md border border-[#DDE4EA] bg-white shadow-sm">
      <aside className={`${showConversationDrawer ? 'fixed inset-y-0 left-0 z-[160] w-[280px]' : 'hidden'} border-r border-[#E3E8EC] bg-[#F7F9FA] md:relative md:flex md:w-[238px] md:flex-col`}>
        <div className="flex h-16 items-center justify-between border-b border-[#E3E8EC] px-4">
          <span className="text-sm font-semibold text-[#29445C]">对话</span>
          <button
            type="button"
            onClick={createNewConversation}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#D6DEE5] bg-white text-[#39536A] hover:border-accent hover:text-accent"
            title="新建对话"
          >
            <MessageSquarePlus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`group mb-1 grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-md ${
                conversation.id === conversationId ? 'bg-[#E8EEF3]' : 'hover:bg-[#EEF2F5]'
              }`}
            >
              <button
                type="button"
                onClick={() => loadMessages(conversation.id)}
                className="min-w-0 px-3 py-2.5 text-left"
              >
                <div className="truncate text-sm font-medium text-[#29445C]">{conversation.title}</div>
                <div className="mt-1 truncate text-xs text-[#82909B]">{conversation.last_message || '暂无消息'}</div>
              </button>
              <button
                type="button"
                onClick={() => removeConversation(conversation.id)}
                className="flex h-7 w-7 items-center justify-center rounded text-[#9AA6AF] opacity-0 hover:bg-white hover:text-[#C24436] group-hover:opacity-100"
                title="删除对话"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {showConversationDrawer && (
        <button type="button" aria-label="关闭对话列表" className="fixed inset-0 z-[150] bg-black/30 md:hidden" onClick={() => setShowConversationDrawer(false)} />
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#E3E8EC] px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setShowConversationDrawer(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[#D6DEE5] text-[#39536A] md:hidden"
              title="打开对话列表"
            >
              <PanelLeft size={18} />
            </button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#E8F8F3] text-[#087F67]"><Bot size={19} /></div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#17324D]">职位库 Agent</div>
              <div className="truncate text-xs text-[#82909B]">{status?.model} · {status?.framework}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden items-center gap-1.5 text-xs font-medium sm:inline-flex ${status?.configured ? 'text-[#17865D]' : 'text-[#B05237]'}`}>
              <span className={`h-2 w-2 rounded-full ${status?.configured ? 'bg-[#26A872]' : 'bg-[#D87857]'}`} />
              {status?.configured ? '模型已配置' : '等待配置'}
            </span>
            <button
              type="button"
              onClick={() => setShowModelSettings(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[#D6DEE5] text-[#39536A] hover:border-[#9DB0BF] hover:bg-[#F7F9FA]"
              title="模型设置"
            >
              <Settings2 size={17} />
            </button>
          </div>
        </header>

        {!status?.configured && (
          <div className="flex items-center gap-3 border-b border-[#F1C7B5] bg-[#FFF8F4] px-5 py-3 text-sm text-[#7B4938]">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <span className="flex-1">模型尚未配置，完成设置后即可开始对话。</span>
            <button type="button" onClick={() => setShowModelSettings(true)} className="shrink-0 rounded-md border border-[#D9A993] bg-white px-3 py-1.5 text-xs font-medium text-[#87432F] hover:bg-[#FFF2EB]">
              配置模型
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto max-w-[820px]">
            {messages.length === 0 ? (
              <div className="pt-[10vh]">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#193653] text-white"><Bot size={22} /></div>
                  <div>
                    <h1 className="text-xl font-semibold text-[#17324D]">从职位库开始</h1>
                    <p className="mt-1 text-sm text-[#71818E]">选择一条任务或直接输入条件</p>
                  </div>
                </div>
                <div className="mt-7 grid gap-2 sm:grid-cols-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={!status?.configured}
                      onClick={() => sendMessage(starter)}
                      className="flex min-h-[58px] items-center justify-between gap-3 rounded-md border border-[#DDE4EA] bg-white px-4 py-3 text-left text-sm text-[#39536A] transition-colors hover:border-[#9DB0BF] hover:bg-[#FAFBFC] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{starter}</span><ChevronRight size={16} className="shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {messages.map((message) => (
                  <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex items-start gap-3'}>
                    {message.role === 'assistant' && (
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#E8F8F3] text-[#087F67]"><Bot size={17} /></div>
                    )}
                    <div className={message.role === 'user' ? 'max-w-[78%] rounded-md bg-[#193653] px-4 py-3 text-sm leading-6 text-white' : 'min-w-0 max-w-[calc(100%-44px)] flex-1'}>
                      <div className={`whitespace-pre-wrap break-words text-sm leading-6 ${message.role === 'assistant' ? 'text-[#29445C]' : ''}`}>
                        {message.content || (sending && message.id.startsWith('assistant-') ? '' : '任务已经处理完成。')}
                      </div>
                      {message.role === 'assistant' && (
                        <AgentArtifacts
                          artifacts={artifactsOf(message)}
                          actionStates={actionStates}
                          onConfirm={confirmAction}
                          onCancel={cancelAction}
                          onOpenJob={recordOpenJob}
                        />
                      )}
                    </div>
                  </div>
                ))}
                {sending && activeTool && (
                  <div className="flex items-center gap-2 pl-11 text-xs text-[#71818E]"><Loader2 size={14} className="animate-spin" />{activeTool}</div>
                )}
              </div>
            )}
            {error && <div className="mt-5 rounded-md border border-[#F1C7B5] bg-[#FFF8F4] px-4 py-3 text-sm text-[#9A412B]">{error}</div>}
            <div ref={bottomRef} />
          </div>
        </div>

        {pendingConfirmation && (
          <div className="shrink-0 border-t border-[#E8C9BA] bg-[#FFFCFA] px-4 py-3 sm:px-8">
            <div className="mx-auto max-w-[820px]">
              <div className="text-xs font-semibold text-[#8C3D22]">待确认任务</div>
              <AgentArtifacts
                artifacts={[pendingConfirmation]}
                actionStates={actionStates}
                onConfirm={confirmAction}
                onCancel={cancelAction}
                onOpenJob={recordOpenJob}
              />
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-[#E3E8EC] bg-white px-4 py-4 sm:px-8">
          <div className="mx-auto flex max-w-[820px] items-end gap-2 rounded-md border border-[#C9D4DC] bg-white p-2 focus-within:border-[#6C879A]">
            <textarea
              value={input}
              disabled={!status?.configured || sending}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              rows={1}
              placeholder={status?.configured ? '输入职位条件、统计问题或抓取任务' : '请先配置模型'}
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[#17324D] outline-none placeholder:text-[#98A5AE] disabled:cursor-not-allowed"
            />
            {sending ? (
              <button type="button" onClick={stopGeneration} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#E9EEF2] text-[#39536A]" title="停止生成"><Square size={15} fill="currentColor" /></button>
            ) : (
              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={!input.trim() || !status?.configured}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-[#EB5C2A] disabled:cursor-not-allowed disabled:opacity-40"
                title="发送"
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className="hidden w-[270px] shrink-0 border-l border-[#E3E8EC] bg-[#FAFBFC] xl:flex xl:flex-col">
        <div className="flex h-16 items-center justify-between border-b border-[#E3E8EC] px-4">
          <span className="text-sm font-semibold text-[#29445C]">本轮候选</span>
          <span className="text-xs text-[#82909B]">{candidateJobs.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {candidateJobs.length ? candidateJobs.map((job) => (
            <a
              key={job.id}
              href={job.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => recordOpenJob(job)}
              className="mb-2 block rounded-md border border-[#E0E6EB] bg-white p-3 transition-colors hover:border-[#AEBEC9]"
            >
              <div className="line-clamp-2 text-sm font-medium text-[#29445C]">{job.title}</div>
              <div className="mt-1 truncate text-xs text-[#71818E]">{job.company}</div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-[#E95632]">{job.salary}</span><span className="truncate text-[#8A98A3]">{job.location}</span></div>
            </a>
          )) : (
            <div className="pt-8 text-center text-sm text-[#98A5AE]">暂无候选职位</div>
          )}
        </div>
        <div className="border-t border-[#E3E8EC] p-4 text-xs leading-5 text-[#71818E]">
          <div className="flex items-center gap-1.5 font-medium text-[#39536A]"><Check size={13} />人工确认模式</div>
          <div className="mt-1">抓取和投递不会自动执行。</div>
        </div>
      </aside>

      <ModelSettingsModal
        open={showModelSettings}
        onClose={() => setShowModelSettings(false)}
        onConfigured={() => { void refreshAgentStatus(); }}
      />
    </div>
  );
}
