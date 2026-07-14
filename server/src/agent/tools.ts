import { tool } from 'langchain';
import { z } from 'zod';
import db from '../database';
import { hasLoginState } from '../crawlers/browser';
import { PLATFORM_CONFIG, isSupportedPlatform } from '../platformRegistry';
import {
  getJobById,
  getJobLibraryStatistics,
  searchJobs,
  toAgentJobCard,
} from '../services/jobService';
import {
  createPendingAction,
  getPreferences,
  logAgentAction,
  savePreferences,
} from './repository';

interface ToolContext {
  conversationId: string;
  userId: string;
}

function toolResult(summary: string, artifact?: Record<string, unknown>) {
  return JSON.stringify({ summary, artifact: artifact || null });
}

export function createAgentTools(context: ToolContext) {
  const runLogged = async <T>(name: string, input: unknown, fn: () => T | Promise<T>) => {
    try {
      const output = await fn();
      logAgentAction(context.conversationId, name, input, output, 'success', context.userId);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logAgentAction(context.conversationId, name, input, { error: message }, 'error', context.userId);
      throw error;
    }
  };

  const searchJobsTool = tool(
    async (input) => runLogged('search_jobs', input, () => {
      const jobs = searchJobs(input, context.userId).map(toAgentJobCard);
      const conditions = [
        input.keyword && `关键词“${input.keyword}”`,
        input.city && input.city !== '全国' && `城市“${input.city}”`,
        input.platform && input.platform !== 'all' && `平台“${input.platform}”`,
        input.minSalaryK && `最低月薪 ${input.minSalaryK}K`,
        input.onlyUnclicked && '仅未查看',
      ].filter(Boolean).join('、') || '全部职位';
      return toolResult(
        `按${conditions}找到 ${jobs.length} 个职位。`,
        { kind: 'job_list', jobs, conditions },
      );
    }),
    {
      name: 'search_jobs',
      description: '按关键词、城市、平台、最低月薪和查看状态搜索本地职位库，并返回职位卡片。',
      schema: z.object({
        keyword: z.string().max(80).optional().describe('职位或公司关键词'),
        city: z.string().max(20).optional().describe('城市；全国可省略'),
        platform: z.enum(['all', 'boss', 'zhilian', '51job', 'shixiseng']).optional(),
        minSalaryK: z.number().min(0).max(200).optional().describe('最低月薪，单位 K'),
        onlyUnclicked: z.boolean().optional(),
        salaryStatus: z.enum(['all', 'present', 'missing']).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
  );

  const getJobDetailTool = tool(
    async (input) => runLogged('get_job_detail', input, () => {
      const job = getJobById(input.jobId, context.userId);
      if (!job) return toolResult('没有找到这个职位。');
      return toolResult('已读取职位详情。', {
        kind: 'job_list',
        jobs: [toAgentJobCard(job)],
        conditions: '指定职位',
      });
    }),
    {
      name: 'get_job_detail',
      description: '根据本地职位 ID 读取完整职位信息。',
      schema: z.object({ jobId: z.string().min(1).max(80) }),
    },
  );

  const getStatisticsTool = tool(
    async () => runLogged('get_job_statistics', {}, () => {
      const statistics = getJobLibraryStatistics(context.userId);
      return toolResult('已统计当前职位库。', { kind: 'statistics', statistics });
    }),
    {
      name: 'get_job_statistics',
      description: '统计职位总数、今日新增、已查看、薪资缺失以及平台分布。',
      schema: z.object({}),
    },
  );

  const getPlatformStatusTool = tool(
    async () => runLogged('get_platform_status', {}, () => {
      const platforms = PLATFORM_CONFIG.map((platform) => ({
        name: platform.name,
        label: platform.label,
        loggedIn: hasLoginState(platform.name),
        requiresLoginForCrawl: platform.requiresLoginForCrawl,
      }));
      return toolResult('已检查平台状态。', { kind: 'platform_status', platforms });
    }),
    {
      name: 'get_platform_status',
      description: '查询各招聘平台是否已登录以及抓取是否要求登录。',
      schema: z.object({}),
    },
  );

  const getPreferencesTool = tool(
    async () => runLogged('get_job_preferences', {}, () => {
      const preferences = getPreferences(context.userId);
      return toolResult('已读取求职偏好。', { kind: 'preferences', preferences });
    }),
    {
      name: 'get_job_preferences',
      description: '读取用户已经保存的求职关键词、城市、最低薪资等偏好。',
      schema: z.object({}),
    },
  );

  const savePreferencesTool = tool(
    async (input) => runLogged('save_job_preferences', input, () => {
      const current = getPreferences(context.userId);
      const next = savePreferences({ ...current, ...input }, context.userId);
      return toolResult('求职偏好已保存。', { kind: 'preferences', preferences: next });
    }),
    {
      name: 'save_job_preferences',
      description: '在用户明确要求记住或修改偏好时，保存求职关键词、城市和最低薪资。',
      schema: z.object({
        keywords: z.array(z.string().max(40)).max(10).optional(),
        cities: z.array(z.string().max(20)).max(10).optional(),
        minSalaryK: z.number().min(0).max(200).optional(),
        platforms: z.array(z.enum(['boss', 'zhilian', '51job', 'shixiseng'])).max(4).optional(),
        onlyUnclicked: z.boolean().optional(),
      }),
    },
  );

  const prepareCrawlTool = tool(
    async (input) => runLogged('prepare_job_crawl', input, () => {
      if (!isSupportedPlatform(input.platform)) {
        throw new Error(`平台 ${input.platform} 暂不支持`);
      }
      const payload = {
        platform: input.platform,
        query: input.query.trim(),
        city: input.city?.trim() || '全国',
        pages: input.pages || 1,
      };
      const pending = createPendingAction(
        context.conversationId,
        'crawl_jobs',
        payload,
        context.userId,
      );
      const label = PLATFORM_CONFIG.find((item) => item.name === input.platform)?.label || input.platform;
      const artifact = {
        kind: 'confirmation',
        action: {
          id: pending.id,
          actionType: 'crawl_jobs',
          title: `抓取 ${label} 职位`,
          description: `${payload.query} · ${payload.city} · ${payload.pages} 页`,
            payload,
            expiresAt: pending.expires_at,
            status: pending.status,
        },
      };
      logAgentAction(context.conversationId, 'crawl_jobs', payload, artifact, 'pending', context.userId);
      return toolResult('抓取任务已准备，需要用户在界面中确认后才会执行。', artifact);
    }),
    {
      name: 'prepare_job_crawl',
      description: '准备抓取职位任务。该工具不会直接抓取，只会创建必须由用户确认的动作。',
      schema: z.object({
        platform: z.enum(['boss', 'zhilian', '51job', 'shixiseng']),
        query: z.string().min(1).max(80),
        city: z.string().max(20).optional(),
        pages: z.number().int().min(1).max(3).optional(),
      }),
    },
  );

  const findDataIssuesTool = tool(
    async (input) => runLogged('find_data_issues', input, () => {
      const field = input.field || 'salary';
      const column = field === 'salary' ? 'salary' : 'company_name';
      const rows = db.prepare(`
        SELECT id, platform, title, company_name, salary, location, job_url, crawled_at
        FROM jobs
        WHERE TRIM(COALESCE(${column}, '')) IN ('', '·', '薪资见详情')
        ORDER BY crawled_at DESC LIMIT ?
      `).all(input.limit || 10).map(toAgentJobCard);
      return toolResult(
        `找到 ${rows.length} 个${field === 'salary' ? '薪资' : '公司'}信息缺失的职位。`,
        { kind: 'job_list', jobs: rows, conditions: `${field} 信息缺失` },
      );
    }),
    {
      name: 'find_data_issues',
      description: '查找薪资或公司信息缺失的职位，用于检查抓取质量。',
      schema: z.object({
        field: z.enum(['salary', 'company']).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
  );

  return [
    searchJobsTool,
    getJobDetailTool,
    getStatisticsTool,
    getPlatformStatusTool,
    getPreferencesTool,
    savePreferencesTool,
    prepareCrawlTool,
    findDataIssuesTool,
  ];
}
