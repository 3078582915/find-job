import db from '../database';
import { v4 as uuidv4 } from '../utils';

export type CampusSourceType = 'manual' | 'agent';
export type CampusVerificationStatus = 'verified' | 'user_confirmed' | 'unverified' | 'rejected';
export type CampusVerificationMethod = 'official_domain' | 'official_referral' | 'manual' | null;
export type CampusSiteKind = 'official_site' | 'referral_link' | 'aggregated_reference';
export type CampusApplicationStatus = 'not_applied' | 'viewed_not_applied' | 'applied' | 'terminated';

export interface CampusSite {
  id: string;
  company_name: string;
  site_name: string | null;
  official_url: string;
  domain: string;
  source_type: CampusSourceType;
  source_query: string | null;
  confidence: number;
  verification_status: CampusVerificationStatus;
  verification_method: CampusVerificationMethod;
  verification_evidence: string | null;
  site_kind: CampusSiteKind;
  is_favorite: boolean;
  application_status: CampusApplicationStatus;
  applied_at: string | null;
  terminated_at: string | null;
  application_status_updated_at: string | null;
  status: 'active' | 'inactive';
  tags: string | null;
  notes: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampusSiteCandidate {
  companyName: string;
  siteName: string;
  url: string;
  domain: string;
  confidence: number;
  verificationStatus: 'verified' | 'user_confirmed';
  verificationMethod: 'official_domain' | 'official_referral' | 'manual';
  evidenceUrls: string[];
  siteKind: CampusSiteKind;
  reason: string;
  saved?: boolean;
  saveable?: boolean;
}

export interface CampusSiteSearchCandidate {
  companyName: string;
  siteName: string;
  url: string;
  domain: string;
  confidence: number;
  evidenceUrls: string[];
  reason: string;
  reviewRequired: true;
}

export interface CampusSiteInput {
  companyName: string;
  siteName?: string;
  officialUrl: string;
  sourceType?: CampusSourceType;
  sourceQuery?: string;
  confidence?: number;
  verificationStatus?: CampusVerificationStatus;
  verificationMethod?: Exclude<CampusVerificationMethod, null>;
  verificationEvidence?: string[];
  externalVerified?: boolean;
  siteKind?: CampusSiteKind;
  applicationStatus?: CampusApplicationStatus;
  tags?: string[];
  notes?: string;
}

const MAX_URL_LENGTH = 2048;
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', '0.0.0.0', '127.0.0.1', '::1']);
const CAMPUS_SEARCH_CACHE_TTL = 5 * 60 * 1000;
const campusSearchCache = new Map<string, { expiresAt: number; result: { verified: CampusSiteCandidate[]; review: CampusSiteSearchCandidate[] } }>();
const EXCLUDED_SEARCH_HOSTS = [
  'bing.com', 'baidu.com', 'google.com', 'so.com', 'sogou.com',
  'zhipin.com', 'zhaopin.com', '51job.com', 'liepin.com', 'nowcoder.com',
  'yingjiesheng.com', 'jobui.com', 'docs.qq.com', 'feishu.cn', 'maimai.cn',
  'edu.cn', 'niuqizp.com', 'hicv.cn', 'chashouye.com', 'sohu.com',
  'mioffice.cn', 'mokahr.com', 'workday.com', 'smartrecruiters.com', 'greenhouse.io',
];
const CAMPUS_PATH_PATTERN = /(camp|career|recruit|recruitment|校园|校招)/i;
const CAMPUS_PAGE_PATTERN = /(校园招聘|校招|校园招聘官网|campus recruitment|campus careers|campus hiring|graduate recruitment|graduate program|early careers)/i;
const COMPANY_DOMAIN_HINTS: Record<string, string[]> = {
  游卡: ['yokaverse', 'yokagames'],
  华为: ['huawei'],
  携程: ['ctrip', 'trip'],
  米哈游: ['mihoyo'],
  字节跳动: ['bytedance'],
  腾讯: ['tencent', 'qq'],
  阿里巴巴: ['alibaba', 'aliyun', 'antgroup'],
  蚂蚁集团: ['antgroup', 'alipay'],
};

// This small registry is the trust anchor for Agent discovery. New companies can be added only after their official entry is reviewed.
const VERIFIED_REGISTRY = [
  {
    aliases: ['字节跳动', 'bytedance'],
    companyName: '字节跳动',
    siteName: '字节跳动校园招聘',
    url: 'https://jobs.bytedance.com/campus/',
    domains: ['jobs.bytedance.com'],
    pathPrefix: '/campus',
    evidenceUrls: ['https://jobs.bytedance.com/campus/'],
  },
  {
    aliases: ['腾讯', 'tencent'],
    companyName: '腾讯',
    siteName: '腾讯校园招聘',
    url: 'https://join.qq.com/',
    domains: ['join.qq.com'],
    pathPrefix: '/',
    evidenceUrls: ['https://hr.tencent.com/zh-cn/'],
  },
  {
    aliases: ['阿里巴巴', '阿里', 'alibaba'],
    companyName: '阿里巴巴',
    siteName: '阿里巴巴校园招聘',
    url: 'https://talent.alibaba.com/campus/',
    domains: ['talent.alibaba.com'],
    pathPrefix: '/campus',
    evidenceUrls: ['https://talent.alibaba.com/campus/'],
  },
  {
    aliases: ['携程', '携程集团', 'ctrip', 'trip.com'],
    companyName: '携程集团',
    siteName: '携程校园招聘',
    url: 'https://careers.ctrip.com/',
    domains: ['careers.ctrip.com'],
    pathPrefix: '/',
    evidenceUrls: [
      'https://careers.ctrip.com/',
      'https://pages.ctrip.com/commerce/promote/201108/other/hire/aboutctrip1.html',
    ],
  },
];

export class CampusSiteInputError extends Error {}
export class CampusSiteDuplicateError extends Error {}
export class CampusSiteTrustError extends Error {}

function clamp(value: unknown, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function ensureSafeUrl(value: unknown) {
  const raw = normalizeText(value, MAX_URL_LENGTH);
  if (!raw) throw new CampusSiteInputError('请提供官网链接');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CampusSiteInputError('官网链接格式不正确');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new CampusSiteInputError('官网链接只能使用 HTTP 或 HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new CampusSiteInputError('官网链接不能包含账号或密码');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local')) {
    throw new CampusSiteInputError('官网链接不能指向本机或内网地址');
  }
  return { raw, parsed, domain: hostname };
}

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return null;
  const values = [...new Set(tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, 30))
    .filter(Boolean))].slice(0, 20);
  return JSON.stringify(values);
}

