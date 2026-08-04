import { Router } from 'express';
import db from '../database';

const router = Router();
const DEMO_USER_ID = 'u001';

router.get('/statistics', (_req, res) => {
  const totalJobs = (db.prepare('SELECT COUNT(*) as c FROM jobs').get() as any).c;
  const totalClicks = (db.prepare('SELECT COUNT(*) as c FROM job_clicks WHERE user_id = ?').get(DEMO_USER_ID) as any).c;
  const todayJobs = (db.prepare("SELECT COUNT(*) as c FROM jobs WHERE date(crawled_at) = date('now')").get() as any).c;
  const todayClicks = (db.prepare("SELECT COUNT(*) as c FROM job_clicks WHERE user_id = ? AND date(clicked_at) = date('now')").get(DEMO_USER_ID) as any).c;

  const trendData = db.prepare(`
    SELECT date(clicked_at) as date, COUNT(*) as count
    FROM job_clicks WHERE user_id = ?
    GROUP BY date(clicked_at) ORDER BY date(clicked_at) ASC LIMIT 7
  `).all(DEMO_USER_ID);

  const platformDistribution = db.prepare(
    'SELECT platform, COUNT(*) as count FROM jobs GROUP BY platform'
  ).all();

  const statusDistribution = db.prepare(`
    SELECT 
      CASE WHEN EXISTS(SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?) 
           THEN 'clicked' ELSE 'unclicked' END as status,
      COUNT(*) as count
    FROM jobs j GROUP BY status
  `).all(DEMO_USER_ID);

  res.json({
    todayJobs,
    totalJobs,
    todayClicks,
    totalClicks,
    unclickedJobs: Math.max(0, totalJobs - totalClicks),
    todayCount: todayClicks,
    totalCount: totalClicks,
    pendingCount: totalJobs - totalClicks,
    interviewCount: todayJobs,
    trendData,
    platformDistribution,
    statusDistribution,
  });
});

export default router;
