import db from '../database';
import { v4 as uuidv4 } from '../utils';

export type CampusSourceType = 'manual' | 'agent';
export type CampusVerificationStatus = 'verified' | 'user_confirmed' | 'unverified' | 'rejected';
export type CampusVerificationMethod = 'official_domain' | 'official_referral' | 'manual' | null;
export type CampusSiteKind = 'official_site' | 'referral_link' | 'aggregated_reference';

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
  siteKind?: CampusSiteKind;
  tags?: string[];
  notes?: string;
}

const MAX_URL_LENGTH = 2048;
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', '0.0.0.0', '127.0.0.1', '::1']);

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
    status: row.status as CampusSite['status'],
  };
}

export function listCampusSites(options: {
  keyword?: string;
  sourceType?: CampusSourceType | 'all';
  verificationStatus?: CampusVerificationStatus | 'all';
  status?: CampusSite['status'] | 'all';
  limit?: number;
  offset?: number;
} = {}) {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const keyword = normalizeText(options.keyword, 100);
  if (keyword) {
    where.push('(company_name LIKE ? OR site_name LIKE ? OR domain LIKE ? OR tags LIKE ?)');
    const value = `%${keyword}%`;
    params.push(value, value, value, value);
  }
  if (options.sourceType && options.sourceType !== 'all') {
    where.push('source_type = ?');
    params.push(options.sourceType);
  }
  if (options.verificationStatus && options.verificationStatus !== 'all') {
    where.push('verification_status = ?');
    params.push(options.verificationStatus);
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
    ORDER BY CASE verification_status WHEN 'verified' THEN 0 WHEN 'user_confirmed' THEN 1 ELSE 2 END,
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
  if (sourceType === 'agent' && verificationStatus !== 'verified') {
    throw new CampusSiteTrustError('Agent 发现的官网必须先通过验证');
  }
  if (sourceType === 'agent' && !isTrustedCampusUrl(companyName, raw)) {
    throw new CampusSiteTrustError('该链接没有匹配到已审核的官方入口，不能保存');
  }

  const duplicate = db.prepare(
    'SELECT id FROM campus_sites WHERE company_name = ? AND domain = ? LIMIT 1'
  ).get(companyName, domain) as { id: string } | undefined;
  if (duplicate) throw new CampusSiteDuplicateError('该公司已经存在相同域名的官网记录');

  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO campus_sites (
      id, company_name, site_name, official_url, domain, source_type, source_query,
      confidence, verification_status, verification_method, verification_evidence,
      site_kind, status, tags, notes, last_checked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
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
    normalizeTags(input.tags),
    normalizeText(input.notes, 1000) || null,
    verificationStatus === 'verified' ? now : null,
    now,
    now,
  );
  return getCampusSiteById(id)!;
}

export function updateCampusSite(id: string, input: Partial<CampusSiteInput> & { status?: CampusSite['status'] }) {
  const current = getCampusSiteById(id);
  if (!current) return null;
  const companyName = input.companyName === undefined ? current.company_name : normalizeText(input.companyName, 100);
  if (!companyName) throw new CampusSiteInputError('请提供公司名称');
  const url = input.officialUrl === undefined ? current.official_url : ensureSafeUrl(input.officialUrl).raw;
  const domain = ensureSafeUrl(url).domain;
  const duplicate = db.prepare(
    'SELECT id FROM campus_sites WHERE company_name = ? AND domain = ? AND id <> ? LIMIT 1'
  ).get(companyName, domain, id) as { id: string } | undefined;
  if (duplicate) throw new CampusSiteDuplicateError('该公司已经存在相同域名的官网记录');

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

export async function discoverCampusSites(companyName: string, sourceQuery = companyName): Promise<CampusSiteCandidate[]> {
  const local = searchCampusSites(companyName, 5);
  if (local.length) {
    return local.map((site) => ({
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
    }));
  }

  const entry = registryForCompany(companyName);
  if (!entry) return [];
  return [{
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
  }];
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
