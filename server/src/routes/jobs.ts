import { Router } from 'express';
import crypto from 'crypto';
import db from '../database';
import { v4 as uuidv4 } from '../utils';
import { crawlBoss, type CrawledJob } from '../crawlers/boss';
import { loginInteractive, hasLoginState } from '../crawlers/browser';
import { decodeBossPrivateText } from '../salaryCodec';

const router = Router();
const DEMO_USER_ID = 'u001';

function toIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeText(value: unknown, maxLength = 80): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

// 触发抓取职位
router.post('/jobs/crawl', async (req, res) => {
  const platform = normalizeText(req.body.platform, 20) || 'boss';
  const query = normalizeText(req.body.query, 80);
  const city = normalizeText(req.body.city, 20) || '全国';
  const pages = toIntInRange(req.body.pages, 2, 1, 5);

  if (!query) return res.status(400).json({ error: '请提供搜索关键词' });

  try {
    let result: { jobs: CrawledJob[]; error?: string; needLogin?: boolean };

    if (platform === 'boss') {
      result = await crawlBoss(query, city, pages);
    } else {
      return res.status(400).json({ error: `平台 ${platform} 暂不支持` });
    }

    if (result.needLogin) {
      return res.status(403).json({ error: result.error, needLogin: true });
    }

    // 去重写入数据库；重复职位也刷新字段，便于修复历史解析不完整的数据。
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

    for (const job of result.jobs) {
      const id = uuidv4();
      const hash = crypto.createHash('md5').update(`${job.platform}:${job.job_id}`).digest('hex');
      const existed = Boolean(findExistingJob.get(hash));
      const info = insertJob.run(
        id, job.platform, job.job_id, job.title, job.company_name,
        job.salary, job.location, job.experience, job.education,
        job.company_size, job.company_industry, job.job_url,
        JSON.stringify(job.tags), hash
      );
      if (info.changes > 0 && !existed) {
        inserted++;
      } else {
        duplicated++;
      }
    }

    res.json({
      success: true,
      platform,
      query,
      city,
      total: result.jobs.length,
      inserted,
      duplicated,
      error: result.error,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `抓取异常: ${msg}` });
  }
});

// 获取职位列表（分页+筛选）
router.get('/jobs', (req, res) => {
  const page = toIntInRange(req.query.page, 1, 1, 100000);
  const size = toIntInRange(req.query.size, 20, 1, 100);
  const platform = normalizeText(req.query.platform, 20);
  const keyword = normalizeText(req.query.keyword, 80);
  const city = normalizeText(req.query.city, 20);
  const salaryStatus = normalizeText(req.query.salaryStatus, 20);
  const companyStatus = normalizeText(req.query.companyStatus, 20);
  const clickStatus = normalizeText(req.query.clickStatus, 20);
  const onlyUnclicked = req.query.unclicked === '1';

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (platform && platform !== 'all') {
    where += ' AND j.platform = ?';
    params.push(platform);
  }
  if (keyword) {
    where += ' AND (j.title LIKE ? OR j.company_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (city && city !== 'all') {
    where += ' AND j.location LIKE ?';
    params.push(`%${city}%`);
  }
  if (salaryStatus === 'present') {
    where += " AND TRIM(COALESCE(j.salary, '')) NOT IN ('', '·', '薪资见详情')";
  } else if (salaryStatus === 'missing') {
    where += " AND TRIM(COALESCE(j.salary, '')) IN ('', '·', '薪资见详情')";
  }
  if (companyStatus === 'present') {
    where += " AND TRIM(COALESCE(j.company_name, '')) <> ''";
  } else if (companyStatus === 'missing') {
    where += " AND TRIM(COALESCE(j.company_name, '')) = ''";
  }
  if (clickStatus === 'clicked') {
    where += ' AND EXISTS (SELECT 1 FROM job_clicks WHERE job_id = j.id AND user_id = ?)';
    params.push(DEMO_USER_ID);
  } else if (clickStatus === 'unclicked' || onlyUnclicked) {
    where += ' AND NOT EXISTS (SELECT 1 FROM job_clicks WHERE job_id = j.id AND user_id = ?)';
    params.push(DEMO_USER_ID);
  }

  const total = (db.prepare(
    `SELECT COUNT(*) as count FROM jobs j ${where}`
  ).get(...params) as any).count;

  const offset = (page - 1) * size;
  const records = db.prepare(
    `SELECT j.*, 
       (SELECT COUNT(*) FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?) as clicked
     FROM jobs j ${where} 
     ORDER BY j.crawled_at DESC LIMIT ? OFFSET ?`
  ).all(DEMO_USER_ID, ...params, size, offset).map((record: any) => ({
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
  }));

  res.json({ total, page, size, records });
});

