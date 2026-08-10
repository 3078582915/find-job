import {
  AlertCircle,
  BarChart3,
  Building2,
  Check,
  ExternalLink,
  Loader2,
  MapPin,
  Play,
  X,
} from 'lucide-react';
import type { AgentArtifact, AgentCampusSiteCard, AgentJobCard } from '../../types';

const PLATFORM_LABELS: Record<string, string> = {
  boss: 'BOSS直聘',
  zhilian: '智联招聘',
  '51job': '前程无忧',
  shixiseng: '实习僧',
};

const PLATFORM_MARKS: Record<string, string> = {
  boss: 'B',
  zhilian: '智',
  '51job': '51',
  shixiseng: '实',
};

export type ActionState = 'pending' | 'processing' | 'completed' | 'cancelled' | 'failed';

interface Props {
  artifacts: AgentArtifact[];
  actionStates: Record<string, ActionState>;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onOpenJob: (job: AgentJobCard) => void;
  onSaveCampusSite?: (site: AgentCampusSiteCard) => void;
}

function AgentCampusSiteCardView({ site, onSave }: { site: AgentCampusSiteCard; onSave?: () => void }) {
  const canOpen = site.verificationStatus === 'verified' || site.verificationStatus === 'user_confirmed';
  const siteKindLabel = site.siteKind === 'referral_link' ? '内推链接' : site.siteKind === 'aggregated_reference' ? '信息汇总表' : '官方入口';
  return (
    <article className="rounded-md border border-[#DFE6EC] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold text-[#17324D]">{site.companyName}</h3><span className="rounded-full bg-[#EFFAF5] px-2 py-0.5 text-xs text-[#17865D]">{site.verificationStatus === 'verified' ? '系统已验证' : '用户已确认'}</span></div>
          <div className="mt-1 text-sm text-[#5E6F7E]">{site.siteName}</div>
          <div className="mt-2 text-xs text-[#788895]">{site.domain} · {siteKindLabel} · {site.verificationMethod === 'official_referral' ? '官方引荐验证' : site.verificationMethod === 'manual' ? '用户确认' : '官方域名验证'}</div>
          <div className="mt-2 break-all text-xs text-[#8A98A3]">{site.url}</div>
          <div className="mt-2 text-xs text-[#3E6D8E]">{site.reason}</div>
          {site.evidenceUrls.length > 0 && <div className="mt-2 text-xs text-[#71818E]">证据：{site.evidenceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="ml-1 underline hover:text-accent">官方来源</a>)}</div>}
        </div>
        {canOpen && <a href={site.url} target="_blank" rel="noreferrer" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#D9E1E7] text-[#39536A] hover:border-accent hover:text-accent" title="打开已验证官网"><ExternalLink size={17} /></a>}
      </div>
      {onSave && site.verificationStatus === 'verified' && <button type="button" onClick={onSave} className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-accent px-3 py-2 text-sm text-accent hover:bg-[#FFF3EE]">保存到官网库</button>}
    </article>
  );
}

export function AgentJobCardView({ job, onOpen }: { job: AgentJobCard; onOpen: () => void }) {
  return (
    <article className="grid min-h-[116px] grid-cols-[44px_minmax(0,1fr)_auto] gap-3 rounded-md border border-[#DFE6EC] bg-white p-4 shadow-sm">
      <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#E8F8F3] text-sm font-bold text-[#087F67]">
        {PLATFORM_MARKS[job.platform] || job.platform.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="min-w-0 break-words text-[15px] font-semibold text-[#17324D]">{job.title}</h3>
          <span className="shrink-0 text-sm font-semibold text-[#E95632]">{job.salary || '薪资缺失'}</span>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-[#5E6F7E]">
          <Building2 size={14} className="shrink-0" />
          <span className="truncate">{job.company || '公司信息缺失'}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#788895]">
          <span className="inline-flex items-center gap-1"><MapPin size={13} />{job.location || '地点未知'}</span>
          {job.experience && <span>{job.experience}</span>}
          {job.education && <span>{job.education}</span>}
          <span>{PLATFORM_LABELS[job.platform] || job.platform}</span>
        </div>
        {job.matchReason && (
          <div className="mt-2 inline-flex rounded bg-[#F4FAFF] px-2 py-0.5 text-xs text-[#3E6D8E]">
            {job.matchReason}
          </div>
        )}
      </div>
      <a
        href={job.url}
        target="_blank"
        rel="noreferrer"
        onClick={onOpen}
        className="flex h-9 w-9 items-center justify-center self-center rounded-md border border-[#D9E1E7] text-[#39536A] transition-colors hover:border-accent hover:text-accent"
        title="打开官方职位页"
      >
        <ExternalLink size={17} />
      </a>
    </article>
  );
}

export default function AgentArtifacts({
  artifacts,
  actionStates,
  onConfirm,
  onCancel,
  onOpenJob,
  onSaveCampusSite,
}: Props) {
  if (!artifacts.length) return null;

  return (
    <div className="mt-4 space-y-3">
      {artifacts.map((artifact, artifactIndex) => {
        if (artifact.kind === 'job_list' && artifact.jobs?.length) {
          return (
            <div key={`jobs-${artifactIndex}`} className="space-y-2.5">
              {artifact.jobs.map((job) => (
                <AgentJobCardView key={job.id} job={job} onOpen={() => onOpenJob(job)} />
              ))}
            </div>
          );
        }

        if (artifact.kind === 'campus_sites' && artifact.campusSites?.length) {
          return (
            <div key={`campus-sites-${artifactIndex}`} className="space-y-2.5">
              {artifact.campusSites.map((site) => <AgentCampusSiteCardView key={`${site.companyName}-${site.url}`} site={site} onSave={onSaveCampusSite ? () => onSaveCampusSite(site) : undefined} />)}
            </div>
          );
        }

        if (artifact.kind === 'confirmation' && artifact.action) {
          const action = artifact.action;
          const state = actionStates[action.id] || action.status || 'pending';
          return (
            <div key={action.id} className="rounded-md border border-[#F1C7B5] bg-[#FFF8F4] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#8C3D22]">{action.title}</div>
                  <div className="mt-1 text-sm text-[#7A6258]">{action.description}</div>
                </div>
                {state === 'processing' && <Loader2 size={18} className="animate-spin text-accent" />}
                {state === 'completed' && <Check size={18} className="text-[#17865D]" />}
              </div>
              {state === 'pending' && (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onConfirm(action.id)}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-[#EB5C2A]"
                  >
                    <Play size={15} />确认执行
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancel(action.id)}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#E2CFC6] px-3 text-sm text-[#6E5A51] hover:bg-white"
                  >
                    <X size={15} />取消
                  </button>
                </div>
              )}
              {state === 'cancelled' && <div className="mt-3 text-xs text-[#7A6258]">已取消</div>}
              {state === 'failed' && <div className="mt-3 text-xs text-[#B33D2E]">执行失败</div>}
            </div>
          );
        }

        if (artifact.kind === 'statistics' && artifact.statistics) {
          const stats = artifact.statistics;
          const items = [
            ['职位总数', stats.total],
            ['今日新增', stats.today],
            ['未查看', stats.unclicked],
            ['薪资缺失', stats.salaryMissing],
          ];
          return (
            <div key={`stats-${artifactIndex}`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {items.map(([label, value]) => (
                <div key={String(label)} className="rounded-md border border-[#DFE6EC] bg-white p-3">
                  <div className="flex items-center gap-1.5 text-xs text-[#71818E]"><BarChart3 size={13} />{label}</div>
                  <div className="mt-1 text-xl font-semibold text-[#17324D]">{String(value ?? 0)}</div>
                </div>
              ))}
            </div>
          );
        }

        if (artifact.kind === 'platform_status' && artifact.platforms) {
          return (
            <div key={`platforms-${artifactIndex}`} className="grid gap-2 sm:grid-cols-2">
              {artifact.platforms.map((platform) => (
                <div key={platform.name} className="flex items-center justify-between rounded-md border border-[#DFE6EC] bg-white px-3 py-2.5">
                  <span className="text-sm font-medium text-[#29445C]">{platform.label}</span>
                  <span className={`text-xs font-medium ${platform.loggedIn ? 'text-[#17865D]' : 'text-[#8A98A3]'}`}>
                    {platform.loggedIn ? '已登录' : '未登录'}
                  </span>
                </div>
              ))}
            </div>
          );
        }

        if (artifact.kind === 'crawl_result' && artifact.result) {
          const failed = Boolean(artifact.result.needLogin || artifact.result.error);
          return (
            <div key={`crawl-${artifactIndex}`} className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
              failed ? 'border-[#F1C7B5] bg-[#FFF8F4] text-[#8C3D22]' : 'border-[#BFE2D4] bg-[#F2FBF7] text-[#176E50]'
            }`}>
              {failed ? <AlertCircle size={17} /> : <Check size={17} />}
              <span>{failed ? String(artifact.result.error || '抓取失败') : `新增 ${artifact.result.inserted || 0} 个职位，更新 ${artifact.result.duplicated || 0} 个职位`}</span>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
