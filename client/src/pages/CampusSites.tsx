import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import * as api from '../services/api';
import type { CampusApplicationStatus, CampusSite, CampusSiteStats } from '../types';

type FormState = {
  companyName: string;
  siteName: string;
  officialUrl: string;
  siteKind: CampusSite['site_kind'];
  tags: string;
  notes: string;
};

const EMPTY_FORM: FormState = { companyName: '', siteName: '', officialUrl: '', siteKind: 'official_site', tags: '', notes: '' };

function parseTags(tags: string | null) {
  if (!tags) return [];
  try {
    return Array.isArray(JSON.parse(tags)) ? JSON.parse(tags) as string[] : [];
  } catch {
    return [];
  }
}

function sourceLabel(source: CampusSite['source_type']) {
  return source === 'agent' ? 'Agent 发现' : '手动添加';
}

function verificationLabel(status: CampusSite['verification_status']) {
  if (status === 'verified') return '系统已验证';
  if (status === 'user_confirmed') return '用户已确认';
  if (status === 'rejected') return '验证拒绝';
  return '未验证';
}

function siteKindLabel(kind: CampusSite['site_kind']) {
  if (kind === 'referral_link') return '内推链接';
  if (kind === 'aggregated_reference') return '信息汇总表';
  return '官方入口';
}

function canOpen(site: CampusSite) {
  return site.status === 'active' && (site.verification_status === 'verified' || site.verification_status === 'user_confirmed');
}