function normalizeSiteKind(value: unknown, fallback: CampusSiteKind = 'official_site'): CampusSiteKind {
  return value === 'referral_link' || value === 'aggregated_reference' || value === 'official_site'
    ? value
    : fallback;
}

function mapRow(row: any): CampusSite {
  return {
    ...row,
    source_type: row.source_type as CampusSourceType,
    verification_status: row.verification_status as CampusVerificationStatus,
    verification_method: row.verification_method as CampusVerificationMethod,
    is_favorite: Boolean(row.is_favorite),
    application_status: (row.application_status || 'not_applied') as CampusApplicationStatus,
    applied_at: row.applied_at || null,
    terminated_at: row.terminated_at || null,
    application_status_updated_at: row.application_status_updated_at || null,
    status: row.status as CampusSite['status'],
  };
}

export interface CampusSiteListOptions {
  keyword?: string;
  sourceType?: CampusSourceType | 'all';
  verificationStatus?: CampusVerificationStatus | 'all';
  applicationStatus?: CampusApplicationStatus | 'all';
  status?: CampusSite['status'] | 'all';
}

export function listCampusSites(options: CampusSiteListOptions & {
  limit?: number;
  offset?: number;
} = {}) {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const keyword = normalizeText(options.keyword, 100);
  if (keyword) {
    where.push('(company_name LIKE ? OR site_name LIKE ? OR domain LIKE ? OR official_url LIKE ? OR tags LIKE ?)');
    const value = `%${keyword}%`;
    params.push(value, value, value, value, value);
  }
  if (options.sourceType && options.sourceType !== 'all') {
    where.push('source_type = ?');
    params.push(options.sourceType);
  }
  if (options.verificationStatus && options.verificationStatus !== 'all') {
    where.push('verification_status = ?');
    params.push(options.verificationStatus);
  }
  if (options.applicationStatus && options.applicationStatus !== 'all') {
    where.push('application_status = ?');
    params.push(options.applicationStatus);
  }
  if (options.status && options.status !== 'all') {
    where.push('status = ?');
    params.push(options.status);
  }

  const total = (db.prepare(`SELECT COUNT(*) AS count FROM campus_sites WHERE ${where.join(' AND ')}`).get(...params) as any).count;
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const offset = Math.max(0, Number(options.offset) || 0);
  const records = db.prepare(`
    SELECT * FROM campus_sites
    WHERE ${where.join(' AND ')}
    ORDER BY is_favorite DESC,
             CASE verification_status WHEN 'verified' THEN 0 WHEN 'user_confirmed' THEN 1 ELSE 2 END,
             updated_at DESC, company_name ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map(mapRow);
  return { total, records, limit, offset };
}

export function getCampusSiteStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN source_type = 'agent' THEN 1 ELSE 0 END) AS agent,
      SUM(CASE WHEN source_type = 'manual' THEN 1 ELSE 0 END) AS manual,
      SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN verification_status IN ('unverified', 'rejected') OR status = 'inactive' THEN 1 ELSE 0 END) AS invalid
    FROM campus_sites
  `).get() as any;
  return {
    total: Number(row.total || 0),
    agent: Number(row.agent || 0),
    manual: Number(row.manual || 0),
    verified: Number(row.verified || 0),
    invalid: Number(row.invalid || 0),
  };
}

