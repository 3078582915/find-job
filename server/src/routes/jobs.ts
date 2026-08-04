import { Router } from 'express';
import db from '../database';
import { v4 as uuidv4 } from '../utils';
import { loginInteractive, hasLoginState, validateLoginState } from '../crawlers/browser';
import { decodeBossPrivateText } from '../salaryCodec';
import { getPlatformConfig, isSupportedPlatform } from '../platformRegistry';
import { crawlAndStoreJobs } from '../services/jobService';

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

function normalizeIds(value: unknown, maxCount = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean)
  )].slice(0, maxCount);
}

const deleteJobsByIds = db.transaction((ids: string[]) => {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM job_clicks WHERE job_id IN (${placeholders})`).run(...ids);
  const result = db.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
});

// 触发抓取职位
router.post('/jobs/crawl', async (req, res) => {
  const platform = normalizeText(req.body.platform, 20) || 'boss';
  const query = normalizeText(req.body.query, 80);
  const city = normalizeText(req.body.city, 20) || '全国';
  const pages = toIntInRange(req.body.pages, 2, 1, 5);

  if (!query) return res.status(400).json({ error: '请提供搜索关键词' });
  if (!isSupportedPlatform(platform)) {
    return res.status(400).json({ error: `平台 ${platform} 暂不支持` });
  }

  try {
    const result = await crawlAndStoreJobs({ platform, query, city, pages });
    if (result.needLogin) {
      return res.json(result);
    }
    res.json(result);
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
  const crawledDate = normalizeText(req.query.crawledDate, 20);
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
  if (crawledDate === 'today') {
    where += " AND date(j.crawled_at) = date('now')";
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

router.delete('/jobs/:id', (req, res) => {
  const id = normalizeText(req.params.id, 80);
  if (!id) return res.status(400).json({ error: '缺少职位 ID' });

  const deleted = deleteJobsByIds([id]);
  if (!deleted) return res.status(404).json({ error: '职位不存在或已被删除' });

  res.json({ success: true, deleted });
});

router.post('/jobs/bulk-delete', (req, res) => {
  const ids = normalizeIds(req.body.ids);
  if (ids.length === 0) {
    return res.status(400).json({ error: '请选择要删除的职位' });
  }

  const deleted = deleteJobsByIds(ids);
  res.json({ success: true, deleted });
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

// 平台登录（启动可见浏览器，登录成功后保存 cookies）
router.post('/platforms/:name/login', async (req, res) => {
  const { name } = req.params;
  const config = getPlatformConfig(name);
  if (!config) return res.status(400).json({ error: `平台 ${name} 暂不支持` });

  try {
    await loginInteractive({
      platform: config.name,
      loginUrl: config.loginUrl,
      successUrlPattern: config.successUrlPattern,
      loginCheckExpression: config.loginCheckExpression,
      timeoutMs: 120000,
    });

    const existing = db.prepare(
      'SELECT id FROM platform_accounts WHERE user_id = ? AND platform_name = ?'
    ).get(DEMO_USER_ID, config.name) as any;

    if (existing) {
      db.prepare(
        `UPDATE platform_accounts
         SET login_state = 'logged_in', status = 'active', last_login = datetime('now')
         WHERE id = ?`
      ).run(existing.id);
    } else {
      db.prepare(
        `INSERT INTO platform_accounts (id, user_id, platform_name, status, login_state, last_login)
         VALUES (?, ?, ?, 'active', 'logged_in', datetime('now'))`
      ).run(uuidv4(), DEMO_USER_ID, config.name);
    }

    res.json({ success: true, message: `${config.label} 登录成功` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `登录失败: ${msg}` });
  }
});

// 检查登录状态
router.get('/platforms/:name/login-status', async (req, res) => {
  const { name } = req.params;
  const loggedIn = req.query.verify === '1' || req.query.verify === 'true'
    ? await validateLoginState(name)
    : hasLoginState(name);
  res.json({ platform: name, loggedIn });
});

export default router;
