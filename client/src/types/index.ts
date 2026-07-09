// ========== 简历 ==========
export interface Resume {
  id: string;
  user_id: string;
  name: string;
  file_path: string | null;
  content: string | null;
  is_default: number;
  created_at: string;
}

export interface ResumeContent {
  name: string;
  title: string;
  skills: string[];
  experience: string;
}

// ========== 平台 ==========
export interface Platform {
  name: string;
  label: string;
  logo: string;
  color: string;
  loginType: string;
  bound: boolean;
  status: string;
  loginState: string;
  lastLogin: string | null;
  lastSync: string | null;
  accountId: string | null;
}

// ========== 职位 ==========
export interface Job {
  id: string;
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
  tags: string;
  status: string;
  crawled_at: string;
  clicked: number;
}

export interface JobsResponse {
  total: number;
  page: number;
  size: number;
  records: Job[];
}

export interface CrawlResult {
  success: boolean;
  platform: string;
  query: string;
  city: string;
  total: number;
  inserted: number;
  duplicated: number;
  error?: string;
  needLogin?: boolean;
}

// ========== 投递记录（点击记录） ==========
export interface DeliveryRecord {
  id: string;
  user_id: string;
  job_id: string;
  platform: string;
  company_name: string;
  position_name: string;
  salary: string;
  clicked_at: string;
  job_url?: string;
  location?: string;
  experience?: string;
  education?: string;
}

export interface DeliveryRecordsResponse {
  total: number;
  page: number;
  size: number;
  records: DeliveryRecord[];
}

// ========== 投递设置 ==========
export interface DeliverySetting {
  id?: string;
  user_id?: string;
  keywords: string[];
  salary_range: string;
  locations: string[];
  company_size?: string;
  experience?: string;
  daily_limit: number;
  interval_minutes: number;
  greeting_message: string;
}

// ========== 统计数据 ==========
export interface Statistics {
  todayCount: number;
  totalCount: number;
  pendingCount: number;
  interviewCount: number;
  trendData: { date: string; count: number }[];
  platformDistribution: { platform: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
}

// ========== 平台标签映射 ==========
export const PLATFORM_LABELS: Record<string, string> = {
  boss: 'BOSS直聘',
  zhilian: '智联招聘',
  '51job': '前程无忧',
  lagou: '拉勾网',
};

export const STATUS_LABELS: Record<string, string> = {
  clicked: '已查看',
  unclicked: '未查看',
  delivered: '已投递',
  viewed: '已查看',
  pending: '待沟通',
  rejected: '已拒绝',
  interview: '面试邀请',
};

export const PLATFORM_CONFIG = [
  { name: 'boss', label: 'BOSS直聘', logo: 'B', color: '#00D4AA' },
  { name: 'zhilian', label: '智联招聘', logo: '智', color: '#FF6B35' },
  { name: '51job', label: '前程无忧', logo: '51', color: '#1E3A5F' },
  { name: 'lagou', label: '拉勾网', logo: '拉', color: '#00BFFF' },
];

export const PLATFORM_COLORS: Record<string, string> = {
  boss: '#00D4AA',
  zhilian: '#FF6B35',
  '51job': '#1E3A5F',
  lagou: '#00BFFF',
};
