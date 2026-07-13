import { closeBrowser, ensureBrowser, ensureBrowserWithLogin, evaluateOnPlatformTab, hasLoginState, navigatePlatformTab } from './browser';
import type { CrawledJob } from './boss';
import type { PlatformName } from '../platformRegistry';

type SupportedCrawlerPlatform = Exclude<PlatformName, 'boss'>;

interface FieldSelectors {
  card: string[];
  title: string[];
  company: string[];
  salary: string[];
  location: string[];
  experience: string[];
  education: string[];
  companySize: string[];
  industry: string[];
  tags: string[];
  link: string[];
}

interface StandardCrawlerConfig {
  platform: SupportedCrawlerPlatform;
  label: string;
  baseUrl: string;
  homeUrl: string;
  buildSearchUrl: (query: string, city: string, page: number) => string;
  selectors: FieldSelectors;
  linkIncludes: string[];
  challengeKeywords: string[];
}

const ZHILIAN_CITY_CODES: Record<string, string> = {
  全国: '',
  北京: '北京',
  上海: '上海',
  广州: '广州',
  深圳: '深圳',
  杭州: '杭州',
  成都: '成都',
  南京: '南京',
  武汉: '武汉',
  西安: '西安',
  苏州: '苏州',
  厦门: '厦门',
  长沙: '长沙',
  重庆: '重庆',
};

