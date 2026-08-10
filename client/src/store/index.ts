import { create } from 'zustand';
import type { Statistics, Resume, Platform, DeliveryRecord, DeliverySetting, DeliveryRecordsResponse, Job, JobsResponse, CrawlResult } from '../types';
import * as api from '../services/api';

interface AppState {
  // 统计
  statistics: Statistics | null;
  loadingStats: boolean;
  loadStatistics: () => Promise<void>;

  // 简历
  resumes: Resume[];
  loadingResumes: boolean;
  loadResumes: () => Promise<void>;
  addResume: (data: { name: string; content?: object; isDefault?: boolean }) => Promise<void>;
  editResume: (id: string, data: { name?: string; content?: object; isDefault?: boolean }) => Promise<void>;
  removeResume: (id: string) => Promise<void>;

  // 平台
  platforms: Platform[];
  loadingPlatforms: boolean;
  loadPlatforms: (options?: { verify?: boolean }) => Promise<void>;
  doLoginPlatform: (name: string) => Promise<void>;
  doLogoutPlatform: (name: string) => Promise<void>;

  // 投递设置
  settings: DeliverySetting | null;
  loadingSettings: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (data: Partial<DeliverySetting>) => Promise<void>;

  // 投递记录
  records: DeliveryRecordsResponse | null;
  loadingRecords: boolean;
  loadRecords: (params?: { page?: number; size?: number; platform?: string; clickedDate?: string }) => Promise<void>;

  // 职位
  jobs: JobsResponse | null;
  loadingJobs: boolean;
  crawling: boolean;
  loadJobs: (params?: {
    page?: number;
    size?: number;
    platform?: string;
    keyword?: string;
    city?: string;
    salaryStatus?: string;
    companyStatus?: string;
    clickStatus?: string;
    unclicked?: string;
    crawledDate?: string;
    semantic?: string;
  }) => Promise<void>;
  crawlJobs: (data: { platform: string; query: string; city?: string; pages?: number }) => Promise<CrawlResult>;
  doClickJob: (id: string) => Promise<{ url: string; alreadyClicked: boolean }>;
  deleteJob: (id: string) => Promise<number>;
  deleteJobs: (ids: string[]) => Promise<number>;
}

export const useStore = create<AppState>((set, get) => ({
  // 统计
  statistics: null,
  loadingStats: false,
  loadStatistics: async () => {
    set({ loadingStats: true });
    try {
      const statistics = await api.fetchStatistics();
      set({ statistics });
    } finally {
      set({ loadingStats: false });
    }
  },

  // 简历
  resumes: [],
  loadingResumes: false,
  loadResumes: async () => {
    set({ loadingResumes: true });
    try {
      const resumes = await api.fetchResumes();
      set({ resumes });
    } finally {
      set({ loadingResumes: false });
    }
  },
  addResume: async (data) => {
    await api.createResume(data);
    const resumes = await api.fetchResumes();
    set({ resumes });
  },
  editResume: async (id, data) => {
    await api.updateResume(id, data);
    const resumes = await api.fetchResumes();
    set({ resumes });
  },
  removeResume: async (id) => {
    await api.deleteResume(id);
    const resumes = await api.fetchResumes();
    set({ resumes });
  },

  // 平台
  platforms: [],
  loadingPlatforms: false,
  loadPlatforms: async (options) => {
    set({ loadingPlatforms: true });
    try {
      const platforms = await api.fetchPlatforms(options);
      set({ platforms });
    } finally {
      set({ loadingPlatforms: false });
    }
  },
  doLoginPlatform: async (name) => {
    await api.loginPlatform(name);
    const platforms = await api.fetchPlatforms();
    set({ platforms });
  },
  doLogoutPlatform: async (name) => {
    await api.logoutPlatform(name);
    const platforms = await api.fetchPlatforms();
    set({ platforms });
  },

  // 投递设置
  settings: null,
  loadingSettings: false,
  loadSettings: async () => {
    set({ loadingSettings: true });
    try {
      const settings = await api.fetchDeliverySettings();
      set({ settings });
    } finally {
      set({ loadingSettings: false });
    }
  },
  saveSettings: async (data) => {
    await api.updateDeliverySettings(data);
    const settings = await api.fetchDeliverySettings();
    set({ settings });
  },

  // 投递记录
  records: null,
  loadingRecords: false,
  loadRecords: async (params) => {
    set({ loadingRecords: true });
    try {
      const records = await api.fetchDeliveryRecords(params || {});
      set({ records });
    } finally {
      set({ loadingRecords: false });
    }
  },

  // 职位
  jobs: null,
  loadingJobs: false,
  crawling: false,
  loadJobs: async (params) => {
    set({ loadingJobs: true });
    try {
      const jobs = await api.fetchJobs(params || {});
      set({ jobs });
    } finally {
      set({ loadingJobs: false });
    }
  },
  crawlJobs: async (data) => {
    set({ crawling: true });
    try {
      const result = await api.crawlJobs(data);
      if (result.needLogin) {
        const platforms = await api.fetchPlatforms();
        set({ platforms });
      }
      // 抓取后刷新职位列表
      await get().loadJobs();
      return result;
    } finally {
      set({ crawling: false });
    }
  },
  doClickJob: async (id) => {
    const result = await api.clickJob(id);
    // 更新本地职位列表中该职位的 clicked 状态
    const jobs = get().jobs;
    if (jobs) {
      const records = jobs.records.map(j =>
        j.id === id ? { ...j, clicked: 1 } : j
      );
      set({ jobs: { ...jobs, records } });
    }
    return { url: result.url, alreadyClicked: result.alreadyClicked };
  },
  deleteJob: async (id) => {
    const result = await api.deleteJob(id);
    const jobs = get().jobs;
    if (jobs && result.deleted > 0) {
      set({
        jobs: {
          ...jobs,
          total: Math.max(0, jobs.total - result.deleted),
          records: jobs.records.filter((job) => job.id !== id),
        },
      });
    }
    return result.deleted;
  },
  deleteJobs: async (ids) => {
    const result = await api.deleteJobs(ids);
    const idSet = new Set(ids);
    const jobs = get().jobs;
    if (jobs && result.deleted > 0) {
      set({
        jobs: {
          ...jobs,
          total: Math.max(0, jobs.total - result.deleted),
          records: jobs.records.filter((job) => !idSet.has(job.id)),
        },
      });
    }
    return result.deleted;
  },
}));