export function getCampusSiteById(id: string) {
  const row = db.prepare('SELECT * FROM campus_sites WHERE id = ?').get(id) as any;
  return row ? mapRow(row) : null;
}

export function searchCampusSites(keyword: string, limit = 8) {
  return listCampusSites({ keyword, status: 'active', limit, offset: 0 }).records
    .filter((site) => site.verification_status === 'verified' || site.verification_status === 'user_confirmed');
}

export function createCampusSite(input: CampusSiteInput) {
  const companyName = normalizeText(input.companyName, 100);
  if (!companyName) throw new CampusSiteInputError('请提供公司名称');
  const { raw, domain } = ensureSafeUrl(input.officialUrl);
  const sourceType = input.sourceType || 'manual';
  const siteKind = normalizeSiteKind(input.siteKind);
  const verificationStatus = sourceType === 'manual'
    ? 'user_confirmed'
    : (input.verificationStatus || 'unverified');
  const externalVerified = input.externalVerified === true
    && verificationStatus === 'verified'
    && input.verificationMethod === 'official_domain'
    && Boolean(input.verificationEvidence?.length);
  if (sourceType === 'agent' && verificationStatus !== 'verified') {
    throw new CampusSiteTrustError('Agent 发现的官网必须先通过验证');
  }
  if (sourceType === 'agent' && !isTrustedCampusUrl(companyName, raw) && !externalVerified) {
    throw new CampusSiteTrustError('该链接没有匹配到已审核的官方入口，不能保存');
  }

  const duplicate = db.prepare(
    'SELECT id FROM campus_sites WHERE company_name = ? AND official_url = ? LIMIT 1'
  ).get(companyName, raw) as { id: string } | undefined;
  if (duplicate) throw new CampusSiteDuplicateError('该公司已经存在相同链接的官网记录');

  const now = new Date().toISOString();
  const id = uuidv4();
  const applicationStatus = input.applicationStatus || 'not_applied';
  const appliedAt = applicationStatus === 'applied' ? now : null;
  const terminatedAt = applicationStatus === 'terminated' ? now : null;
  const applicationStatusUpdatedAt = applicationStatus === 'not_applied' ? null : now;
  db.prepare(`
    INSERT INTO campus_sites (
      id, company_name, site_name, official_url, domain, source_type, source_query,
      confidence, verification_status, verification_method, verification_evidence,
      site_kind, application_status, applied_at, terminated_at, application_status_updated_at,
      status, tags, notes, last_checked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).run(
    id,
    companyName,
    normalizeText(input.siteName, 120) || null,
    raw,
    domain,
    sourceType,
    normalizeText(input.sourceQuery, 240) || null,
    clamp(input.confidence, 100),
    verificationStatus,
    sourceType === 'manual' ? 'manual' : (input.verificationMethod || 'official_domain'),
    sourceType === 'manual' ? null : (input.verificationEvidence?.length ? JSON.stringify(input.verificationEvidence.slice(0, 10)) : null),
    siteKind,
    applicationStatus,
    appliedAt,
    terminatedAt,
    applicationStatusUpdatedAt,
    normalizeTags(input.tags),
    normalizeText(input.notes, 1000) || null,
    verificationStatus === 'verified' ? now : null,
    now,
    now,
  );
  const persisted = getCampusSiteById(id);
  if (!persisted) throw new Error('校招官网写入后校验失败，数据库中未找到新记录');
  return persisted;
}

export function updateCampusSiteApplicationStatus(id: string, applicationStatus: CampusApplicationStatus) {
  if (applicationStatus !== 'not_applied' && applicationStatus !== 'viewed_not_applied' && applicationStatus !== 'applied' && applicationStatus !== 'terminated') {
    throw new CampusSiteInputError('投递状态不正确');
  }
  const current = getCampusSiteById(id);
  if (!current) return null;
  if (current.application_status === applicationStatus) return current;
  const now = new Date().toISOString();
  const appliedAt = applicationStatus === 'not_applied' || applicationStatus === 'viewed_not_applied'
    ? null
    : applicationStatus === 'applied'
      ? (current.applied_at || now)
      : current.applied_at;
  const terminatedAt = applicationStatus === 'terminated'
    ? (current.terminated_at || now)
    : null;
  const result = db.prepare(
    'UPDATE campus_sites SET application_status = ?, applied_at = ?, terminated_at = ?, application_status_updated_at = ?, updated_at = ? WHERE id = ?'
  ).run(applicationStatus, appliedAt, terminatedAt, now, now, id);
  return result.changes ? getCampusSiteById(id) : null;
}

export function updateCampusSiteFavorite(id: string, isFavorite: boolean) {
  const current = getCampusSiteById(id);
  if (!current) return null;
  if (current.is_favorite === isFavorite) return current;

  const now = new Date().toISOString();
  const result = db.prepare(
    'UPDATE campus_sites SET is_favorite = ?, updated_at = ? WHERE id = ?'
  ).run(isFavorite ? 1 : 0, now, id);
  return result.changes ? getCampusSiteById(id) : null;
}

function formatExportTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportTags(value: string | null) {
  if (!value) return '';
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags.join('、') : value;
  } catch {
    return value;
  }
}

export function exportCampusSitesCsv(options: CampusSiteListOptions = {}) {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const keyword = normalizeText(options.keyword, 100);
  if (keyword) {
    where.push('(company_name LIKE ? OR site_name LIKE ? OR domain LIKE ? OR official_url LIKE ? OR tags LIKE ?)');
    const value = `%${keyword}%`;
    params.push(value, value, value, value, value);
  }
  if (options.sourceType && options.sourceType !== 'all') {
    where.push('source_type = ?');
    params.push(options.sourceType);
  }
  if (options.verificationStatus && options.verificationStatus !== 'all') {
    where.push('verification_status = ?');
    params.push(options.verificationStatus);
  }
  if (options.applicationStatus && options.applicationStatus !== 'all') {
    where.push('application_status = ?');
    params.push(options.applicationStatus);
  }
  if (options.status && options.status !== 'all') {
    where.push('status = ?');
    params.push(options.status);
  }

  const records = db.prepare(`
    SELECT * FROM campus_sites
    WHERE ${where.join(' AND ')}
    ORDER BY is_favorite DESC,
             CASE verification_status WHEN 'verified' THEN 0 WHEN 'user_confirmed' THEN 1 ELSE 2 END,
             updated_at DESC, company_name ASC
  `).all(...params).map(mapRow);
  const statusLabels: Record<CampusApplicationStatus, string> = {
    not_applied: '未投递',
    viewed_not_applied: '看了没投',
    applied: '已投递',
    terminated: '流程终止',
  };
  const verificationLabels: Record<CampusVerificationStatus, string> = {
    verified: '系统已验证',
    user_confirmed: '用户已确认',
    unverified: '未验证',
    rejected: '验证拒绝',
  };
  const sourceLabels: Record<CampusSourceType, string> = { agent: 'Agent 发现', manual: '手动添加' };
  const kindLabels: Record<CampusSiteKind, string> = {
    official_site: '官方入口',
    referral_link: '内推链接',
    aggregated_reference: '信息汇总表',
  };
  const headers = ['公司名称', '官网名称', '官网链接', '域名', '是否收藏', '投递状态', '首次投递时间', '终止时间', '投递状态更新时间', '官网状态', '验证状态', '来源', '链接类型', '置信度', '标签', '备注', '创建时间', '记录更新时间'];
  const rows = records.map((site) => [
    site.company_name,
    site.site_name || '',
    site.official_url,
    site.domain,
    site.is_favorite ? '是' : '否',
    statusLabels[site.application_status],
    formatExportTime(site.applied_at),
    formatExportTime(site.terminated_at),
    formatExportTime(site.application_status_updated_at),
    site.status === 'active' ? '正常' : '失效',
    verificationLabels[site.verification_status],
    sourceLabels[site.source_type],
    kindLabels[site.site_kind],
    site.confidence,
    exportTags(site.tags),
    site.notes || '',
    formatExportTime(site.created_at),
    formatExportTime(site.updated_at),
  ]);
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function updateCampusSite(id: string, input: Partial<CampusSiteInput> & { status?: CampusSite['status'] }) {
  const current = getCampusSiteById(id);
  if (!current) return null;
  const companyName = input.companyName === undefined ? current.company_name : normalizeText(input.companyName, 100);
  if (!companyName) throw new CampusSiteInputError('请提供公司名称');
  const url = input.officialUrl === undefined ? current.official_url : ensureSafeUrl(input.officialUrl).raw;
  const domain = ensureSafeUrl(url).domain;
  const duplicate = db.prepare(
    'SELECT id FROM campus_sites WHERE company_name = ? AND official_url = ? AND id <> ? LIMIT 1'
  ).get(companyName, url, id) as { id: string } | undefined;
  if (duplicate) throw new CampusSiteDuplicateError('该公司已经存在相同链接的官网记录');

  const nextStatus = input.status || current.status;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE campus_sites SET
      company_name = ?, site_name = ?, official_url = ?, domain = ?,
      source_type = 'manual', verification_status = 'user_confirmed', verification_method = 'manual',
      verification_evidence = NULL, site_kind = ?, status = ?, tags = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    companyName,
    input.siteName === undefined ? current.site_name : normalizeText(input.siteName, 120) || null,
    url,
    domain,
    normalizeSiteKind(input.siteKind, current.site_kind),
    nextStatus,
    input.tags === undefined ? current.tags : normalizeTags(input.tags),
    input.notes === undefined ? current.notes : normalizeText(input.notes, 1000) || null,
    now,
    id,
  );
  return getCampusSiteById(id);
}

export function deleteCampusSite(id: string) {
  return db.prepare('DELETE FROM campus_sites WHERE id = ?').run(id).changes;
}

function normalizeCompany(value: string) {
  return value.toLowerCase().replace(/[\s·・（）()有限公司集团股份科技有限]/g, '');
}

function registryForCompany(companyName: string) {
  const normalized = normalizeCompany(companyName);
  return VERIFIED_REGISTRY.find((item) => item.aliases.some((alias) => normalized.includes(normalizeCompany(alias))));
}

export function isTrustedCampusUrl(companyName: string, value: string) {
  const entry = registryForCompany(companyName);
  if (!entry) return false;
  const { parsed } = ensureSafeUrl(value);
  const hostname = parsed.hostname.toLowerCase();
  return entry.domains.includes(hostname) && parsed.pathname.startsWith(entry.pathPrefix);
}

type ExternalSearchHit = { url: string; title: string; snippet: string; query: string };

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function searchText(value: string) {
  return value.toLowerCase().replace(/[\s·・（）()有限公司集团股份科技有限]/g, '');
}

function hostIsExcluded(hostname: string) {
  return EXCLUDED_SEARCH_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function hasCompanyHint(hostname: string, companyName: string) {
  const host = searchText(hostname.replace(/\./g, ''));
  const name = searchText(companyName);
  if (name.length >= 2 && host.includes(name)) return true;
  return (COMPANY_DOMAIN_HINTS[companyName] || []).some((hint) => host.includes(searchText(hint)));
}

function isUnrequestedSubBrand(hostname: string, companyName: string) {
  if (hostname.includes('huaweicloud') && !/(华为云|huawei\s*cloud)/i.test(companyName)) return true;
  return false;
}

function pageText(html: string) {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' '));
}

function pageSignals(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => match[1]);
  const descriptions = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /(?:name|property)=["'](?:description|og:description|twitter:description)["']/i.test(tag))
    .map((tag) => tag.match(/content=["']([^"']*)["']/i)?.[1] || '');
  return decodeHtml([title, ...headings, ...descriptions].join(' '));
}

function parseSearchLinks(html: string, query: string, engine: 'bing' | 'baidu') {
  const hits: ExternalSearchHit[] = [];
  const pattern = engine === 'bing'
    ? /<h2[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
    : /<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi;
  for (const match of html.matchAll(pattern)) {
    const rawUrl = decodeHtml(match[1]);
    let url: URL;
    try { url = new URL(rawUrl); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || hostIsExcluded(url.hostname)) continue;
    hits.push({ url: url.toString(), title: decodeHtml(match[2]), snippet: '', query });
  }
  return hits.slice(0, 8);
}

async function fetchExternalText(url: string, timeoutMs = 8000) {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 JobAgent/1.0 campus-site-discovery' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return '';
    return (await response.text()).slice(0, 500_000);
  } catch {
    return '';
  }
}

async function searchExternalSites(query: string) {
  const endpoints: Array<{ engine: 'bing' | 'baidu'; url: string }> = [
    { engine: 'bing', url: `https://www.bing.com/search?setlang=zh-CN&count=10&q=${encodeURIComponent(query)}` },
    { engine: 'baidu', url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}` },
  ];
  for (const endpoint of endpoints) {
    const html = await fetchExternalText(endpoint.url, 7000);
    if (!html) continue;
    const hits = parseSearchLinks(html, query, endpoint.engine);
    if (hits.length) return hits;
  }
  return [];
}

function candidateKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

function candidateDomainKey(candidate: { domain: string }) {
  return candidate.domain.toLowerCase().replace(/^www\./, '');
}

function preferCampusCandidate<T extends { domain: string; url: string; confidence: number }>(current: T, next: T) {
  if (next.confidence !== current.confidence) return next.confidence > current.confidence ? next : current;
  const currentPath = new URL(current.url).pathname.toLowerCase();
  const nextPath = new URL(next.url).pathname.toLowerCase();
  const currentExact = /campus-recruit|campus-recruitment/.test(currentPath) ? 1 : 0;
  const nextExact = /campus-recruit|campus-recruitment/.test(nextPath) ? 1 : 0;
  if (nextExact !== currentExact) return nextExact > currentExact ? next : current;
  return nextPath.length < currentPath.length ? next : current;
}

function dedupeCampusCandidates<T extends { domain: string; url: string; confidence: number }>(candidates: T[]) {
  const byDomain = new Map<string, T>();
  for (const candidate of candidates) {
    const key = candidateDomainKey(candidate);
    const current = byDomain.get(key);
    byDomain.set(key, current ? preferCampusCandidate(current, candidate) : candidate);
  }
  return [...byDomain.values()];
}

function localCandidate(site: CampusSite): CampusSiteCandidate {
  return {
    companyName: site.company_name,
    siteName: site.site_name || `${site.company_name}校招官网`,
    url: site.official_url,
    domain: site.domain,
    confidence: site.verification_status === 'verified' ? 100 : 95,
    verificationStatus: site.verification_status === 'verified' ? 'verified' : 'user_confirmed',
    verificationMethod: site.verification_method || 'manual',
    evidenceUrls: (() => {
      try { return site.verification_evidence ? JSON.parse(site.verification_evidence) : [site.official_url]; } catch { return [site.official_url]; }
    })(),
    siteKind: site.site_kind || 'official_site',
    reason: site.verification_status === 'verified' ? '来自本地已验证官网库' : '来自用户确认的官网记录',
    saved: true,
    saveable: false,
  };
}

function registryCandidate(companyName: string): CampusSiteCandidate | null {
  const entry = registryForCompany(companyName);
  if (!entry) return null;
  return {
    companyName: entry.companyName,
    siteName: entry.siteName,
    url: entry.url,
    domain: new URL(entry.url).hostname,
    confidence: 100,
    verificationStatus: 'verified',
    verificationMethod: 'official_domain',
    evidenceUrls: entry.evidenceUrls,
    siteKind: 'official_site',
    reason: '命中已审核的公司官方校招入口，域名和路径均在可信目录内',
  };
}

export async function findCampusSiteCandidates(companyName: string, sourceQuery = companyName) {
  const local = searchCampusSites(companyName, 5);
  if (local.length) return { verified: local.map(localCandidate), review: [] as CampusSiteSearchCandidate[] };
  const registry = registryCandidate(companyName);
  if (registry) return { verified: [registry], review: [] as CampusSiteSearchCandidate[] };

  const cacheKey = searchText(`${companyName}|${sourceQuery}`);
  const cached = campusSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const domainHints = COMPANY_DOMAIN_HINTS[companyName] || [];
  const queries = [
    `${companyName} 校园招聘 官方`,
    `${companyName} 校招 官网`,
    ...domainHints.flatMap((hint) => [`site:${hint} ${companyName} 校招`, `${companyName} ${hint}`]),
  ];
  const allHits = (await Promise.all(queries.map((query) => searchExternalSites(query)))).flat();
  const grouped = new Map<string, { hit: ExternalSearchHit; count: number; titles: string[] }>();
  for (const hit of allHits) {
    const key = candidateKey(hit.url);
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      current.titles.push(hit.title);
    } else {
      grouped.set(key, { hit, count: 1, titles: [hit.title] });
    }
  }

  const verified: CampusSiteCandidate[] = [];
  const review: CampusSiteSearchCandidate[] = [];
  for (const item of [...grouped.values()].slice(0, 12)) {
    let parsed: URL;
    try { parsed = new URL(item.hit.url); } catch { continue; }
    if (hostIsExcluded(parsed.hostname)) continue;
    if (isUnrequestedSubBrand(parsed.hostname, companyName)) continue;
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    const titleText = item.titles.join(' ');
    const hasCompanyText = searchText(`${titleText} ${item.hit.snippet}`).includes(searchText(companyName));
    const hasCampusPath = CAMPUS_PATH_PATTERN.test(parsed.pathname);
    const officialHint = hasCompanyHint(parsed.hostname, companyName);
    if (!hasCompanyText && !officialHint) continue;

    const html = await fetchExternalText(parsed.toString());
    const visible = pageText(html);
    const signals = pageSignals(html);
    const pageConfirmsCompany = Boolean(signals && searchText(signals).includes(searchText(companyName)))
      || Boolean(visible && searchText(visible.slice(0, 100_000)).includes(searchText(companyName)));
    const pageConfirmsCampus = Boolean(signals && CAMPUS_PAGE_PATTERN.test(signals))
      || Boolean(hasCampusPath && visible && CAMPUS_PAGE_PATTERN.test(visible.slice(0, 100_000)));
    const hasCampusEvidence = hasCampusPath || Boolean(signals && CAMPUS_PAGE_PATTERN.test(signals));
    if (!hasCampusEvidence || (!officialHint && !hasCampusPath)) continue;
    const searchVerified = hasCampusPath && hasCompanyText && pageConfirmsCompany && pageConfirmsCampus;
    const officialEvidence = officialHint || searchVerified;
    const score = Math.min(99, 35 + (item.count > 1 ? 20 : 0) + (hasCompanyText ? 15 : 0) + (hasCampusPath ? 10 : 0) + (officialEvidence ? 25 : 0) + (pageConfirmsCompany ? 10 : 0) + (pageConfirmsCampus ? 5 : 0));
    const evidenceUrls = [...new Set([item.hit.url, ...queries.map((query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`)])].slice(0, 4);
    const candidate = {
      companyName,
      siteName: `${companyName}校招官网候选`,
      url: parsed.toString(),
      domain: parsed.hostname,
      confidence: score,
      evidenceUrls,
      reason: `外部搜索命中 ${item.count} 个独立查询，${officialHint ? '域名包含公司标识，' : searchVerified ? '搜索结果与校招专属页面相互印证，' : ''}${pageConfirmsCompany ? '页面包含公司名称，' : ''}${pageConfirmsCampus ? '页面包含校招语义。' : '仍需人工确认页面归属。'}`,
    };
    if (officialEvidence && pageConfirmsCompany && pageConfirmsCampus && score >= 75) {
      verified.push({
        ...candidate,
        siteName: `${companyName}校招官网`,
        verificationStatus: 'verified',
        verificationMethod: 'official_domain',
        siteKind: 'official_site',
        reason: `${candidate.reason} 已通过域名、页面内容和校招语义交叉验证。`,
      });
    } else if (score >= 45) {
      review.push({ ...candidate, reviewRequired: true });
    }
  }

  const result = { verified: dedupeCampusCandidates(verified).slice(0, 5), review: dedupeCampusCandidates(review).slice(0, 5) };
  campusSearchCache.set(cacheKey, { expiresAt: Date.now() + CAMPUS_SEARCH_CACHE_TTL, result });
  return result;
}

export async function discoverCampusSites(companyName: string, sourceQuery = companyName): Promise<CampusSiteCandidate[]> {
  const result = await findCampusSiteCandidates(companyName, sourceQuery);
  return result.verified;
}

export function getVerifiedRegistryCandidate(companyName: string, url: string) {
  const entry = registryForCompany(companyName);
  if (!entry || !isTrustedCampusUrl(companyName, url)) return null;
  return {
    companyName: entry.companyName,
    siteName: entry.siteName,
    url,
    domain: new URL(url).hostname,
    confidence: 100,
    verificationStatus: 'verified' as const,
    verificationMethod: 'official_domain' as const,
    evidenceUrls: entry.evidenceUrls,
    siteKind: 'official_site' as const,
    reason: '链接匹配已审核的公司官方校招域名和路径',
  };
}