function formatTime(value: string | null) {
  if (!value) return '未检查';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export default function CampusSites() {
  const [records, setRecords] = useState<CampusSite[]>([]);
  const [stats, setStats] = useState<CampusSiteStats>({ total: 0, agent: 0, manual: 0, verified: 0, invalid: 0 });
  const [keyword, setKeyword] = useState('');
  const [sourceType, setSourceType] = useState('all');
  const [verificationStatus, setVerificationStatus] = useState('all');
  const [applicationStatus, setApplicationStatus] = useState('all');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [updatingApplicationStatusId, setUpdatingApplicationStatusId] = useState<string | null>(null);

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.fetchCampusSites({
        page,
        size: pageSize,
        keyword: keyword.trim() || undefined,
        sourceType,
        verificationStatus,
        applicationStatus,
        status,
      });
      setRecords(result.records);
      setTotal(result.total);
      setStats(result.stats);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载校招官网失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [page, sourceType, verificationStatus, applicationStatus, status, keyword]);

  const tagsForForm = useMemo(() => form.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean), [form.tags]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (site: CampusSite) => {
    setEditingId(site.id);
    setForm({
      companyName: site.company_name,
      siteName: site.site_name || '',
      officialUrl: site.official_url,
      siteKind: site.site_kind || 'official_site',
      tags: parseTags(site.tags).join('、'),
      notes: site.notes || '',
    });
    setModalOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.companyName.trim() || !form.officialUrl.trim()) {
      setError('公司名称和官网链接不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        companyName: form.companyName.trim(),
        siteName: form.siteName.trim() || undefined,
        officialUrl: form.officialUrl.trim(),
        siteKind: form.siteKind,
        tags: tagsForForm,
        notes: form.notes.trim() || undefined,
      };
      if (editingId) await api.updateCampusSite(editingId, payload);
      else await api.createCampusSite(payload);
      setModalOpen(false);
      if (page !== 1) setPage(1);
      else await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (site: CampusSite) => {
    if (!window.confirm(`确定删除「${site.company_name}」的官网记录吗？`)) return;
    try {
      await api.deleteCampusSite(site.id);
      if (records.length === 1 && page > 1) setPage((value) => value - 1);
      else await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '删除失败');
    }
  };

  const openSite = (site: CampusSite) => {
    if (!canOpen(site)) return;
    window.open(site.official_url, '_blank', 'noopener,noreferrer');
  };

  const updateApplicationStatus = async (site: CampusSite, value: CampusApplicationStatus) => {
    if (value === site.application_status) return;
    setUpdatingApplicationStatusId(site.id);
    setError('');
    try {
      const updated = await api.updateCampusSiteApplicationStatus(site.id, value);
      if (updated) setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '投递状态保存失败');
    } finally {
      setUpdatingApplicationStatusId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1260px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GraduationCap size={25} className="text-accent" />
            <h1 className="text-[28px] font-semibold text-[#2C3E50]">校招官网</h1>
          </div>
          <p className="mt-2 text-sm text-[#7F8C8D]">独立管理公司校招官网、内推链接和信息汇总表</p>
        </div>
        <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-[#EB5C2A]">
          <Plus size={16} />添加官网
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['官网总数', stats.total, 'text-[#17324D]'],
          ['系统已验证', stats.verified, 'text-[#17865D]'],
          ['Agent 发现', stats.agent, 'text-[#2E6B9A]'],
          ['手动添加', stats.manual, 'text-[#D87821]'],
          ['验证失败/失效', stats.invalid, 'text-[#B33D2E]'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-md border border-[#DFE6EC] bg-white p-4 shadow-sm">
            <div className="text-xs text-[#71818E]">{label}</div>
            <div className={`mt-2 text-2xl font-semibold ${color}`}>{String(value)}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-[#DFE6EC] bg-white p-4 shadow-sm">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A98A3]" />
          <input
            value={keyword}
            onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void load(); }}
            placeholder="搜索公司、域名或标签"
            className="w-full rounded-md border border-[#D9E1E7] bg-[#FAFCFD] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <select value={sourceType} onChange={(event) => { setSourceType(event.target.value); setPage(1); }} className="rounded-md border border-[#D9E1E7] bg-[#FAFCFD] px-3 py-2.5 text-sm">
          <option value="all">全部来源</option><option value="manual">手动添加</option><option value="agent">Agent 发现</option>
        </select>
        <select value={verificationStatus} onChange={(event) => { setVerificationStatus(event.target.value); setPage(1); }} className="rounded-md border border-[#D9E1E7] bg-[#FAFCFD] px-3 py-2.5 text-sm">
          <option value="all">全部验证状态</option><option value="verified">系统已验证</option><option value="user_confirmed">用户已确认</option><option value="unverified">未验证</option><option value="rejected">验证拒绝</option>
        </select>
        <select value={applicationStatus} onChange={(event) => { setApplicationStatus(event.target.value); setPage(1); }} className="rounded-md border border-[#D9E1E7] bg-[#FAFCFD] px-3 py-2.5 text-sm">
          <option value="all">全部投递状态</option><option value="not_applied">未投递</option><option value="applied">已投递</option><option value="terminated">流程终止</option>
        </select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-md border border-[#D9E1E7] bg-[#FAFCFD] px-3 py-2.5 text-sm">
          <option value="all">全部状态</option><option value="active">正常</option><option value="inactive">失效</option>
        </select>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-[#D9E1E7] px-3 py-2.5 text-sm text-[#39536A] hover:border-accent hover:text-accent" title="刷新官网列表">
          <RefreshCw size={15} />刷新
        </button>
      </div>

      {error && <div className="mb-4 rounded-md border border-[#F1C7B5] bg-[#FFF8F4] px-4 py-3 text-sm text-[#8C3D22]">{error}</div>}

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-[148px] animate-pulse rounded-md bg-white shadow-sm" />)}</div>
      ) : records.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#D9E1E7] bg-white px-6 py-16 text-center text-[#7F8C8D]">
          <GraduationCap size={40} className="mx-auto mb-3 text-[#B8C5CF]" />
          <div className="text-base font-medium text-[#39536A]">暂无校招官网记录</div>
          <div className="mt-1 text-sm">可以先手动添加公司校招入口，或在 Agent 中搜索公司校招官网</div>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((site) => {
            const openable = canOpen(site);
            return (
              <article key={site.id} className="rounded-md border border-[#DFE6EC] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-[#17324D]">{site.company_name}</h2>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${site.verification_status === 'verified' ? 'bg-[#EFFAF5] text-[#17865D]' : site.verification_status === 'user_confirmed' ? 'bg-[#FFF8EC] text-[#A96116]' : 'bg-[#FFF1EE] text-[#B33D2E]'}`}>
                        {site.verification_status === 'verified' ? <ShieldCheck size={12} /> : <CheckCircle2 size={12} />}
                        {verificationLabel(site.verification_status)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[#5E6F7E]">{site.site_name || `${site.company_name}校招官网`}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#788895]">
                      <span className="inline-flex items-center gap-1"><Link2 size={13} />{site.domain}</span>
                      <span>{sourceLabel(site.source_type)}</span>
                      <span>{siteKindLabel(site.site_kind || 'official_site')}</span>
                      <span>最近检查：{formatTime(site.last_checked_at)}</span>
                    </div>
                    <div className="mt-2 break-all text-xs text-[#8A98A3]">{site.official_url}</div>
                    {parseTags(site.tags).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{parseTags(site.tags).map((tag) => <span key={tag} className="rounded bg-[#F4FAFF] px-2 py-1 text-xs text-[#3E6D8E]">{tag}</span>)}</div>}
                    {site.notes && <div className="mt-2 text-xs text-[#7F8C8D]">备注：{site.notes}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                    <label className="flex items-center justify-between gap-2 text-xs text-[#71818E] sm:justify-end">
                      <span>投递状态</span>
                      <select
                        value={site.application_status}
                        disabled={updatingApplicationStatusId === site.id}
                        onChange={(event) => void updateApplicationStatus(site, event.target.value as CampusApplicationStatus)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs outline-none focus:border-accent ${site.application_status === 'applied' ? 'border-[#B8DEC9] bg-[#EFFAF5] text-[#17865D]' : site.application_status === 'terminated' ? 'border-[#F1B5B5] bg-[#FFF0F0] text-[#B42318]' : 'border-[#D9E1E7] bg-[#FAFCFD] text-[#39536A]'}`}
                      >
                        <option value="not_applied">未投递</option>
                        <option value="applied">已投递</option>
                        <option value="terminated">流程终止</option>
                      </select>
                    </label>
                    <div className="flex items-center gap-2">
                    {openable ? (
                      <button type="button" onClick={() => openSite(site)} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-[#EB5C2A]">
                        <ExternalLink size={14} />打开链接
                      </button>
                    ) : <span className="rounded-md bg-[#F5F7FA] px-3 py-2 text-xs text-[#8A98A3]">未验证，不可打开</span>}
                    <button type="button" onClick={() => openEdit(site)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#D9E1E7] text-[#39536A] hover:border-accent hover:text-accent" title="编辑官网"><Pencil size={15} /></button>
                    <button type="button" onClick={() => void remove(site)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#F1C7B5] text-[#B33D2E] hover:bg-[#FFF1EE]" title="删除官网"><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {totalPages > 1 && <div className="flex items-center justify-center gap-3 pt-3 text-sm text-[#7F8C8D]">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-[#D9E1E7] px-3 py-1.5 disabled:opacity-40">上一页</button>
            <span>{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-md border border-[#D9E1E7] px-3 py-1.5 disabled:opacity-40">下一页</button>
          </div>}
        </div>
      )}

      {modalOpen && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#17324D]/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
        <form onSubmit={submit} className="w-full max-w-[620px] rounded-md bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-[#E1E8ED] px-6 py-5">
            <div><h2 className="text-lg font-semibold text-[#17324D]">{editingId ? '编辑校招官网' : '添加校招官网'}</h2><p className="mt-1 text-xs text-[#7F8C8D]">手动添加的链接会标记为“用户已确认”，不会混入职位库</p></div>
            <button type="button" onClick={() => setModalOpen(false)} className="text-[#71818E] hover:text-[#17324D]" title="关闭"><X size={20} /></button>
          </div>
          <div className="space-y-4 px-6 py-5">
            <label className="block text-sm text-[#39536A]">公司名称<input required value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} className="mt-1.5 w-full rounded-md border border-[#D9E1E7] px-3 py-2.5 outline-none focus:border-accent" placeholder="例如：蚂蚁集团" /></label>
            <label className="block text-sm text-[#39536A]">链接地址<input required type="url" value={form.officialUrl} onChange={(event) => setForm({ ...form, officialUrl: event.target.value })} className="mt-1.5 w-full rounded-md border border-[#D9E1E7] px-3 py-2.5 outline-none focus:border-accent" placeholder="https://..." /></label>
            <label className="block text-sm text-[#39536A]">官网名称<input value={form.siteName} onChange={(event) => setForm({ ...form, siteName: event.target.value })} className="mt-1.5 w-full rounded-md border border-[#D9E1E7] px-3 py-2.5 outline-none focus:border-accent" placeholder="例如：蚂蚁集团校招/内推官网" /></label>
            <label className="block text-sm text-[#39536A]">链接类型<select value={form.siteKind} onChange={(event) => setForm({ ...form, siteKind: event.target.value as FormState['siteKind'] })} className="mt-1.5 w-full rounded-md border border-[#D9E1E7] bg-white px-3 py-2.5 outline-none focus:border-accent"><option value="official_site">官方入口</option><option value="referral_link">内推链接</option><option value="aggregated_reference">信息汇总表</option></select></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-[#39536A]">标签<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} className="mt-1.5 w-full rounded-md border border-[#D9E1E7] px-3 py-2.5 outline-none focus:border-accent" placeholder="校招、内推、技术岗" /></label><label className="block text-sm text-[#39536A]">备注<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-1.5 w-full rounded-md border border-[#D9E1E7] px-3 py-2.5 outline-none focus:border-accent" placeholder="可选" /></label></div>
          </div>
          <div className="flex justify-end gap-2 border-t border-[#E1E8ED] px-6 py-4"><button type="button" onClick={() => setModalOpen(false)} className="rounded-md border border-[#D9E1E7] px-4 py-2 text-sm text-[#39536A]">取消</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <RefreshCw size={14} className="animate-spin" />}{saving ? '保存中...' : '保存官网'}</button></div>
        </form>
      </div>}
    </div>
  );
}
