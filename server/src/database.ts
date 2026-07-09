import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');
const DATA_DIR = path.dirname(DB_PATH);

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT,
    content TEXT,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS platform_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform_name TEXT NOT NULL,
    account_id TEXT,
    credentials TEXT,
    status TEXT DEFAULT 'inactive',
    login_state TEXT DEFAULT 'unlogged',
    last_login DATETIME,
    last_sync DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS delivery_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    keywords TEXT,
    salary_range TEXT,
    locations TEXT,
    company_size TEXT,
    experience TEXT,
    daily_limit INTEGER DEFAULT 50,
    interval_minutes INTEGER DEFAULT 30,
    greeting_message TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    job_id TEXT,
    title TEXT NOT NULL,
    company_name TEXT,
    salary TEXT,
    location TEXT,
    experience TEXT,
    education TEXT,
    company_size TEXT,
    company_industry TEXT,
    job_url TEXT NOT NULL,
    tags TEXT,
    job_hash TEXT UNIQUE,
    status TEXT DEFAULT 'active',
    crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS job_clicks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    company_name TEXT,
    position_name TEXT,
    salary TEXT,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_platform ON jobs(platform);
  CREATE INDEX IF NOT EXISTS idx_jobs_hash ON jobs(job_hash);
  CREATE INDEX IF NOT EXISTS idx_jobs_crawled ON jobs(crawled_at);
  CREATE INDEX IF NOT EXISTS idx_job_clicks_user ON job_clicks(user_id);
  CREATE INDEX IF NOT EXISTS idx_job_clicks_date ON job_clicks(clicked_at);
`);

export function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0) return;

  console.log('🌱 正在插入种子数据...');

  const DEMO_USER_ID = 'u001';

  db.prepare('INSERT INTO users (id, email, phone, password_hash) VALUES (?, ?, ?, ?)')
    .run(DEMO_USER_ID, 'demo@example.com', '13800138000', 'hashed_password_demo');

  const insertResume = db.prepare(
    'INSERT INTO resumes (id, user_id, name, file_path, content, is_default) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertResume.run('r001', DEMO_USER_ID, '前端开发简历-标准版', '/uploads/resume-standard.pdf', JSON.stringify({
    name: '张三', title: '高级前端开发工程师',
    skills: ['React', 'Vue', 'TypeScript', 'Node.js'], experience: '5年'
  }), 1);
  insertResume.run('r002', DEMO_USER_ID, '前端开发简历-精简版', '/uploads/resume-brief.pdf', JSON.stringify({
    name: '张三', title: '前端开发工程师',
    skills: ['React', 'TypeScript'], experience: '3年'
  }), 0);
  insertResume.run('r003', DEMO_USER_ID, '全栈开发简历', '/uploads/resume-fullstack.pdf', JSON.stringify({
    name: '张三', title: '全栈开发工程师',
    skills: ['React', 'Node.js', 'Python', 'Docker'], experience: '4年'
  }), 0);

  const insertPlatform = db.prepare(
    'INSERT INTO platform_accounts (id, user_id, platform_name, account_id, credentials, status, login_state) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertPlatform.run('p001', DEMO_USER_ID, 'boss', null, '{}', 'inactive', 'unlogged');
  insertPlatform.run('p002', DEMO_USER_ID, 'zhilian', null, '{}', 'inactive', 'unlogged');
  insertPlatform.run('p003', DEMO_USER_ID, '51job', null, '{}', 'inactive', 'unlogged');
  insertPlatform.run('p004', DEMO_USER_ID, 'lagou', null, '{}', 'inactive', 'unlogged');

  db.prepare(
    'INSERT INTO delivery_settings (id, user_id, keywords, salary_range, locations, daily_limit, interval_minutes, greeting_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('s001', DEMO_USER_ID,
    JSON.stringify(['前端开发', 'React']),
    '15-30K',
    JSON.stringify(['北京', '上海', '深圳', '杭州']),
    50, 30,
    '您好，我对贵公司的职位很感兴趣，希望能有机会进一步沟通！'
  );

  console.log('✅ 种子数据插入完成');
}

export default db;
