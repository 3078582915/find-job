import { tool } from 'langchain';
import { z } from 'zod';
import db from '../database';
import { validateLoginState } from '../crawlers/browser';
import { PLATFORM_CONFIG, isSupportedPlatform } from '../platformRegistry';
import {
  getJobById,
  getJobLibraryStatistics,
  searchJobs,
  toAgentJobCard,
} from '../services/jobService';
import { getRagIndexStats, semanticSearchJobs } from '../services/ragService';
import {
  CampusSiteDuplicateError,
  createCampusSite,
  discoverCampusSites,
  findCampusSiteCandidates,
  getVerifiedRegistryCandidate,
  searchCampusSites,
} from '../services/campusSiteService';
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

function evidenceUrls(value: string | null, fallback: string) {
  if (!value) return [fallback];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [fallback];
  } catch {
    return [fallback];
  }
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

  const semanticSearchJobsTool = tool(
    async (input) => runLogged('semantic_search_jobs', input, () => {
      const jobs = semanticSearchJobs({
        query: input.query,
        city: input.city,
        platform: input.platform,
        minSalaryK: input.minSalaryK,
        onlyUnclicked: input.onlyUnclicked,
        onlyClicked: input.onlyClicked,
        salaryStatus: input.salaryStatus,
        companyStatus: input.companyStatus,
        limit: input.limit,
        topK: input.topK,
        userId: context.userId,
      }).map(toAgentJobCard);
      const stats = getRagIndexStats();
      const conditions = [
        `语义“${input.query}”`,
        input.city && input.city !== '全国' && `城市“${input.city}”`,
        input.platform && input.platform !== 'all' && `平台“${input.platform}”`,
        input.minSalaryK && `最低月薪 ${input.minSalaryK}K`,
        input.onlyUnclicked && '仅未查看',
      ].filter(Boolean).join('、');
      return toolResult(
        `RAG 按${conditions}召回 ${jobs.length} 个职位。索引覆盖 ${stats.indexedJobs}/${stats.totalJobs} 个岗位。`,
        { kind: 'job_list', jobs, conditions, rag: stats },
      );
    }),
    {
      name: 'semantic_search_jobs',
      description: '使用 RAG 语义检索本地职位库。适合“相关岗位、类似岗位、某行业方向、自然语言偏好”等无法靠精确关键词完全匹配的查询。',
      schema: z.object({
        query: z.string().min(1).max(160).describe('自然语言检索需求，例如“康复医疗相关的前端岗位”'),
        city: z.string().max(20).optional().describe('城市；全国可省略'),
        platform: z.enum(['all', 'boss', 'zhilian', '51job', 'shixiseng']).optional(),
        minSalaryK: z.number().min(0).max(200).optional().describe('最低月薪，单位 K'),
        onlyUnclicked: z.boolean().optional(),
        onlyClicked: z.boolean().optional(),
        salaryStatus: z.enum(['all', 'present', 'missing']).optional(),
        companyStatus: z.enum(['all', 'present', 'missing']).optional(),
        limit: z.number().int().min(1).max(20).optional(),
        topK: z.number().int().min(5).max(120).optional(),
      }),
    },
  );

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
    async () => runLogged('get_platform_status', {}, async () => {
      const platforms = [];
      for (const platform of PLATFORM_CONFIG) {
        platforms.push({
          name: platform.name,
          label: platform.label,
          loggedIn: await validateLoginState(platform.name),
          requiresLoginForCrawl: platform.requiresLoginForCrawl,
        });
      }
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

  const searchCampusSitesTool = tool(
    async (input) => runLogged('search_campus_sites', input, () => {
      const sites = searchCampusSites(input.keyword, input.limit).map((site) => ({
        companyName: site.company_name,
        siteName: site.site_name || `${site.company_name}校招官网`,
        url: site.official_url,
        domain: site.domain,
        confidence: site.verification_status === 'verified' ? 100 : 95,
        verificationStatus: site.verification_status === 'verified' ? 'verified' as const : 'user_confirmed' as const,
        verificationMethod: site.verification_method || 'manual' as const,
        evidenceUrls: evidenceUrls(site.verification_evidence, site.official_url),
        siteKind: site.site_kind || 'official_site',
        reason: site.verification_status === 'verified' ? '来自本地已验证官网库' : '来自用户确认的官网记录',
      }));
      return toolResult(
        sites.length ? `本地官网库找到 ${sites.length} 个可用入口。` : '本地官网库没有匹配的校招官网。',
        { kind: 'campus_sites', campusSites: sites },
      );
    }),
    {
      name: 'search_campus_sites',
      description: '查询本地已经保存并可打开的校招官网。优先用于处理公司校招官网查询。',
      schema: z.object({
        keyword: z.string().min(1).max(100).describe('公司名称，例如字节跳动、蚂蚁集团'),
        limit: z.number().int().min(1).max(10).optional(),
      }),
    },
  );

  const discoverCampusSiteTool = tool(
    async (input) => runLogged('discover_campus_site', input, async () => {
      const candidates = await discoverCampusSites(input.companyName, input.sourceQuery || input.companyName);
      if (!candidates.length) {
        return toolResult(`暂未找到“${input.companyName}”已验证的官方校招入口。系统不会提供未经验证的跳转链接。`);
      }
      const verifiedCount = candidates.filter((candidate) => candidate.verificationStatus === 'verified').length;
      return toolResult(
        `找到 ${candidates.length} 个可用的“${input.companyName}”校招入口，其中系统验证 ${verifiedCount} 个，其余为用户确认记录。`,
        { kind: 'campus_sites', campusSites: candidates },
      );
    }),
    {
      name: 'discover_campus_site',
      description: '发现并返回已通过官方域名审核的校招官网。找不到可信入口时返回未找到，绝不返回可疑或未经验证的链接。',
      schema: z.object({
        companyName: z.string().min(1).max(100).describe('公司名称'),
        sourceQuery: z.string().max(240).optional().describe('用户原始查询'),
      }),
    },
  );

  const findOfficialCampusSiteTool = tool(
    async (input) => runLogged('find_official_campus_site', input, async () => {
      const result = await findCampusSiteCandidates(input.companyName, input.sourceQuery || input.companyName);
      if (result.verified.length) {
        const primary = result.verified[0];
        let saved = false;
        try {
          createCampusSite({
            companyName: primary.companyName,
            siteName: primary.siteName,
            officialUrl: primary.url,
            sourceType: 'agent',
            sourceQuery: input.sourceQuery || input.companyName,
            confidence: primary.confidence,
            verificationStatus: 'verified',
            verificationMethod: 'official_domain',
            verificationEvidence: primary.evidenceUrls,
            externalVerified: true,
            siteKind: 'official_site',
            tags: ['校招', '官方入口'],
          });
          saved = true;
        } catch (error) {
          if (!(error instanceof CampusSiteDuplicateError)) throw error;
        }
        return toolResult(
          `已找到“${input.companyName}”的主校招入口，并通过官方域名、页面内容和校招语义交叉验证${saved ? '，已写入校招官网库' : '，校招官网库中已存在'}。`,
          {
            kind: 'campus_sites',
            campusSites: [{ ...primary, saveable: false, saved }],
            persistence: {
              operation: 'save_campus_site',
              status: saved ? 'saved' : 'existing',
              savedCount: saved ? 1 : 0,
              existingCount: saved ? 0 : 1,
              failedCount: 0,
            },
          },
        );
      }
      if (result.review.length) {
        return toolResult(
          `找到 ${result.review.length} 个“${input.companyName}”校招候选链接，但证据不足以自动认定为官方入口，已标记为待人工确认。`,
          { kind: 'campus_site_candidates', campusSiteCandidates: result.review },
        );
      }
      return toolResult(`暂未找到“${input.companyName}”可交叉验证的校招官网候选。`);
    }),
    {
      name: 'find_official_campus_site',
      description: '自动搜索公司校招官网，并通过域名、搜索结果和页面内容交叉验证。高置信度结果才会作为官方入口返回；证据不足的结果会单独标记为待人工确认，绝不冒充官网。',
      schema: z.object({
        companyName: z.string().min(1).max(100).describe('公司名称，例如游卡、米哈游、蚂蚁集团'),
        sourceQuery: z.string().max(240).optional().describe('用户原始查询'),
      }),
    },
  );

  const saveCampusSiteTool = tool(
    async (input) => runLogged('save_campus_site', input, () => {
      const candidate = getVerifiedRegistryCandidate(input.companyName, input.officialUrl);
      if (!candidate) {
        return toolResult('该链接没有匹配到已审核的官方校招入口，未保存。', {
          persistence: { operation: 'save_campus_site', status: 'failed', savedCount: 0, existingCount: 0, failedCount: 1 },
        });
      }
      try {
        const record = createCampusSite({
          companyName: candidate.companyName,
          siteName: input.siteName || candidate.siteName,
          officialUrl: candidate.url,
          sourceType: 'agent',
          sourceQuery: input.sourceQuery,
          confidence: candidate.confidence,
          verificationStatus: candidate.verificationStatus,
          verificationMethod: candidate.verificationMethod,
          verificationEvidence: candidate.evidenceUrls,
          siteKind: candidate.siteKind,
          tags: input.tags,
          notes: input.notes,
        });
        return toolResult('已保存到校招官网库。', {
          kind: 'campus_sites',
          campusSites: [{ ...candidate, saved: true }],
          persistence: { operation: 'save_campus_site', status: 'saved', savedCount: 1, existingCount: 0, failedCount: 0, recordId: record.id },
        });
      } catch (error) {
        if (!(error instanceof CampusSiteDuplicateError)) throw error;
        return toolResult('该校招官网已存在于官网库，本次没有新增记录。', {
          kind: 'campus_sites',
          campusSites: [{ ...candidate, saved: false }],
          persistence: { operation: 'save_campus_site', status: 'existing', savedCount: 0, existingCount: 1, failedCount: 0 },
        });
      }
    }),
    {
      name: 'save_campus_site',
      description: '保存用户确认过的已验证校招官网。仅允许保存可信目录中的官方入口。',
      schema: z.object({
        companyName: z.string().min(1).max(100),
        officialUrl: z.string().url().max(2048),
        siteName: z.string().max(120).optional(),
        sourceQuery: z.string().max(240).optional(),
        tags: z.array(z.string().max(30)).max(20).optional(),
        notes: z.string().max(1000).optional(),
      }),
    },
  );

  const saveUserConfirmedCampusSitesTool = tool(
    async (input) => runLogged('save_user_confirmed_campus_sites', input, () => {
      const saved: any[] = [];
      const existing: Array<{ companyName: string; url: string; reason: string }> = [];
      const failed: Array<{ companyName: string; url: string; reason: string }> = [];

      for (const site of input.sites) {
        try {
          const record = createCampusSite({
            companyName: site.companyName,
            siteName: site.siteName,
            officialUrl: site.officialUrl,
            sourceType: 'manual',
            sourceQuery: input.sourceQuery,
            siteKind: site.siteKind,
            tags: site.tags,
            notes: site.notes,
          });
          saved.push(record);
        } catch (error) {
          const item = {
            companyName: site.companyName,
            url: site.officialUrl,
            reason: error instanceof Error ? error.message : String(error),
          };
          if (error instanceof CampusSiteDuplicateError) existing.push(item);
          else failed.push(item);
        }
      }

      const cards = saved.map((record) => ({
        companyName: record.company_name,
        siteName: record.site_name || `${record.company_name}校招入口`,
        url: record.official_url,
        domain: record.domain,
        confidence: 100,
        verificationStatus: 'user_confirmed' as const,
        verificationMethod: 'manual' as const,
        evidenceUrls: [],
        siteKind: record.site_kind,
        reason: '用户在消息中明确提供并确认保存；这是用户确认记录，不代表系统已验证官网',
        saved: true,
      }));

      const persistenceStatus = failed.length ? 'partial' : saved.length ? 'saved' : existing.length ? 'existing' : 'failed';
      return toolResult(
        `本次实际写入 ${saved.length} 条校招链接${existing.length ? `，已有 ${existing.length} 条` : ''}${failed.length ? `，${failed.length} 条失败` : ''}。`,
        {
          kind: 'campus_sites',
          campusSites: cards,
          persistence: {
            operation: 'save_user_confirmed_campus_sites',
            status: persistenceStatus,
            savedCount: saved.length,
            existingCount: existing.length,
            failedCount: failed.length,
          },
          savedCount: saved.length,
          existingCount: existing.length,
          failed,
          existing,
        },
      );
    }),
    {
      name: 'save_user_confirmed_campus_sites',
      description: '批量保存用户在消息中明确提供的校招链接。允许内推 ATS 链接和信息汇总表，但必须标记为用户已确认，不能当作系统验证的官方入口。',
      schema: z.object({
        sites: z.array(z.object({
          companyName: z.string().min(1).max(100),
          siteName: z.string().max(120).optional(),
          officialUrl: z.string().url().max(2048),
          siteKind: z.enum(['official_site', 'referral_link', 'aggregated_reference']).default('referral_link'),
          tags: z.array(z.string().max(30)).max(20).optional(),
          notes: z.string().max(1000).optional(),
        })).min(1).max(20),
        sourceQuery: z.string().max(4000).optional(),
      }),
    },
  );

  return [
    semanticSearchJobsTool,
    searchJobsTool,
    getJobDetailTool,
    getStatisticsTool,
    getPlatformStatusTool,
    getPreferencesTool,
    savePreferencesTool,
    prepareCrawlTool,
    findDataIssuesTool,
    searchCampusSitesTool,
    findOfficialCampusSiteTool,
    discoverCampusSiteTool,
    saveCampusSiteTool,
    saveUserConfirmedCampusSitesTool,
  ];
}
