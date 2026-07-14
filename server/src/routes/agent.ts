import { Router, type Response } from 'express';
import {
  AgentConfigurationError,
  clearAgentThread,
  getAgentStatus,
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
  deleteConversation,
  finishPendingAction,
  getConversation,
  getPendingAction,
  listConversations,
  listMessages,
  logAgentAction,
  updateConversationTitleFromMessage,
} from '../agent/repository';
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
    const message = error instanceof Error ? error.message : String(error);
    res.status(error instanceof AgentConfigurationError ? 503 : 502).json({ error: message });
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
  res.json(listMessages(conversation.id).map(hydrateActionStates));
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
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentConfigurationError ? 503 : 500;
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
