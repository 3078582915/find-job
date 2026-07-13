import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { PLATFORM_LABELS, PLATFORM_COLORS, PLATFORM_CONFIG, type Job } from '../types';
import { cleanJobText, formatSalary, hasUnreadableChars } from '../utils/display';

const CITIES = ['全国', '北京', '上海', '广州', '深圳', '杭州', '成都', '南京', '武汉', '西安'];

export default function JobSquare() {
  const { jobs, loadingJobs, crawling, loadJobs, crawlJobs, doClickJob, platforms, loadPlatforms } = useStore();

  // 抓取表单
  const [crawlPlatform, setCrawlPlatform] = useState('boss');
  const [crawlQuery, setCrawlQuery] = useState('前端开发');
  const [crawlCity, setCrawlCity] = useState('全国');
  const [crawlPages, setCrawlPages] = useState(1);

  // 筛选
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [filterCity, setFilterCity] = useState('all');
  const [salaryStatus, setSalaryStatus] = useState('all');
  const [companyStatus, setCompanyStatus] = useState('all');
  const [clickStatus, setClickStatus] = useState('all');

  // 分页
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [crawlMessage, setCrawlMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const formatCrawlError = (message?: string) => {
    if (!message) return '抓取失败，请稍后重试';
    if (message.includes('访问限制') || message.includes('安全验证') || message.includes('空白页')) {
      return [
        message,
        '处理建议：1. 暂停自动抓取；2. 在弹出的 Chrome 中手动打开对应招聘平台并正常搜索一次；3. 如果出现验证，先手动完成；4. 过一段时间后只抓 1 页再试。',
      ].join('\n');
    }
    return message;
  };

  useEffect(() => {
    loadPlatforms();
  }, []);

  // 防抖：输入停止 300ms 后再触发搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(filterKeyword);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterKeyword]);

  useEffect(() => {
    loadJobs({
      page, size: pageSize,
      platform: filterPlatform,
      keyword: debouncedKeyword,
      city: filterCity,
      salaryStatus,
      companyStatus,
      clickStatus,
    });
  }, [page, filterPlatform, debouncedKeyword, filterCity, salaryStatus, companyStatus, clickStatus]);

  const handleCrawl = async () => {
    if (!crawlQuery.trim()) {
      setCrawlMessage({ type: 'error', text: '请输入搜索关键词' });
      return;
    }

    const selectedPlatform = platforms.find(p => p.name === crawlPlatform);
    if (selectedPlatform?.requiresLoginForCrawl && !selectedPlatform.bound) {
      setCrawlMessage({ type: 'error', text: `请先在"平台管理"页面登录 ${selectedPlatform.label}` });
      return;
    }

    setCrawlMessage({ type: 'info', text: `正在抓取 ${PLATFORM_LABELS[crawlPlatform]} 职位...（可能需要 30-60 秒）` });

    try {
      const result = await crawlJobs({
        platform: crawlPlatform,
        query: crawlQuery,
        city: crawlCity,
        pages: crawlPages,
      });

      if (result.needLogin) {
        setCrawlMessage({ type: 'error', text: result.error || '需要先登录平台' });
      } else if (result.error) {
        const type = result.inserted > 0 ? 'info' : 'error';
        setCrawlMessage({ type, text: `${formatCrawlError(result.error)}\n本次新增 ${result.inserted} 个职位。` });
      } else {
        setCrawlMessage({
          type: 'success',
          text: `抓取完成！共获取 ${result.total} 个职位，新增 ${result.inserted} 个，重复 ${result.duplicated} 个`,
        });
      }
      setPage(1);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || '未知错误';
      setCrawlMessage({ type: 'error', text: `抓取失败：${msg}` });
    }
  };

  const handleClick = async (job: Job) => {
    const openedWindow = window.open('about:blank', '_blank');
    if (openedWindow) {
      openedWindow.opener = null;
    }

    try {
      const { url, alreadyClicked } = await doClickJob(job.id);
      if (openedWindow) {
        openedWindow.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      if (!alreadyClicked) {
        setCrawlMessage({ type: 'success', text: `已记录：${job.company_name} - ${job.title}` });
        setTimeout(() => setCrawlMessage(null), 3000);
      }
    } catch (err: any) {
      openedWindow?.close();
      const msg = err?.response?.data?.error || err.message || '未知错误';
      setCrawlMessage({ type: 'error', text: `记录点击失败：${msg}` });
    }
  };

  const parseTags = (tags: string): string[] => {
    try {
      return (JSON.parse(tags || '[]') as string[])
        .map(cleanJobText)
        .filter((tag) => tag && !hasUnreadableChars(tag));
    } catch {
      return [];
    }
  };

  const jobs_list = jobs?.records || [];
  const total = jobs?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold text-[#2C3E50]">职位广场</h1>
        <p className="text-sm text-[#7F8C8D] mt-2">一键抓取多平台职位，聚合展示，点击跳转去投递</p>
      </div>

      {/* 抓取区 */}
      <div className="bg-white rounded-xl p-6 shadow-sm mb-5">
        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
          <span className="text-accent">🔍</span> 抓取职位
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-[#7F8C8D] mb-1">平台</label>
            <select
              value={crawlPlatform}
              onChange={(e) => setCrawlPlatform(e.target.value)}
              className="w-full px-3 py-2.5 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer focus:outline-none focus:border-accent"
            >
              {PLATFORM_CONFIG.map((platform) => (
                <option key={platform.name} value={platform.name}>{platform.label}</option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs text-[#7F8C8D] mb-1">搜索关键词</label>
            <input
              value={crawlQuery}
              onChange={(e) => setCrawlQuery(e.target.value)}
              placeholder="例如：前端开发、React"
              className="w-full px-3 py-2.5 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-[#7F8C8D] mb-1">城市</label>
            <select
              value={crawlCity}
              onChange={(e) => setCrawlCity(e.target.value)}
              className="w-full px-3 py-2.5 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer focus:outline-none focus:border-accent"
            >
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#7F8C8D] mb-1">页数</label>
            <select
              value={crawlPages}
              onChange={(e) => setCrawlPages(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer focus:outline-none focus:border-accent"
            >
              <option value={1}>1页（推荐）</option>
              <option value={2}>2页</option>
              <option value={3}>3页</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleCrawl}
          disabled={crawling}
          className="mt-4 px-6 py-2.5 bg-accent text-white rounded-lg hover:bg-[#FF8C5A] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {crawling ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              抓取中...
            </>
          ) : '🚀 开始抓取'}
        </button>

        {crawlMessage && (
          <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${
            crawlMessage.type === 'success' ? 'bg-[#27AE60]/10 text-[#27AE60]' :
            crawlMessage.type === 'error' ? 'bg-[#E74C3C]/10 text-[#E74C3C]' :
            'bg-[#F39C12]/10 text-[#F39C12]'
          }`}>
            <span className="whitespace-pre-line">{crawlMessage.text}</span>
          </div>
        )}
      </div>

      {/* 筛选区 */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-5 flex flex-wrap items-center gap-3">
        <select
          value={filterPlatform}
          onChange={(e) => { setFilterPlatform(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer"
        >
          <option value="all">全部平台</option>
          {PLATFORM_CONFIG.map((platform) => (
            <option key={platform.name} value={platform.name}>{platform.label}</option>
          ))}
        </select>
        <input
          value={filterKeyword}
          onChange={(e) => { setFilterKeyword(e.target.value); setPage(1); }}
          placeholder="搜索职位/公司"
          className="px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm w-[200px] focus:outline-none focus:border-accent"
        />
        <select
          value={filterCity}
          onChange={(e) => { setFilterCity(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer"
        >
          <option value="all">全部城市</option>
          {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={salaryStatus}
          onChange={(e) => { setSalaryStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer"
        >
          <option value="all">全部薪资</option>
          <option value="present">有薪资</option>
          <option value="missing">薪资缺失</option>
        </select>
        <select
          value={companyStatus}
          onChange={(e) => { setCompanyStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer"
        >
          <option value="all">全部公司</option>
          <option value="present">有公司名</option>
          <option value="missing">公司名缺失</option>
        </select>
        <select
          value={clickStatus}
          onChange={(e) => { setClickStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer"
        >
          <option value="all">全部查看状态</option>
          <option value="unclicked">未查看</option>
          <option value="clicked">已查看</option>
        </select>
        <span className="ml-auto text-sm text-[#7F8C8D]">共 {total} 个职位</span>
      </div>

      {/* 职位列表 */}
      {loadingJobs ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-5 h-[120px] skeleton" />
          ))}
        </div>
      ) : jobs_list.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center text-[#7F8C8D]">
          <div className="text-5xl mb-4">📭</div>
          <p className="text-lg mb-2">暂无职位数据</p>
          <p className="text-sm">在上方输入关键词，点击"开始抓取"获取职位</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs_list.map((job) => {
            const tags = parseTags(job.tags);
            const title = cleanJobText(job.title) || job.title;
            const companyName = cleanJobText(job.company_name) || job.company_name;
            const salary = formatSalary(job.salary);
            const location = cleanJobText(job.location);
            const experience = cleanJobText(job.experience);
            const education = cleanJobText(job.education);
            const companySize = cleanJobText(job.company_size);
            const companyIndustry = cleanJobText(job.company_industry);
            return (
              <div
                key={job.id}
                className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-300 flex items-start gap-4"
              >
                {/* 平台标识 */}
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0"
                  style={{ background: PLATFORM_COLORS[job.platform] || '#ccc' }}
                >
                  {PLATFORM_LABELS[job.platform]?.[0] || '?'}
                </div>

                {/* 职位信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-base font-semibold text-[#2C3E50] truncate">{title}</h3>
                    {salary ? (
                      <span className="text-[#FF6B35] font-semibold text-sm shrink-0">{salary}</span>
                    ) : (
                      <span className="text-[#7F8C8D] bg-[#F5F7FA] px-2 py-0.5 rounded text-xs shrink-0">薪资缺失</span>
                    )}
                    {job.clicked ? (
                      <span className="text-xs px-2 py-0.5 bg-[#27AE60]/10 text-[#27AE60] rounded-full shrink-0">已查看</span>
                    ) : null}
                  </div>
                  <div className="text-sm text-[#7F8C8D] mb-2">{companyName}</div>
                  <div className="flex flex-wrap gap-2 text-xs text-[#7F8C8D]">
                    {location && <span className="bg-[#F5F7FA] px-2 py-0.5 rounded">📍 {location}</span>}
                    {experience && <span className="bg-[#F5F7FA] px-2 py-0.5 rounded">{experience}</span>}
                    {education && <span className="bg-[#F5F7FA] px-2 py-0.5 rounded">{education}</span>}
                    {companySize && <span className="bg-[#F5F7FA] px-2 py-0.5 rounded">{companySize}</span>}
                    {companyIndustry && <span className="bg-[#F5F7FA] px-2 py-0.5 rounded">{companyIndustry}</span>}
                  </div>
                </div>

                {/* 操作 */}
                <div className="shrink-0 flex flex-col gap-2 items-end">
                  <span className="text-xs text-[#7F8C8D]">{PLATFORM_LABELS[job.platform]}</span>
                  <button
                    onClick={() => handleClick(job)}
                    className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-[#FF8C5A] transition-colors text-sm font-medium whitespace-nowrap"
                  >
                    {job.clicked ? '再次查看' : '去投递 →'}
                  </button>
                </div>
              </div>
            );
          })}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 pt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-[#E1E8ED] rounded-lg text-sm disabled:opacity-50 hover:border-primary"
              >
                上一页
              </button>
              <span className="text-sm text-[#7F8C8D]">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border border-[#E1E8ED] rounded-lg text-sm disabled:opacity-50 hover:border-primary"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
