import { Router } from 'express';
import db from '../database';
import { v4 as uuidv4 } from '../utils';
import { decodeBossPrivateText } from '../salaryCodec';

const router = Router();
const DEMO_USER_ID = 'u001';

function toIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeText(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, maxLength);
  return text || undefined;
}

function normalizeStringArray(value: unknown, maxItems = 20): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => normalizeText(item, 40))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

router.get('/delivery/settings', (_req, res) => {
  const settings = db.prepare(
    'SELECT * FROM delivery_settings WHERE user_id = ?'
  ).get(DEMO_USER_ID) as any;

  if (settings) {
    res.json({
      ...settings,
      keywords: JSON.parse(settings.keywords || '[]'),
      locations: JSON.parse(settings.locations || '[]'),
    });
  } else {
    res.json({
      keywords: ['前端开发', 'React'],
      salary_range: '15-30K',
      locations: ['北京', '上海'],
      daily_limit: 50,
      interval_minutes: 30,
      greeting_message: '您好，我对贵公司的职位很感兴趣！',
    });
  }
});

router.put('/delivery/settings', (req, res) => {
  const { keywords, salary_range, locations, company_size, experience, daily_limit, interval_minutes, greeting_message } = req.body;
  const normalizedKeywords = normalizeStringArray(keywords);
  const normalizedLocations = normalizeStringArray(locations);
  const normalizedSalaryRange = normalizeText(salary_range, 40);
  const normalizedCompanySize = normalizeText(company_size, 40);
  const normalizedExperience = normalizeText(experience, 40);
  const normalizedGreeting = normalizeText(greeting_message, 1000);
  const normalizedDailyLimit = daily_limit === undefined ? undefined : toIntInRange(daily_limit, 50, 1, 300);
  const normalizedInterval = interval_minutes === undefined ? undefined : toIntInRange(interval_minutes, 30, 1, 1440);

  const existing = db.prepare(
    'SELECT * FROM delivery_settings WHERE user_id = ?'
  ).get(DEMO_USER_ID) as any;

  if (existing) {
    db.prepare(`
      UPDATE delivery_settings SET
        keywords = COALESCE(?, keywords),
        salary_range = COALESCE(?, salary_range),
        locations = COALESCE(?, locations),
        company_size = COALESCE(?, company_size),
        experience = COALESCE(?, experience),
        daily_limit = COALESCE(?, daily_limit),
        interval_minutes = COALESCE(?, interval_minutes),
        greeting_message = COALESCE(?, greeting_message)
      WHERE user_id = ?
    `).run(
      normalizedKeywords === undefined ? null : JSON.stringify(normalizedKeywords),
      normalizedSalaryRange || null,
      normalizedLocations === undefined ? null : JSON.stringify(normalizedLocations),
      normalizedCompanySize || null,
      normalizedExperience || null,
      normalizedDailyLimit === undefined ? null : normalizedDailyLimit,
      normalizedInterval === undefined ? null : normalizedInterval,
      normalizedGreeting || null,
      DEMO_USER_ID
    );
  } else {
    db.prepare(`
      INSERT INTO delivery_settings (id, user_id, keywords, salary_range, locations, company_size, experience, daily_limit, interval_minutes, greeting_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), DEMO_USER_ID,
      JSON.stringify(normalizedKeywords || []),
      normalizedSalaryRange || '15-30K',
      JSON.stringify(normalizedLocations || []),
      normalizedCompanySize || '不限',
      normalizedExperience || '不限',
      normalizedDailyLimit || 50,
      normalizedInterval || 30,
      normalizedGreeting || ''
    );
  }

  res.json({ success: true });
});

// 投递记录 = job_clicks 记录
router.get('/delivery/records', (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const size = parseInt(req.query.size as string) || 20;
  const platform = req.query.platform as string;

  let where = 'WHERE c.user_id = ?';
  const params: any[] = [DEMO_USER_ID];

  if (platform && platform !== 'all') {
    where += ' AND c.platform = ?';
    params.push(platform);
  }

  const total = (db.prepare(
    `SELECT COUNT(*) as count FROM job_clicks c ${where}`
  ).get(...params) as any).count;

  const offset = (page - 1) * size;
  const records = db.prepare(
    `SELECT c.*, j.job_url, j.location, j.experience, j.education
     FROM job_clicks c
     LEFT JOIN jobs j ON c.job_id = j.id
     ${where} ORDER BY c.clicked_at DESC LIMIT ? OFFSET ?`
  ).all(...params, size, offset).map((record: any) => ({
    ...record,
    company_name: decodeBossPrivateText(record.company_name),
    position_name: decodeBossPrivateText(record.position_name),
    salary: decodeBossPrivateText(record.salary),
    location: decodeBossPrivateText(record.location),
    experience: decodeBossPrivateText(record.experience),
    education: decodeBossPrivateText(record.education),
  }));

  res.json({ total, page, size, records });
});

export default router;
