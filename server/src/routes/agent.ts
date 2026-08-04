import { Router, type Response } from 'express';
import {
  AgentConfigurationError,
  AgentModelConnectionError,
  clearAgentThread,
  getAgentStatus,
  normalizeAgentError,
  resetAgentModel,
  runAgentConversation,
  testAgentModelConnection,
} from '../agent/agentService';
import {
  clearStoredAgentApiKey,
  getSafeAgentConfig,
  saveAgentModelConfig,
} from '../agent/config';
import {
  DEMO_USER_ID,
  appendMessage,
  claimPendingAction,
  createConversation,
  createPendingAction,
  deleteConversation,
  finishPendingAction,
  getConversation,
  getPendingAction,
  listPendingActions,
  listConversations,
  listMessages,
  logAgentAction,
  updateConversationTitleFromMessage,
} from '../agent/repository';
import { PLATFORM_CONFIG, isSupportedPlatform } from '../platformRegistry';
import {
  crawlAndStoreJobs,
  getJobsByPlatformJobIds,
  toAgentJobCard,
} from '../services/jobService';

const router = Router();

function sendEvent(res: Response, event: string, data: unknown) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function cleanMessage(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 4000) : '';
}

function hydrateActionStates(message: any) {
  const artifacts = Array.isArray(message?.metadata?.artifacts)
    ? message.metadata.artifacts.map((artifact: any) => {
        if (artifact?.kind !== 'confirmation' || !artifact?.action?.id) return artifact;
        const pending = getPendingAction(artifact.action.id, DEMO_USER_ID);
        return pending
          ? { ...artifact, action: { ...artifact.action, status: pending.status } }
          : artifact;
      })
    : [];
  return { ...message, metadata: { ...message.metadata, artifacts } };
}

