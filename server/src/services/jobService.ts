import crypto from 'crypto';
import db from '../database';
import { crawlJobsByPlatform, type CrawledJob } from '../crawlers';
import { decodeBossPrivateText } from '../salaryCodec';
import { isSupportedPlatform } from '../platformRegistry';
import { v4 as uuidv4 } from '../utils';

export interface CrawlAndStoreInput {
  platform: string;
  query: string;
  city?: string;
  pages?: number;
}

export interface CrawlAndStoreResult {
  success: boolean;
  platform: string;
  query: string;
  city: string;
  total: number;
  inserted: number;
  duplicated: number;
  jobIds: string[];
  error?: string;
  needLogin?: boolean;
}

export interface SearchJobsInput {
  keyword?: string;
  city?: string;
  platform?: string;
  minSalaryK?: number;
  onlyUnclicked?: boolean;
  salaryStatus?: 'all' | 'present' | 'missing';
  limit?: number;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function decodeJob(record: any) {
  return {
    ...record,
    title: decodeBossPrivateText(record.title),
    company_name: decodeBossPrivateText(record.company_name),
    salary: decodeBossPrivateText(record.salary),
    location: decodeBossPrivateText(record.location),
    experience: decodeBossPrivateText(record.experience),
    education: decodeBossPrivateText(record.education),
    company_size: decodeBossPrivateText(record.company_size),
    company_industry: decodeBossPrivateText(record.company_industry),
    tags: decodeBossPrivateText(record.tags),
  };
}

export function toAgentJobCard(job: any) {
  return {
    id: job.id,
    platform: job.platform,
    title: job.title,
    company: job.company_name || '公司信息缺失',
    salary: job.salary || '薪资缺失',
    location: job.location || '地点未知',
    experience: job.experience || '',
    education: job.education || '',
    companySize: job.company_size || '',
    industry: job.company_industry || '',
    url: job.job_url,
    clicked: Boolean(job.clicked),
    crawledAt: job.crawled_at,
  };
}

export function getMonthlySalaryFloorK(salary: string | null | undefined): number | null {
  const text = String(salary || '').replace(/\s+/g, '').toUpperCase();
  if (!text || /面议|见详情|薪资缺失/.test(text)) return null;

  const kMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?K/);
  if (kMatch) return Number(kMatch[1]);

  const dailyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?元\/天/);
  if (dailyMatch) return Number(dailyMatch[1]) * 21.75 / 1000;

  const monthlyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?元\/月/);
  if (monthlyMatch) return Number(monthlyMatch[1]) / 1000;

  const yearlyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?万\/年/);
  if (yearlyMatch) return Number(yearlyMatch[1]) * 10 / 12;

  return null;
}

export async function crawlAndStoreJobs(input: CrawlAndStoreInput): Promise<CrawlAndStoreResult> {
  const platform = cleanText(input.platform, 20) || 'boss';
  const query = cleanText(input.query, 80);
  const city = cleanText(input.city, 20) || '全国';
  const pages = clampInteger(input.pages, 1, 1, 5);

  if (!query) throw new Error('请提供搜索关键词');
  if (!isSupportedPlatform(platform)) throw new Error(`平台 ${platform} 暂不支持`);

  const result: { jobs: CrawledJob[]; error?: string; needLogin?: boolean } =
    await crawlJobsByPlatform(platform, query, city, pages);

  if (result.needLogin) {
    return {
      success: false,
      platform,
      query,
      city,
      total: 0,
      inserted: 0,
      duplicated: 0,
      jobIds: [],
      error: result.error,
      needLogin: true,
    };
  }

  let inserted = 0;
  let duplicated = 0;
  const findExistingJob = db.prepare('SELECT id FROM jobs WHERE job_hash = ?');
  const insertJob = db.prepare(`
    INSERT INTO jobs (id, platform, job_id, title, company_name, salary, location, experience, education, company_size, company_industry, job_url, tags, job_hash, crawled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(job_hash) DO UPDATE SET
      title = COALESCE(NULLIF(excluded.title, ''), jobs.title),
      company_name = COALESCE(NULLIF(excluded.company_name, ''), jobs.company_name),
      salary = COALESCE(NULLIF(excluded.salary, ''), jobs.salary),
      location = COALESCE(NULLIF(excluded.location, ''), jobs.location),
      experience = COALESCE(NULLIF(excluded.experience, ''), jobs.experience),
      education = COALESCE(NULLIF(excluded.education, ''), jobs.education),
      company_size = COALESCE(NULLIF(excluded.company_size, ''), jobs.company_size),
      company_industry = COALESCE(NULLIF(excluded.company_industry, ''), jobs.company_industry),
      job_url = COALESCE(NULLIF(excluded.job_url, ''), jobs.job_url),
      tags = COALESCE(NULLIF(excluded.tags, '[]'), jobs.tags),
      crawled_at = excluded.crawled_at
  `);

  const persist = db.transaction((jobs: CrawledJob[]) => {
    for (const job of jobs) {
      const hash = crypto.createHash('md5').update(`${job.platform}:${job.job_id}`).digest('hex');
      const existed = Boolean(findExistingJob.get(hash));
      insertJob.run(
        uuidv4(), job.platform, job.job_id, job.title, job.company_name,
        job.salary, job.location, job.experience, job.education,
        job.company_size, job.company_industry, job.job_url,
        JSON.stringify(job.tags), hash,
      );
      if (existed) duplicated += 1;
      else inserted += 1;
    }
  });
  persist(result.jobs);

  return {
    success: true,
    platform,
    query,
    city,
    total: result.jobs.length,
    inserted,
    duplicated,
    jobIds: [...new Set(result.jobs.map((job) => job.job_id).filter(Boolean))],
    error: result.error,
  };
}

