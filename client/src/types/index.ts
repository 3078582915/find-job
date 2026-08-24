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
  requiresLoginForCrawl: boolean;
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
  rag_score?: number;
  rag_reason?: string;
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
  todayJobs?: number;
  totalJobs?: number;
  todayClicks?: number;
  totalClicks?: number;
  unclickedJobs?: number;
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
  shixiseng: '实习僧',
  lagou: '拉勾网（历史）',
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
  { name: 'shixiseng', label: '实习僧', logo: '实', color: '#FF7A45' },
];

export const PLATFORM_COLORS: Record<string, string> = {
  boss: '#00D4AA',
  zhilian: '#FF6B35',
  '51job': '#1E3A5F',
  shixiseng: '#FF7A45',
  lagou: '#00BFFF',
};

// ========== Agent ==========
export interface AgentStatus {
  configured: boolean;
  model: string;
  baseUrl: string | null;
  provider?: 'deepseek' | 'openai' | 'custom';
  framework: string;
  capabilities: string[];
}

export interface AgentModelConfig {
  configured: boolean;
  apiKeyConfigured: boolean;
  keyHint: string | null;
  keySource: 'ui' | 'environment' | 'none';
  model: string;
  baseUrl: string | null;
  provider: 'deepseek' | 'openai' | 'custom';
}

export interface AgentConnectionTest {
  success: boolean;
  latencyMs: number;
  response: string;
}

export interface AgentConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
  message_count?: number;
}

export interface AgentJobCard {
  id: string;
  platform: string;
  title: string;
  company: string;
  salary: string;
  location: string;
  experience: string;
  education: string;
  companySize: string;
  industry: string;
  url: string;
  clicked: boolean;
  crawledAt: string;
  relevanceScore?: number;
  matchReason?: string;
}

// ========== 校招官网 ==========
export type CampusVerificationStatus = 'verified' | 'user_confirmed' | 'unverified' | 'rejected';
export type CampusVerificationMethod = 'official_domain' | 'official_referral' | 'manual' | null;
export type CampusSiteKind = 'official_site' | 'referral_link' | 'aggregated_reference';
export type CampusApplicationStatus = 'not_applied' | 'applied' | 'terminated';

export interface CampusSite {
  id: string;
  company_name: string;
  site_name: string | null;
  official_url: string;
  domain: string;
  source_type: 'manual' | 'agent';
  source_query: string | null;
  confidence: number;
  verification_status: CampusVerificationStatus;
  verification_method: CampusVerificationMethod;
  verification_evidence: string | null;
  site_kind: CampusSiteKind;
  application_status: CampusApplicationStatus;
  applied_at: string | null;
  application_status_updated_at: string | null;
  status: 'active' | 'inactive';
  tags: string | null;
  notes: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampusSiteStats {
  total: number;
  agent: number;
  manual: number;
  verified: number;
  invalid: number;
}

export interface CampusSitesResponse {
  total: number;
  page: number;
  size: number;
  records: CampusSite[];
  stats: CampusSiteStats;
}

export interface AgentCampusSiteCard {
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
  saveable?: boolean;
  saved?: boolean;
}

export interface AgentCampusSiteSearchCandidate {
  companyName: string;
  siteName: string;
  url: string;
  domain: string;
  confidence: number;
  evidenceUrls: string[];
  reason: string;
  reviewRequired: true;
}

export interface AgentPendingAction {
  id: string;
  actionType: string;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  expiresAt: string;
  status?: 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed';
}

export interface AgentArtifact {
  kind: 'job_list' | 'campus_sites' | 'statistics' | 'platform_status' | 'preferences' | 'confirmation' | 'crawl_result' | string;
  jobs?: AgentJobCard[];
  campusSites?: AgentCampusSiteCard[];
  campusSiteCandidates?: AgentCampusSiteSearchCandidate[];
  conditions?: string;
  statistics?: Record<string, any>;
  platforms?: Array<{ name: string; label: string; loggedIn: boolean; requiresLoginForCrawl: boolean }>;
  preferences?: Record<string, unknown>;
  action?: AgentPendingAction;
  result?: Record<string, any>;
  actionId?: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: { artifacts?: AgentArtifact[] };
  created_at: string;
}