// 记录点击跳转
router.post('/jobs/:id/click', (req, res) => {
  const { id } = req.params;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
  if (!job) return res.status(404).json({ error: '职位不存在' });

  // 检查是否已点击过
  const existing = db.prepare(
    'SELECT id FROM job_clicks WHERE job_id = ? AND user_id = ?'
  ).get(id, DEMO_USER_ID);

  if (!existing) {
    db.prepare(
      'INSERT INTO job_clicks (id, user_id, job_id, platform, company_name, position_name, salary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), DEMO_USER_ID, id, job.platform, job.company_name, job.title, job.salary);
  }

  res.json({ success: true, url: job.job_url, alreadyClicked: !!existing });
});

// 职位统计
router.get('/jobs/statistics', (_req, res) => {
  const totalJobs = (db.prepare('SELECT COUNT(*) as c FROM jobs').get() as any).c;
  const totalClicks = (db.prepare('SELECT COUNT(*) as c FROM job_clicks WHERE user_id = ?').get(DEMO_USER_ID) as any).c;
  const todayJobs = (db.prepare(
    "SELECT COUNT(*) as c FROM jobs WHERE date(crawled_at) = date('now')"
  ).get() as any).c;
  const todayClicks = (db.prepare(
    "SELECT COUNT(*) as c FROM job_clicks WHERE user_id = ? AND date(clicked_at) = date('now')"
  ).get(DEMO_USER_ID) as any).c;

  const platformDistribution = db.prepare(
    'SELECT platform, COUNT(*) as count FROM jobs GROUP BY platform'
  ).all();

  const clickTrend = db.prepare(`
    SELECT date(clicked_at) as date, COUNT(*) as count
    FROM job_clicks WHERE user_id = ?
    GROUP BY date(clicked_at) ORDER BY date(clicked_at) DESC LIMIT 7
  `).all(DEMO_USER_ID);

  const crawlTrend = db.prepare(`
    SELECT date(crawled_at) as date, COUNT(*) as count
    FROM jobs GROUP BY date(crawled_at) ORDER BY date(crawled_at) DESC LIMIT 7
  `).all();

  res.json({
    totalJobs, totalClicks, todayJobs, todayClicks,
    platformDistribution, clickTrend, crawlTrend,
  });
});

router.get('/jobs/library-summary', (_req, res) => {
  const totalJobs = (db.prepare('SELECT COUNT(*) as c FROM jobs').get() as any).c;
  const salaryMissing = (db.prepare(
    "SELECT COUNT(*) as c FROM jobs WHERE TRIM(COALESCE(salary, '')) IN ('', '·', '薪资见详情')"
  ).get() as any).c;
  const companyMissing = (db.prepare(
    "SELECT COUNT(*) as c FROM jobs WHERE TRIM(COALESCE(company_name, '')) = ''"
  ).get() as any).c;
  const clicked = (db.prepare(
    'SELECT COUNT(DISTINCT job_id) as c FROM job_clicks WHERE user_id = ?'
  ).get(DEMO_USER_ID) as any).c;

  res.json({
    totalJobs,
    salaryPresent: totalJobs - salaryMissing,
    salaryMissing,
    companyPresent: totalJobs - companyMissing,
    companyMissing,
    clicked,
    unclicked: totalJobs - clicked,
    databasePath: 'server/data/app.db',
  });
});

// BOSS 登录（启动可见浏览器）
router.post('/platforms/boss/login', async (_req, res) => {
  try {
    await loginInteractive({
      platform: 'boss',
      loginUrl: 'https://login.zhipin.com/',
      successUrlPattern: /zhipin\.com\/web\/geek\//,
      timeoutMs: 120000,
    });

    db.prepare(
      `UPDATE platform_accounts SET login_state = 'logged_in', status = 'active', last_login = datetime('now') WHERE user_id = ? AND platform_name = 'boss'`
    ).run(DEMO_USER_ID);

    res.json({ success: true, message: 'BOSS直聘登录成功' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `登录失败: ${msg}` });
  }
});

// 检查登录状态
router.get('/platforms/:name/login-status', (req, res) => {
  const { name } = req.params;
  const loggedIn = hasLoginState(name);
  res.json({ platform: name, loggedIn });
});

export default router;
