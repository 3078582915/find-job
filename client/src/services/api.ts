import axios from 'axios';
import type {
  Statistics, Resume, DeliverySetting, DeliveryRecordsResponse, Platform,
  JobsResponse, CrawlResult,
} from '../types';

const http = axios.create({ baseURL: '/api' });

// ========== 统计 ==========
export const fetchStatistics = () =>
  http.get<Statistics>('/statistics').then(r => r.data);

// ========== 简历 ==========
export const fetchResumes = () =>
  http.get<Resume[]>('/resumes').then(r => r.data);

export const createResume = (data: { name: string; content?: object; isDefault?: boolean }) =>
  http.post<Resume>('/resumes', data).then(r => r.data);

export const updateResume = (id: string, data: { name?: string; content?: object; isDefault?: boolean }) =>
  http.put<Resume>(`/resumes/${id}`, data).then(r => r.data);

export const deleteResume = (id: string) =>
  http.delete(`/resumes/${id}`).then(r => r.data);

// ========== 平台 ==========
export const fetchPlatforms = () =>
  http.get<Platform[]>('/platforms').then(r => r.data);

export const bindPlatform = (name: string, data: { account: string; password: string }) =>
  http.post(`/platforms/${name}/bind`, data).then(r => r.data);

export const logoutPlatform = (name: string) =>
  http.delete(`/platforms/${name}/logout`).then(r => r.data);

export const loginPlatform = (name: string) =>
  http.post(`/platforms/${name}/login`, {}, { timeout: 180000 }).then(r => r.data);

// ========== 投递设置 ==========
export const fetchDeliverySettings = () =>
  http.get<DeliverySetting>('/delivery/settings').then(r => r.data);

export const updateDeliverySettings = (data: Partial<DeliverySetting>) =>
  http.put('/delivery/settings', data).then(r => r.data);

// ========== 投递记录 ==========
export const fetchDeliveryRecords = (params: { page?: number; size?: number; platform?: string }) =>
  http.get<DeliveryRecordsResponse>('/delivery/records', { params }).then(r => r.data);

// ========== 职位 ==========
export const crawlJobs = (data: { platform: string; query: string; city?: string; pages?: number }) =>
  http.post<CrawlResult>('/jobs/crawl', data, { timeout: 180000 }).then(r => r.data);

export const fetchJobs = (params: {
  page?: number;
  size?: number;
  platform?: string;
  keyword?: string;
  city?: string;
  salaryStatus?: string;
  companyStatus?: string;
  clickStatus?: string;
  unclicked?: string;
}) =>
  http.get<JobsResponse>('/jobs', { params }).then(r => r.data);

export const clickJob = (id: string) =>
  http.post<{ success: boolean; url: string; alreadyClicked: boolean }>(`/jobs/${id}/click`).then(r => r.data);