export function getJobsByPlatformJobIds(platform: string, jobIds: string[], userId = 'u001') {
  const ids = [...new Set(jobIds.filter(Boolean))].slice(0, 30);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(`
    SELECT j.*,
      EXISTS(SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?) AS clicked
    FROM jobs j
    WHERE j.platform = ? AND j.job_id IN (${placeholders})
    ORDER BY j.crawled_at DESC
  `).all(userId, platform, ...ids).map(decodeJob);
}

export function searchJobs(input: SearchJobsInput, userId = 'u001') {
  const keyword = cleanText(input.keyword, 80);
  const city = cleanText(input.city, 20);
  const platform = cleanText(input.platform, 20);
  const salaryStatus = input.salaryStatus || 'all';
  const limit = clampInteger(input.limit, 12, 1, 30);
  const candidateLimit = input.minSalaryK ? Math.max(limit * 8, 120) : limit;

  let where = 'WHERE j.status = ?';
  const params: unknown[] = ['active'];

  if (platform && platform !== 'all') {
    where += ' AND j.platform = ?';
    params.push(platform);
  }
  if (keyword) {
    where += ' AND (j.title LIKE ? OR j.company_name LIKE ? OR j.tags LIKE ?)';
    const pattern = `%${keyword}%`;
    params.push(pattern, pattern, pattern);
  }
  if (city && city !== 'all' && city !== '全国') {
    where += ' AND j.location LIKE ?';
    params.push(`%${city}%`);
  }
  if (salaryStatus === 'present') {
    where += " AND TRIM(COALESCE(j.salary, '')) NOT IN ('', '·', '薪资见详情')";
  } else if (salaryStatus === 'missing') {
    where += " AND TRIM(COALESCE(j.salary, '')) IN ('', '·', '薪资见详情')";
  }
  if (input.onlyUnclicked) {
    where += ' AND NOT EXISTS (SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?)';
    params.push(userId);
  }

  const records = db.prepare(`
    SELECT j.*,
      EXISTS(SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?) AS clicked
    FROM jobs j
    ${where}
    ORDER BY j.crawled_at DESC
    LIMIT ?
  `).all(userId, ...params, candidateLimit).map(decodeJob);

  const minSalaryK = Number(input.minSalaryK || 0);
  const filtered = minSalaryK > 0
    ? records.filter((job: any) => {
        const floor = getMonthlySalaryFloorK(job.salary);
        return floor !== null && floor >= minSalaryK;
      })
    : records;

  return filtered.slice(0, limit);
}

export function getJobById(id: string, userId = 'u001') {
  const record = db.prepare(`
    SELECT j.*,
      EXISTS(SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?) AS clicked
    FROM jobs j WHERE j.id = ?
  `).get(userId, id);
  return record ? decodeJob(record) : null;
}

export function getJobLibraryStatistics(userId = 'u001') {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(salary, '')) IN ('', '·', '薪资见详情') THEN 1 ELSE 0 END) AS salaryMissing,
      SUM(CASE WHEN TRIM(COALESCE(company_name, '')) = '' THEN 1 ELSE 0 END) AS companyMissing,
      SUM(CASE WHEN date(crawled_at) = date('now') THEN 1 ELSE 0 END) AS today
    FROM jobs
  `).get() as any;
  const clicked = (db.prepare(
    'SELECT COUNT(DISTINCT job_id) AS count FROM job_clicks WHERE user_id = ?'
  ).get(userId) as any).count;
  const platforms = db.prepare(
    'SELECT platform, COUNT(*) AS count FROM jobs GROUP BY platform ORDER BY count DESC'
  ).all();

  return {
    total: totals.total || 0,
    today: totals.today || 0,
    clicked: clicked || 0,
    unclicked: Math.max(0, (totals.total || 0) - (clicked || 0)),
    salaryMissing: totals.salaryMissing || 0,
    companyMissing: totals.companyMissing || 0,
    platforms,
  };
}
