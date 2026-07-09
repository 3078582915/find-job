import { ensureBrowserWithLogin, closeBrowser, hasLoginState, navigateZhipinTab, evaluateOnZhipinTab } from './browser';
import { decodeBossPrivateText } from '../salaryCodec';

export interface CrawledJob {
  platform: string;
  job_id: string;
  title: string;
  company_name: string;
  salary: string;
  location: string;
  experience: string;
  education: string;
  company_size: string;
  company_industry: string;
  job_url: string;
  tags: string[];
}

export const BOSS_CITY_CODES: Record<string, string> = {
  全国: '100010000',
  北京: '101010100',
  上海: '101020100',
  广州: '101280100',
  深圳: '101280600',
  杭州: '101210100',
  成都: '101270100',
  南京: '101190100',
  武汉: '101200100',
  西安: '101110100',
  苏州: '101190400',
  厦门: '101230200',
  长沙: '101250100',
  重庆: '101040100',
};

const BOSS_BASE = 'https://www.zhipin.com';

function buildSearchUrl(query: string, cityCode: string, page: number) {
  const url = new URL(`${BOSS_BASE}/web/geek/job`);
  url.searchParams.set('query', query);
  url.searchParams.set('city', cityCode);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

function extractJobId(url: string): string {
  const match = url.match(/job_detail\/([^.]+)\.html/) || url.match(/jobId=([^&]+)/);
  return match ? match[1] : url;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseJobCardsScript(baseUrl: string): string {
  return `
(() => {
  const jobs = [];
  const unreadablePattern = /[\\uE000-\\uF8FF\\uFFFD□�]/;
  const unreadableSalaryPattern = /[\\uE000-\\uF8FF\\uFFFD□�]+(?:\\s*[-~－]\\s*[\\uE000-\\uF8FF\\uFFFD□�]+)?\\s*(?:K|元\\/天|元\\/月|薪)?/g;
  const cleanText = (value) => String(value || '')
    .replace(unreadableSalaryPattern, '')
    .replace(unreadablePattern, '')
    .replace(/\\s{2,}/g, ' ')
    .trim();
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
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const pickText = (root, selectors) => {
    const node = pickElement(root, selectors);
    return cleanText(readAttrText(node) || node?.textContent || '');
  };
  const inferCompanyName = (root, titleText, tags) => {
    const isBadCompanyCandidate = (text) => {
      const denyWords = ['经验', '本科', '大专', '硕士', '博士', '学历', '天/周', '个月', 'K', '元/天', '薪', '招聘者', 'HR', '在线'];
      return denyWords.some((word) => text.includes(word));
    };
    const explicit = pickText(root, [
      '.company-name',
      '.company-name a',
      '[class*="company-name"]',
      '[ka="company-name"]',
      '[class*="brand-name"]',
      '[class*="company"] [class*="name"]',
      '.company-info h3',
      '.company-info a',
      '.job-card-right a[href*="/gongsi/"]',
      '.job-card-right a[href*="/company/"]',
      '.job-card-right a[href*="/brand/"]',
      'a[href*="/gongsi/"]',
      'a[href*="/company/"]',
      'a[href*="/brand/"]',
    ]);
    if (explicit) return explicit;

    const tagSet = new Set(tags);
    const candidates = Array.from(root.querySelectorAll('a, h3, [class*="company"], [class*="brand"]'))
      .map((node) => cleanText(readAttrText(node) || node.textContent))
      .filter(Boolean)
      .filter((text) => text !== titleText)
      .filter((text) => !tagSet.has(text))
      .filter((text) => !isBadCompanyCandidate(text))
      .filter((text) => text.length >= 2 && text.length <= 40);

    return candidates[0] || '';
  };
  const hasReadableSalary = (value) => /\\d/.test(String(value || '')) && /(K|k|元|薪|面议)/.test(String(value || ''));
  const extractSalaryFromText = (value) => {
    const text = String(value || '').replace(/\\s+/g, '');
    const patterns = [
      /[\\uE030-\\uE039\\d]+[-~－][\\uE030-\\uE039\\d]+K(?:·[\\uE030-\\uE039\\d]+薪)?/i,
      /[\\uE030-\\uE039\\d]+K(?:·[\\uE030-\\uE039\\d]+薪)?/i,
      /[\\uE030-\\uE039\\d]+[-~－][\\uE030-\\uE039\\d]+元\\/天/,
      /[\\uE030-\\uE039\\d]+[-~－][\\uE030-\\uE039\\d]+元\\/月/,
      /薪资open/i,
      /面议/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return '';
  };
  const normalizeSalary = (value) => {
    const raw = String(value || '').trim();
    if (raw && /(K|k|元|薪|面议|open)/i.test(raw)) return raw;
    if (hasReadableSalary(raw)) return raw;
    const cleaned = cleanText(raw);
    return cleaned || raw;
  };
  const cards = document.querySelectorAll('li.job-card-box, .job-card-box, .job-card-wrapper, .search-job-result .job-card-wrapper');

  cards.forEach((card, index) => {
    const el = card;
    const titleEl = pickElement(el, [
      '.job-name',
      '.job-name a',
      '[class*="job-name"]',
      '[ka="job-name"]',
      '.job-title .name',
      '.job-title',
    ]);
    const salaryEl = pickElement(el, ['.salary', '.job-salary', '[class*="salary"]', '[ka="salary"]']);
    const areaEl = pickElement(el, ['.job-area', '[class*="job-area"]', '[ka="job-area"]', '.company-location', '[class*="location"]', '.job-title [class*="area"]']);
    const linkEl = pickElement(el, ['.job-card-left', 'a[href*="job_detail"]', 'a[href*="job-recommend"]']);
    const jobTagEls = el.querySelectorAll('.job-card-left .tag-list li, .job-info .tag-list li, .job-info .tag-list span, .job-detail span, .info-tags span, .job-tags span');
    const companyTagEls = el.querySelectorAll('.company-tag-list li, .company-info .tag-list li, .company-info li, .job-card-right .tag-list li, .job-card-right [class*="tag"] li, .job-card-right [class*="tag"] span');

    const jobTags = Array.from(jobTagEls).map((t) => cleanText(t.textContent)).filter(Boolean);
    const companyTags = Array.from(companyTagEls).map((t) => cleanText(t.textContent)).filter(Boolean);
    const tags = Array.from(new Set([...jobTags, ...companyTags]));
    const jobUrl = linkEl?.href || '';

    if (!titleEl || !jobUrl) return;

    if (index === 0 && salaryEl) {
      console.log('[DEBUG] salary outerHTML:', salaryEl.outerHTML);
      console.log('[DEBUG] salary textContent:', salaryEl.textContent);
      console.log('[DEBUG] salary innerText:', salaryEl.innerText);
    }

    const experience = jobTags.find(t => /经验|应届|在校|年以上|不限/.test(t)) || '';
    const education = jobTags.find(t => /学历|本科|硕士|博士|大专|高中|不限/.test(t)) || '';
    const company_size = companyTags.find(t => /人$/.test(t) || /少于/.test(t) || /以上/.test(t)) || '';
    const company_industry = companyTags.find(t => t !== company_size && !/融资|上市|未融资|轮/.test(t)) || '';

    const salaryCandidates = [
      readAttrText(salaryEl),
      salaryEl?.innerText,
      salaryEl?.textContent,
      el.textContent,
      readAttrText(el),
    ];
    let salary = '';
    for (const candidate of salaryCandidates) {
      salary = extractSalaryFromText(candidate);
      if (salary) break;
    }
    if (!salary) salary = readAttrText(salaryEl) || salaryEl?.innerText?.trim() || salaryEl?.textContent?.trim() || '';
    salary = normalizeSalary(salary);
    const title = cleanText(readAttrText(titleEl) || titleEl.textContent);
    const companyName = inferCompanyName(el, title, tags);

    jobs.push({
      platform: 'boss',
      job_id: '',
      title,
      company_name: companyName,
      salary,
      location: cleanText(readAttrText(areaEl) || areaEl?.textContent),
      experience: cleanText(experience),
      education: cleanText(education),
      company_size: cleanText(company_size),
      company_industry: cleanText(company_industry),
      job_url: jobUrl.startsWith('http') ? jobUrl : '${baseUrl}' + jobUrl,
      tags,
    });
  });

  return jobs;
})()
  `;
}

async function parseJobCardsCDP(): Promise<CrawledJob[]> {
  const jobs = await evaluateOnZhipinTab(parseJobCardsScript(BOSS_BASE), 30000);
  return Array.isArray(jobs) ? jobs : [];
}

export async function crawlBoss(
  query: string,
  city: string = '全国',
  maxPages: number = 2
): Promise<{ jobs: CrawledJob[]; error?: string; needLogin?: boolean }> {
  if (!hasLoginState('boss')) {
    return { jobs: [], needLogin: true, error: 'BOSS直聘未登录，请先在平台管理页面扫码登录' };
  }

  const cityCode = BOSS_CITY_CODES[city] || BOSS_CITY_CODES['全国'];

  // Ensure Chrome is running and the saved login cookies are available.
  await ensureBrowserWithLogin('boss');

  try {
    const allJobs: CrawledJob[] = [];

    for (let p = 1; p <= maxPages; p++) {
      const url = buildSearchUrl(query, cityCode, p);
      console.log(`🔍 [BOSS] 抓取第 ${p} 页: ${url}`);

      // Use raw CDP navigation so BOSS sees a normal Chrome tab, not Playwright control
      await navigateZhipinTab(url, 60000);
      await sleep(4000 + Math.random() * 3000);

      // Check current URL via CDP
      const currentUrl = await evaluateOnZhipinTab('window.location.href', 10000);
      console.log(`📍 当前页面 URL: ${currentUrl}`);
      if (currentUrl === 'about:blank' || !currentUrl || String(currentUrl).includes('blank')) {
        console.log(`⚠️ 第 ${p} 页被拦截跳转到空白页`);
        return {
          jobs: allJobs,
          error: 'BOSS直聘触发平台访问限制，页面被跳转到空白页。请暂停自动抓取，打开浏览器手动访问 BOSS直聘并完成必要验证，稍后改为 1 页重试。',
        };
      }

      // Check for security challenge
      const bodyText = await evaluateOnZhipinTab('document.body ? (document.body.innerText || "") : ""', 10000);
      if (bodyText.includes('安全验证') || bodyText.includes('验证码') || bodyText.includes('滑动') || bodyText.includes('访问验证')) {
        return {
          jobs: allJobs,
          error: 'BOSS直聘触发安全验证。请在浏览器中手动访问 BOSS直聘并完成验证，暂停一段时间后改为 1 页重试。',
        };
      }

      // Wait for job cards to render
      let hasCards = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        hasCards = await evaluateOnZhipinTab(
          'document.querySelector(".job-card-wrapper, li[class*=\'job-card\']") !== null',
          10000
        );
        if (hasCards) break;
        await sleep(1500);
      }
      if (!hasCards) {
        console.log(`⚠️ 第 ${p} 页未找到职位卡片`);
        break;
      }

      const jobs = await parseJobCardsCDP();
      console.log(`📊 第 ${p} 页解析到 ${jobs.length} 个职位`);

      for (const job of jobs) {
        job.job_id = extractJobId(job.job_url);
        job.title = decodeBossPrivateText(job.title);
        job.company_name = decodeBossPrivateText(job.company_name);
        job.salary = decodeBossPrivateText(job.salary);
        job.location = decodeBossPrivateText(job.location);
        job.experience = decodeBossPrivateText(job.experience);
        job.education = decodeBossPrivateText(job.education);
        job.company_size = decodeBossPrivateText(job.company_size);
        job.company_industry = decodeBossPrivateText(job.company_industry);
        job.tags = job.tags.map(decodeBossPrivateText);
        allJobs.push(job);
      }

      if (jobs.length === 0) break;
      if (p < maxPages) await sleep(6000 + Math.random() * 5000);
    }

    return { jobs: allJobs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ [BOSS] 抓取失败:`, msg);
    return { jobs: [], error: `抓取失败: ${msg}` };
  } finally {
    await closeBrowser('boss');
  }
}
