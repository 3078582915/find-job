import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '../types';
import { cleanJobText, formatSalary } from '../utils/display';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

export default function DeliveryHistory() {
  const { records, statistics, loadingRecords, loadRecords, loadStatistics } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<'records' | 'statistics'>('records');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [clickedDate, setClickedDate] = useState(searchParams.get('clickedDate') || 'all');

  useEffect(() => {
    loadStatistics();
  }, []);

  useEffect(() => {
    loadRecords({
      size: 50,
      platform: platformFilter,
      clickedDate: clickedDate === 'today' ? 'today' : undefined,
    });
  }, [platformFilter, clickedDate]);

  useEffect(() => {
    const next = searchParams.get('clickedDate') || 'all';
    setClickedDate(next);
    setTab('records');
  }, [searchParams]);

  const handleClickedDateChange = (value: string) => {
    setClickedDate(value);
    const next = new URLSearchParams(searchParams);
    if (value === 'today') next.set('clickedDate', 'today');
    else next.delete('clickedDate');
    setSearchParams(next);
  };

  const recs = records?.records || [];

  const trendData = (statistics?.trendData || []).map((d) => ({
    name: d.date?.slice(5) || d.date,
    count: d.count,
  }));

  const pieData = (statistics?.platformDistribution || []).map((d) => ({
    name: PLATFORM_LABELS[d.platform] || d.platform,
    value: d.count,
    color: PLATFORM_COLORS[d.platform] || '#ccc',
  }));

  const statusData = statistics?.statusDistribution || [];
  const clickedCount = statusData.find((s) => s.status === 'clicked')?.count || 0;
  const unclickedCount = statusData.find((s) => s.status === 'unclicked')?.count || 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold text-[#2C3E50]">查看记录</h1>
        <p className="text-sm text-[#7F8C8D] mt-2">查看你点击过的职位和历史统计</p>
      </div>

      <div className="flex gap-2 mb-5 bg-[#F5F7FA] p-2 rounded-lg w-fit">
        {(['records', 'statistics'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === t ? 'bg-white text-[#2C3E50] shadow-sm' : 'text-[#7F8C8D]'
            }`}
          >
            {t === 'records' ? '查看记录' : '统计分析'}
          </button>
        ))}
      </div>

      {/* 查看记录表格 */}
      {tab === 'records' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex justify-between items-center px-6 py-5 border-b border-[#E1E8ED] flex-wrap gap-3">
            <h3 className="text-lg font-semibold">查看历史</h3>
            <div className="flex flex-wrap gap-2">
              <select
                value={clickedDate}
                onChange={(e) => handleClickedDateChange(e.target.value)}
                className="w-[120px] px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer"
              >
                <option value="all">全部时间</option>
                <option value="today">今日查看</option>
              </select>
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="w-[120px] px-3 py-2 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] text-sm cursor-pointer"
              >
                <option value="all">全部平台</option>
                {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          {loadingRecords ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 skeleton" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F5F7FA] text-sm text-[#7F8C8D]">
                    <th className="text-left px-6 py-3 font-medium">公司</th>
                    <th className="text-left px-6 py-3 font-medium">职位</th>
                    <th className="text-left px-6 py-3 font-medium">平台</th>
                    <th className="text-left px-6 py-3 font-medium">薪资</th>
                    <th className="text-left px-6 py-3 font-medium">地点</th>
                    <th className="text-left px-6 py-3 font-medium">时间</th>
                    <th className="text-left px-6 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recs.map((item) => (
                    <tr key={item.id} className="border-b border-[#E1E8ED] hover:bg-accent/[0.02] transition-colors">
                      <td className="px-6 py-4 font-medium">{cleanJobText(item.company_name) || item.company_name}</td>
                      <td className="px-6 py-4">{cleanJobText(item.position_name) || item.position_name}</td>
                      <td className="px-6 py-4">
                        <span
                          className="inline-block w-5 h-5 rounded text-white text-xs text-center leading-5 mr-1"
                          style={{ background: PLATFORM_COLORS[item.platform] || '#ccc' }}
                        >
                          {PLATFORM_LABELS[item.platform]?.[0] || '?'}
                        </span>
                        {PLATFORM_LABELS[item.platform] || item.platform}
                      </td>
                      <td className="px-6 py-4 text-[#FF6B35]">{formatSalary(item.salary)}</td>
                      <td className="px-6 py-4 text-sm">{cleanJobText(item.location) || '-'}</td>
                      <td className="px-6 py-4 text-sm text-[#7F8C8D]">{item.clicked_at}</td>
                      <td className="px-6 py-4">
                        {item.job_url && (
                          <a
                            href={item.job_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-accent hover:underline"
                          >
                            再次查看 →
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-[#7F8C8D]">
                        暂无查看记录，去<a href="/jobs" className="text-accent">职位广场</a>看看吧
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 统计分析 */}
      {tab === 'statistics' && (
        <div className="space-y-5">
          {/* 趋势图 */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold mb-5">查看趋势（最近7天）</h3>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E1E8ED" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#7F8C8D" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#7F8C8D" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#FF6B35" radius={[4, 4, 0, 0]} name="查看数" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] bg-[#F5F7FA] rounded-lg flex items-center justify-center text-[#7F8C8D]">
                暂无数据
              </div>
            )}
          </div>

          {/* 平台分布饼图 */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold mb-5">职位平台分布</h3>
            {pieData.length > 0 ? (
              <div className="flex flex-col md:flex-row items-center">
                <ResponsiveContainer width="100%" height={280} className="max-w-[400px]">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={120}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color || '#ccc'} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[280px] bg-[#F5F7FA] rounded-lg flex items-center justify-center text-[#7F8C8D]">
                暂无数据
              </div>
            )}
          </div>

          {/* 查看状态统计 */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold mb-5">查看状态统计</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-[#27AE60]">
                <div className="text-3xl font-bold text-[#2C3E50] mb-1">{clickedCount}</div>
                <div className="text-sm text-[#7F8C8D]">已查看</div>
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-[#E1E8ED]">
                <div className="text-3xl font-bold text-[#2C3E50] mb-1">{unclickedCount}</div>
                <div className="text-sm text-[#7F8C8D]">未查看</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
