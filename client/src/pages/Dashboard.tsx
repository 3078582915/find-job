import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import StatCard from '../components/StatCard';
import { PLATFORM_LABELS } from '../types';
import { cleanJobText, formatSalary } from '../utils/display';

export default function Dashboard() {
  const navigate = useNavigate();
  const { statistics, loadingStats, records, loadStatistics, loadRecords } = useStore();

  useEffect(() => {
    loadStatistics();
    loadRecords({ size: 5 });
  }, []);

  const recentRecords = records?.records?.slice(0, 5) || [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold text-[#2C3E50]">仪表盘</h1>
        <p className="text-sm text-[#7F8C8D] mt-2">多平台职位聚合数据概览</p>
      </div>

      {/* 统计卡片 */}
      {loadingStats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-6 h-[120px] skeleton" />
          ))}
        </div>
      ) : statistics ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          <StatCard value={statistics.interviewCount} label="今日新职位" icon="📋" color="primary" />
          <StatCard value={statistics.pendingCount} label="总职位数" icon="📊" color="accent" />
          <StatCard value={statistics.todayCount} label="今日查看" icon="👀" color="success" />
          <StatCard value={statistics.totalCount} label="总查看数" icon="🎯" color="warning" />
        </div>
      ) : null}

      {/* 快捷操作 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <button
          onClick={() => navigate('/jobs')}
          className="bg-accent border-2 border-accent text-white rounded-xl p-5 flex items-center gap-4 hover:bg-[#FF8C5A] hover:-translate-y-0.5 hover:shadow-md transition-all duration-300"
        >
          <div className="w-12 h-12 rounded-[10px] bg-white/20 flex items-center justify-center text-2xl">🔍</div>
          <span className="font-medium">抓取职位</span>
        </button>
        {[
          { label: '平台登录', icon: '🔗', to: '/platforms' },
          { label: '投递设置', icon: '⚙️', to: '/settings' },
          { label: '查看记录', icon: '📈', to: '/history' },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={() => navigate(btn.to)}
            className="bg-white border-2 border-[#E1E8ED] rounded-xl p-5 flex items-center gap-4 hover:border-accent hover:bg-accent/5 transition-all duration-300"
          >
            <div className="w-12 h-12 rounded-[10px] bg-[#F5F7FA] text-primary flex items-center justify-center text-2xl">
              {btn.icon}
            </div>
            <span className="font-medium text-[#2C3E50]">{btn.label}</span>
          </button>
        ))}
      </div>

      {/* 最近查看记录 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex justify-between items-center px-6 py-5 border-b border-[#E1E8ED]">
          <h3 className="text-lg font-semibold">最近查看的职位</h3>
          <button
            onClick={() => navigate('/history')}
            className="px-3 py-1.5 text-sm rounded-lg border border-[#E1E8ED] hover:border-primary hover:text-primary transition-colors"
          >
            查看全部
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-[#F5F7FA] text-sm text-[#7F8C8D]">
              <th className="text-left px-6 py-3 font-medium">公司</th>
              <th className="text-left px-6 py-3 font-medium">职位</th>
              <th className="text-left px-6 py-3 font-medium">平台</th>
              <th className="text-left px-6 py-3 font-medium">薪资</th>
              <th className="text-left px-6 py-3 font-medium">时间</th>
            </tr>
          </thead>
          <tbody>
            {recentRecords.map((item) => (
              <tr key={item.id} className="border-b border-[#E1E8ED] hover:bg-accent/[0.02] transition-colors">
                <td className="px-6 py-4 font-medium">{cleanJobText(item.company_name) || item.company_name}</td>
                <td className="px-6 py-4">{cleanJobText(item.position_name) || item.position_name}</td>
                <td className="px-6 py-4">{PLATFORM_LABELS[item.platform] || item.platform}</td>
                <td className="px-6 py-4">{formatSalary(item.salary)}</td>
                <td className="px-6 py-4 text-sm text-[#7F8C8D]">{item.clicked_at}</td>
              </tr>
            ))}
            {recentRecords.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-[#7F8C8D]">
                  暂无查看记录，去<a href="/jobs" className="text-accent">职位广场</a>看看吧
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