function confirmationArtifactFromPendingAction(action: any) {
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

function attachMissingPendingConfirmations(messages: any[], conversationId: string) {
  const seenActionIds = new Set<string>();
  for (const message of messages) {
    for (const artifact of message.metadata?.artifacts || []) {
      if (artifact?.kind === 'confirmation' && artifact?.action?.id) {
        seenActionIds.add(artifact.action.id);
      }
    }
  }

  const missing = listPendingActions(conversationId, DEMO_USER_ID, ['pending', 'processing'])
    .filter((action) => !seenActionIds.has(action.id))
    .map(confirmationArtifactFromPendingAction)
    .filter(Boolean);

  const targetIndex = [...messages].reverse().findIndex((message) => message.role === 'assistant');
  if (targetIndex === -1) return messages;
  const realIndex = messages.length - 1 - targetIndex;
  const previousUser = [...messages.slice(0, realIndex)].reverse().find((message) => message.role === 'user');
  const artifactsToAttach = missing.length
    ? missing
    : createImplicitConfirmationFromAssistantText(
        conversationId,
        messages[realIndex].content || '',
        previousUser?.content || '',
        seenActionIds,
      );
  if (!artifactsToAttach.length) return messages;

  return messages.map((message, index) => {
    if (index !== realIndex) return message;
    return {
      ...message,
      metadata: {
        ...message.metadata,
        artifacts: [...(message.metadata?.artifacts || []), ...artifactsToAttach],
      },
    };
  });
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

function createImplicitConfirmationFromAssistantText(
  conversationId: string,
  assistantText: string,
  previousUserText: string,
  seenActionIds: Set<string>,
) {
  const payload = parseImplicitCrawlPayload(assistantText, previousUserText);
  if (!payload) return [];

  const pending = createPendingAction(conversationId, 'crawl_jobs', payload, DEMO_USER_ID);
  if (seenActionIds.has(pending.id)) return [];

  const artifact = confirmationArtifactFromPendingAction(pending);
  return artifact ? [artifact] : [];
}

router.get('/agent/status', (_req, res) => {
  res.json(getAgentStatus());
});

router.get('/agent/config', (_req, res) => {
  res.json(getSafeAgentConfig());
});

router.put('/agent/config', (req, res) => {
  try {
    const config = saveAgentModelConfig(req.body || {});
    resetAgentModel();
    res.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

router.delete('/agent/config/key', (_req, res) => {
  const config = clearStoredAgentApiKey();
  resetAgentModel();
  res.json(config);
});

router.post('/agent/config/test', async (_req, res) => {
  try {
    res.json(await testAgentModelConnection());
  } catch (error) {
    const normalized = normalizeAgentError(error);
    const message = normalized.message;
    res.status(normalized instanceof AgentConfigurationError ? 503 : 502).json({ error: message });
  }
});

router.get('/agent/conversations', (_req, res) => {
  res.json(listConversations(DEMO_USER_ID));
});

router.post('/agent/conversations', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title : '新对话';
  res.status(201).json(createConversation(DEMO_USER_ID, title));
});

router.get('/agent/conversations/:id/messages', (req, res) => {
  const conversation = getConversation(req.params.id, DEMO_USER_ID);
  if (!conversation) return res.status(404).json({ error: '会话不存在' });
  const messages = listMessages(conversation.id).map(hydrateActionStates);
  res.json(attachMissingPendingConfirmations(messages, conversation.id));
});

router.delete('/agent/conversations/:id', async (req, res) => {
  const removed = deleteConversation(req.params.id, DEMO_USER_ID);
  if (!removed) return res.status(404).json({ error: '会话不存在' });
  await clearAgentThread(req.params.id);
  res.json({ success: true });
});

router.post('/agent/chat', async (req, res) => {
  const content = cleanMessage(req.body?.message);
  if (!content) return res.status(400).json({ error: '消息不能为空' });

  let conversation = req.body?.conversationId
    ? getConversation(String(req.body.conversationId), DEMO_USER_ID)
    : undefined;
  if (req.body?.conversationId && !conversation) {
    return res.status(404).json({ error: '会话不存在' });
  }
  if (!conversation) conversation = createConversation(DEMO_USER_ID);

  appendMessage(conversation.id, 'user', content);
  updateConversationTitleFromMessage(conversation.id, content);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  sendEvent(res, 'conversation', { conversation });
  sendEvent(res, 'status', { phase: 'thinking', label: '正在理解你的需求' });

  try {
    const result = await runAgentConversation(
      conversation.id,
      DEMO_USER_ID,
      {
        onToken: (token) => sendEvent(res, 'token', { token }),
        onToolStart: (toolName) => sendEvent(res, 'tool_start', { toolName }),
        onToolEnd: (toolName) => sendEvent(res, 'tool_end', { toolName }),
        onArtifact: (artifact) => sendEvent(res, 'artifact', artifact),
      },
      abortController.signal,
    );
    sendEvent(res, 'done', { message: result.message });
  } catch (error) {
    const normalized = normalizeAgentError(error);
    const message = normalized.message;
    const status = normalized instanceof AgentConfigurationError
      ? 503
      : normalized instanceof AgentModelConnectionError ? 502 : 500;
    sendEvent(res, 'error', { message, status });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

router.post('/agent/actions/:id/confirm', async (req, res) => {
  const action = claimPendingAction(req.params.id, DEMO_USER_ID);
  if (!action) {
    const existing = getPendingAction(req.params.id, DEMO_USER_ID);
    return res.status(409).json({
      error: existing ? `动作当前状态为 ${existing.status}` : '动作不存在或已过期',
    });
  }

  try {
    if (action.action_type !== 'crawl_jobs') throw new Error('不支持的动作类型');
    const result = await crawlAndStoreJobs(action.payload as any);
    const finished = finishPendingAction(action.id, 'completed', { ...result }, DEMO_USER_ID);
    const jobs = result.success
      ? getJobsByPlatformJobIds(result.platform, result.jobIds, DEMO_USER_ID)
          .slice(0, 10)
          .map(toAgentJobCard)
      : [];
    const content = result.needLogin
      ? `抓取未执行：${result.error || '平台需要先登录'}`
      : `抓取完成：共获取 ${result.total} 个职位，新增 ${result.inserted} 个，更新 ${result.duplicated} 个。${jobs.length ? ` 已展示最近 ${jobs.length} 个匹配职位。` : ''}`;
    const artifacts = [
      { kind: 'crawl_result', result, actionId: action.id },
      ...(jobs.length ? [{ kind: 'job_list', jobs, conditions: `${result.query} · ${result.city}` }] : []),
    ];
    const message = appendMessage(action.conversation_id, 'assistant', content, {
      artifacts,
    });
    await clearAgentThread(action.conversation_id);
    logAgentAction(action.conversation_id, 'crawl_jobs', action.payload, result, 'success', DEMO_USER_ID);
    res.json({ success: true, action: finished, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishPendingAction(action.id, 'failed', { error: message }, DEMO_USER_ID);
    logAgentAction(action.conversation_id, 'crawl_jobs', action.payload, { error: message }, 'error', DEMO_USER_ID);
    res.status(500).json({ error: message });
  }
});

router.post('/agent/actions/:id/cancel', (req, res) => {
  const action = getPendingAction(req.params.id, DEMO_USER_ID);
  if (!action || action.status !== 'pending') {
    return res.status(409).json({ error: '动作不存在或不可取消' });
  }
  const cancelled = finishPendingAction(action.id, 'cancelled', {}, DEMO_USER_ID);
  res.json({ success: true, action: cancelled });
});

export default router;