const JOB51_CITY_CODES: Record<string, string> = {
  全国: '000000',
  北京: '010000',
  上海: '020000',
  广州: '030200',
  深圳: '040000',
  杭州: '080200',
  成都: '090200',
  南京: '070200',
  武汉: '180200',
  西安: '200200',
  苏州: '070300',
  厦门: '060200',
  长沙: '190200',
  重庆: '060000',
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJobId(platform: SupportedCrawlerPlatform, url: string): string {
  const patterns: Record<SupportedCrawlerPlatform, RegExp[]> = {
    zhilian: [
      /jobs\.zhaopin\.com\/([^/?#]+)\.htm/i,
      /positionId=([^&]+)/i,
      /jobNumber=([^&]+)/i,
    ],
    '51job': [
      /\/job\/([^/?#]+)\.html/i,
      /jobid=([^&]+)/i,
      /\/([^/?#]+)\.html/i,
    ],
    shixiseng: [
      /\/intern\/(inn_[^/?#]+)/i,
    ],
  };

  for (const pattern of patterns[platform]) {
    const match = url.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return url;
}

function parseJobCardsScript(config: StandardCrawlerConfig): string {
  const scriptConfig = {
    platform: config.platform,
    baseUrl: config.baseUrl,
    selectors: config.selectors,
    linkIncludes: config.linkIncludes,
  };

  return `
(() => {
  const config = ${JSON.stringify(scriptConfig)};
  const jobs = [];
  const normalizeText = (value) => String(value || '')
    .replace(/\\u00a0/g, ' ')
    .replace(/\\s{2,}/g, ' ')
    .trim();
  const compactText = (value) => normalizeText(value).replace(/\\s+/g, '');
  const readAttrText = (node) => {
    if (!node) return '';
    const attrs = ['title', 'aria-label', 'data-salary', 'data-value', 'data-text', 'data-content'];
    for (const attr of attrs) {
      const value = node.getAttribute?.(attr);
      if (value && String(value).trim()) return String(value).trim();
    }
    return '';
  };
  const pickElement = (root, selectors) => {
    for (const selector of selectors || []) {
      try {
        if (root.matches?.(selector)) return root;
        const node = root.querySelector(selector);
        if (node) return node;
      } catch {}
    }
    return null;
  };
  const pickText = (root, selectors) => {
    const node = pickElement(root, selectors);
    return normalizeText(readAttrText(node) || node?.textContent || '');
  };
  const absolutizeUrl = (url) => {
    if (!url) return '';
    try {
      return new URL(url, config.baseUrl).toString();
    } catch {
      return url;
    }
  };
  const isJobLink = (url) => {
    const text = String(url || '');
    if (config.platform === '51job') {
      try {
        const parsed = new URL(text, config.baseUrl);
        return /\\/\\d+\\.html$/i.test(parsed.pathname) && !/\\/co[^/]*\\.html$/i.test(parsed.pathname);
      } catch {
        return false;
      }
    }
    return config.linkIncludes.some((part) => text.includes(part));
  };
  const findLink = (root) => {
    if (root.matches?.('a[href]') && isJobLink(root.href)) return root;
    const explicit = pickElement(root, config.selectors.link);
    if (explicit?.href && isJobLink(explicit.href)) return explicit;
    const links = Array.from(root.querySelectorAll('a[href]'));
    return links.find((link) => isJobLink(link.href)) || null;
  };
  const read51JobSensorData = (root) => {
    if (config.platform !== '51job') return {};
    const node = root.querySelector('[sensorsdata*="jobId"]');
    const raw = node?.getAttribute?.('sensorsdata');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  };
  const extractSalary = (value) => {
    const text = compactText(value);
    const patterns = [
      /\\d+(?:\\.\\d+)?[-~－]\\d+(?:\\.\\d+)?(?:K|k|千|万|元\\/天|元\\/月|元\\/小时)(?:·\\d+薪)?/,
      /\\d+(?:\\.\\d+)?(?:K|k|千|万|元\\/天|元\\/月|元\\/小时)(?:·\\d+薪)?/,
      /\\d+[-~－]\\d+元\\/天/,
      /\\d+[-~－]\\d+元\\/月/,
      /\\d+[-~－]\\d+万\\/年/,
      /面议|薪资面议/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return '';
  };
  const parseTags = (root) => {
    const nodes = [];
    for (const selector of config.selectors.tags || []) {
      try { nodes.push(...Array.from(root.querySelectorAll(selector))); } catch {}
    }
    return Array.from(new Set(nodes.map((node) => normalizeText(node.textContent)).filter(Boolean))).slice(0, 12);
  };
  const isUsefulCard = (card) => {
    const text = normalizeText(card.textContent);
    return text.length >= 8 && text.length <= 1500;
  };

  let cards = [];
  for (const selector of config.selectors.card) {
    try {
      const matches = Array.from(document.querySelectorAll(selector));
      if (matches.length > 0) {
        cards = matches;
        break;
      }
    } catch {}
  }
  if (cards.length === 0) {
    cards = Array.from(document.querySelectorAll('a[href]'))
      .filter((link) => isJobLink(link.href))
      .map((link) => link.closest('li, article, div[class*="item"], div[class*="card"], div[class*="job"], div') || link);
  }
  cards = Array.from(new Set(cards)).filter(isUsefulCard);

  for (const card of cards) {
    const sensorData = read51JobSensorData(card);
    const linkEl = findLink(card);
    const sensorJobId = normalizeText(sensorData.jobId);
    const sensorJobUrl = sensorJobId ? 'https://jobs.51job.com/all/' + encodeURIComponent(sensorJobId) + '.html' : '';
    const jobUrl = absolutizeUrl(linkEl?.href || sensorJobUrl);
    const title = normalizeText(sensorData.jobTitle)
      || pickText(card, config.selectors.title)
      || normalizeText(readAttrText(linkEl) || linkEl?.textContent);
    if (!title || !jobUrl || title.length > 120) continue;

    const tags = parseTags(card);
    const salary = normalizeText(sensorData.jobSalary)
      || pickText(card, config.selectors.salary)
      || extractSalary(card.textContent);
    const location = normalizeText(sensorData.jobArea) || pickText(card, config.selectors.location);
    const experience = normalizeText(sensorData.jobYear)
      || pickText(card, config.selectors.experience)
      || tags.find((tag) => /经验|应届|在校|年|不限/.test(tag))
      || '';
    const education = normalizeText(sensorData.jobDegree)
      || pickText(card, config.selectors.education)
      || tags.find((tag) => /学历|本科|硕士|博士|大专|高中|不限/.test(tag))
      || '';
    const companySize = pickText(card, config.selectors.companySize) || tags.find((tag) => /人$|少于|以上|公司规模/.test(tag)) || '';
    const industry = pickText(card, config.selectors.industry);
    let companyName = pickText(card, config.selectors.company);
    if (companyName === title || /经验|学历|薪|K|元\\//.test(companyName)) companyName = '';

    jobs.push({
      platform: config.platform,
      job_id: '',
      title,
      company_name: companyName,
      salary,
      location,
      experience,
      education,
      company_size: companySize,
      company_industry: industry,
      job_url: jobUrl,
      tags,
    });
  }

  return jobs;
})()
  `;
}

function parseShixisengJobsScript(config: StandardCrawlerConfig): string {
  return `
(async () => {
  const platform = ${JSON.stringify(config.platform)};
  const normalizeText = (value) => String(value || '')
    .replace(/\\u00a0/g, ' ')
    .replace(/\\s{2,}/g, ' ')
    .trim();
  const pickText = (root, selector) => normalizeText(root.querySelector(selector)?.textContent || '');
  const links = Array.from(new Set(
    Array.from(document.querySelectorAll('a[href*="/intern/"]'))
      .map((link) => link.href)
      .filter((href) => /\\/intern\\/inn_[^/?#]+/i.test(href))
  )).slice(0, 30);

  const parseDetail = async (href) => {
    try {
      const response = await fetch(href, { credentials: 'include' });
      if (!response.ok) return null;
      const html = await response.text();
      const detail = new DOMParser().parseFromString(html, 'text/html');
      const title = pickText(detail, '.new_job_name');
      const company = pickText(detail, '.com-name');
      const salary = pickText(detail, '.job_money');
      const location = pickText(detail, '.job_position');
      const education = pickText(detail, '.job_academic');
      const schedule = Array.from(detail.querySelectorAll('.job_week, .job_time'))
        .map((node) => normalizeText(node.textContent))
        .filter(Boolean)
        .join(' · ');
      let tags = Array.from(detail.querySelectorAll('.job_good_list span, .job_good_list li'))
        .map((node) => normalizeText(node.textContent))
        .filter(Boolean);
      if (tags.length === 0) {
        const tagText = pickText(detail, '.job_good_list');
        if (tagText) tags = [tagText];
      }
      const canonicalUrl = (() => {
        try {
          const url = new URL(href);
          return url.origin + url.pathname;
        } catch {
          return href;
        }
      })();

      if (!title || !company || !canonicalUrl) return null;
      return {
        platform,
        job_id: '',
        title,
        company_name: company,
        salary,
        location,
        experience: schedule,
        education,
        company_size: '',
        company_industry: '',
        job_url: canonicalUrl,
        tags: Array.from(new Set(tags)).slice(0, 12),
      };
    } catch {
      return null;
    }
  };

  const jobs = [];
  for (let index = 0; index < links.length; index += 5) {
    const batch = await Promise.all(links.slice(index, index + 5).map(parseDetail));
    jobs.push(...batch.filter(Boolean));
  }
  return jobs;
})()
  `;
}

const CRAWLER_CONFIGS: Record<SupportedCrawlerPlatform, StandardCrawlerConfig> = {
  zhilian: {
    platform: 'zhilian',
    label: '智联招聘',
    baseUrl: 'https://www.zhaopin.com',
    homeUrl: 'https://www.zhaopin.com',
    buildSearchUrl: (query, city, page) => {
      const url = new URL('https://sou.zhaopin.com/');
      url.searchParams.set('kw', query);
      const cityCode = ZHILIAN_CITY_CODES[city] ?? city;
      if (cityCode) url.searchParams.set('jl', cityCode);
      if (page > 1) url.searchParams.set('p', String(page));
      return url.toString();
    },
    linkIncludes: ['jobs.zhaopin.com', '/jobdetail/', 'positionId=', 'jobNumber='],
    challengeKeywords: ['安全验证', '访问验证', '验证码', '滑动验证', '登录后查看'],
    selectors: {
      card: ['.joblist-box__item', '.job-card', '[class*="joblist"] [class*="item"]', '[class*="position"] [class*="item"]', 'a[href*="jobs.zhaopin.com"]'],
      title: ['.jobinfo__name', '[class*="jobinfo"] [class*="name"]', '.job-name', '[class*="job-name"]', '[class*="jobTitle"]', 'a[href*="jobs.zhaopin.com"]'],
      company: ['.companyinfo__name', '[class*="companyinfo"] [class*="name"]', '.company-name', '[class*="company-name"]', '[class*="company"] a'],
      salary: ['.jobinfo__salary', '[class*="salary"]', '.salary'],
      location: ['.jobinfo__other-info-item', '[class*="location"]', '[class*="area"]'],
      experience: ['[class*="experience"]', '[class*="workYear"]'],
      education: ['[class*="education"]', '[class*="degree"]'],
      companySize: ['[class*="company"] [class*="size"]', '[class*="scale"]'],
      industry: ['[class*="industry"]', '[class*="company"] [class*="type"]'],
      tags: ['.jobinfo__tag', '[class*="tag"]', '[class*="label"]'],
      link: ['a[href*="jobs.zhaopin.com"]', 'a[href*="/jobdetail/"]', 'a[href*="positionId="]'],
    },
  },
  '51job': {
    platform: '51job',
    label: '前程无忧',
    baseUrl: 'https://we.51job.com',
    homeUrl: 'https://we.51job.com',
    buildSearchUrl: (query, city, page) => {
      const url = new URL('https://we.51job.com/pc/search');
      url.searchParams.set('keyword', query);
      url.searchParams.set('jobArea', JOB51_CITY_CODES[city] || JOB51_CITY_CODES['全国']);
      url.searchParams.set('searchType', '2');
      url.searchParams.set('sortType', '0');
      url.searchParams.set('pageNum', String(page));
      return url.toString();
    },
    linkIncludes: ['jobs.51job.com', '/job/', 'jobid='],
    challengeKeywords: ['安全验证', '访问验证', '验证码', '滑动验证', '登录后查看'],
    selectors: {
      card: ['.joblist-item', '.job-item', '.j_joblist .e', '.e', '[class*="joblist"] [class*="item"]', 'a[href*="jobs.51job.com"]'],
      title: ['.job-name', '.jname', '.job-title', '[class*="job-title"]', '[class*="jname"]'],
      company: ['.company', '.cname', '.company-name', '[class*="company-name"]', '[class*="cname"]'],
      salary: ['.sal', '.salary', '[class*="salary"]', '[class*="sal"]'],
      location: ['.area', '[class*="area"]', '[class*="location"]', '.d'],
      experience: ['[class*="experience"]', '[class*="workyear"]'],
      education: ['[class*="degree"]', '[class*="education"]'],
      companySize: ['[class*="company"] [class*="size"]', '[class*="scale"]'],
      industry: ['[class*="industry"]', '[class*="company"] [class*="type"]'],
      tags: ['[class*="tag"]', '[class*="label"]'],
      link: ['a[href*="jobs.51job.com"]', 'a[href*="/job/"]', 'a[href*="jobid="]'],
    },
  },
  shixiseng: {
    platform: 'shixiseng',
    label: '实习僧',
    baseUrl: 'https://www.shixiseng.com',
    homeUrl: 'https://www.shixiseng.com/interns/',
    buildSearchUrl: (query, city, page) => {
      const url = new URL('https://www.shixiseng.com/interns/');
      url.searchParams.set('keyword', query);
      url.searchParams.set('p', String(page));
      if (city && city !== '全国') url.searchParams.set('city', city);
      return url.toString();
    },
    linkIncludes: ['shixiseng.com/intern/inn_'],
    challengeKeywords: ['安全验证', '访问验证', '验证码', '滑动验证', '登录后查看'],
    selectors: {
      card: ['a[href*="/intern/inn_"]'],
      title: ['.new_job_name'],
      company: ['.com-name'],
      salary: ['.job_money'],
      location: ['.job_position'],
      experience: ['.job_week', '.job_time'],
      education: ['.job_academic'],
      companySize: [],
      industry: [],
      tags: ['.job_good_list span'],
      link: ['a[href*="/intern/inn_"]'],
    },
  },
};

export async function crawlStandardPlatform(
  platform: SupportedCrawlerPlatform,
  query: string,
  city = '全国',
  maxPages = 1
): Promise<{ jobs: CrawledJob[]; error?: string; needLogin?: boolean }> {
  const config = CRAWLER_CONFIGS[platform];
  if (platform !== 'shixiseng' && !hasLoginState(platform)) {
    return { jobs: [], needLogin: true, error: `${config.label} 未登录，请先在平台管理页面完成浏览器登录` };
  }

  try {
    const allJobs: CrawledJob[] = [];
    if (platform === 'shixiseng') {
      await ensureBrowser(platform, config.homeUrl);
    } else {
      await ensureBrowserWithLogin(platform, config.homeUrl);
    }

    for (let page = 1; page <= maxPages; page++) {
      const url = config.buildSearchUrl(query, city, page);
      console.log(`🔍 [${config.label}] 抓取第 ${page} 页: ${url}`);

      await navigatePlatformTab(platform, url, 60000);
      await sleep(3500 + Math.random() * 2500);

      const currentUrl = String(await evaluateOnPlatformTab(platform, 'window.location.href', 10000) || '');
      if (!currentUrl || currentUrl === 'about:blank') {
        return {
          jobs: allJobs,
          error: `${config.label} 页面跳转到空白页，请在浏览器中手动打开该平台并完成必要验证后重试。`,
        };
      }

      const bodyText = String(await evaluateOnPlatformTab(platform, 'document.body ? (document.body.innerText || "") : ""', 10000) || '');
      if (config.challengeKeywords.some((keyword) => bodyText.includes(keyword))) {
        return {
          jobs: allJobs,
          error: `${config.label} 触发安全验证，请在弹出的 Chrome 中手动完成验证后再抓取。`,
        };
      }

      let hasCards = false;
      const waitExpression = `
        ${JSON.stringify(config.selectors.card)}.some((selector) => {
          try { return document.querySelector(selector) !== null; } catch { return false; }
        })
      `;
      for (let attempt = 0; attempt < 8; attempt++) {
        hasCards = Boolean(await evaluateOnPlatformTab(platform, waitExpression, 10000));
        if (hasCards) break;
        await sleep(1500);
      }
      if (!hasCards) {
        console.log(`⚠️ [${config.label}] 第 ${page} 页未找到职位卡片`);
        break;
      }

      const parserScript = platform === 'shixiseng'
        ? parseShixisengJobsScript(config)
        : parseJobCardsScript(config);
      const parsedJobs = await evaluateOnPlatformTab(platform, parserScript, 60000);
      const jobs = (Array.isArray(parsedJobs) ? parsedJobs as CrawledJob[] : [])
        .filter((job) => platform !== 'shixiseng' || !city || city === '全国' || job.location.includes(city));
      console.log(`📊 [${config.label}] 第 ${page} 页解析到 ${jobs.length} 个职位`);

      for (const job of jobs) {
        job.platform = platform;
        job.job_id = extractJobId(platform, job.job_url);
        allJobs.push(job);
      }

      if (jobs.length === 0) break;
      if (page < maxPages) await sleep(4500 + Math.random() * 3000);
    }

    return { jobs: allJobs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ [${config.label}] 抓取失败:`, msg);
    return { jobs: [], error: `抓取失败: ${msg}` };
  } finally {
    await closeBrowser(platform);
  }
}

export function crawlZhilian(query: string, city?: string, maxPages?: number) {
  return crawlStandardPlatform('zhilian', query, city, maxPages);
}

export function crawl51Job(query: string, city?: string, maxPages?: number) {
  return crawlStandardPlatform('51job', query, city, maxPages);
}

export function crawlShixiseng(query: string, city?: string, maxPages?: number) {
  return crawlStandardPlatform('shixiseng', query, city, maxPages);
}
