import { useEffect, useState } from 'react';
import { useStore } from '../store';

const SALARY_OPTIONS = ['10-15K', '15-20K', '20-30K', '30-50K', '50K以上'];
const LOCATION_OPTIONS = ['北京', '上海', '广州', '深圳', '杭州', '成都'];
const SIZE_OPTIONS = ['不限', '0-20人', '20-100人', '100-500人', '500人以上'];
const EXP_OPTIONS = ['不限', '1-3年', '3-5年', '5-10年', '10年以上'];

export default function DeliverySettings() {
  const { settings, loadingSettings, loadSettings, saveSettings } = useStore();
  const [keywords, setKeywords] = useState('');
  const [salaryRange, setSalaryRange] = useState('15-20K');
  const [location, setLocation] = useState('北京');
  const [companySize, setCompanySize] = useState('不限');
  const [experience, setExperience] = useState('不限');
  const [dailyLimit, setDailyLimit] = useState(50);
  const [interval, setInterval_] = useState(30);
  const [greeting, setGreeting] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  useEffect(() => {
    if (settings) {
      setKeywords(settings.keywords?.join(', ') || '');
      setSalaryRange(settings.salary_range || '15-20K');
      setLocation(settings.locations?.[0] || '北京');
      setCompanySize(settings.company_size || '不限');
      setExperience(settings.experience || '不限');
      setDailyLimit(settings.daily_limit || 50);
      setInterval_(settings.interval_minutes || 30);
      setGreeting(settings.greeting_message || '');
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({
        keywords: keywords.split(/[,，]/).map(k => k.trim()).filter(Boolean),
        salary_range: salaryRange,
        locations: [location],
        company_size: companySize,
        experience: experience,
        daily_limit: dailyLimit,
        interval_minutes: interval,
        greeting_message: greeting,
      });
      alert('设置已保存！');
    } finally {
      setSaving(false);
    }
  };

  if (loadingSettings) {
    return (
      <div>
        <div className="mb-8"><h1 className="text-[28px] font-semibold">投递设置</h1></div>
        <div className="bg-white rounded-xl p-6 h-[300px] skeleton mb-5" />
        <div className="bg-white rounded-xl p-6 h-[250px] skeleton" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold text-[#2C3E50]">投递设置</h1>
        <p className="text-sm text-[#7F8C8D] mt-2">配置职位筛选条件和投递策略</p>
      </div>

      {/* 筛选条件 */}
      <div className="bg-white rounded-xl p-6 shadow-sm mb-5">
        <h3 className="text-lg font-semibold mb-5 pb-3 border-b border-[#E1E8ED]">职位筛选条件</h3>
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">职位关键词</label>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="例如：前端开发、React、Vue"
              className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">期望薪资范围</label>
              <select
                value={salaryRange}
                onChange={(e) => setSalaryRange(e.target.value)}
                className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] cursor-pointer focus:outline-none focus:border-accent"
              >
                {SALARY_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">工作地点</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] cursor-pointer focus:outline-none focus:border-accent"
              >
                {LOCATION_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">公司规模</label>
              <select
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] cursor-pointer focus:outline-none focus:border-accent"
              >
                {SIZE_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">工作经验</label>
              <select
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] cursor-pointer focus:outline-none focus:border-accent"
              >
                {EXP_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 投递策略 */}
      <div className="bg-white rounded-xl p-6 shadow-sm mb-5">
        <h3 className="text-lg font-semibold mb-5 pb-3 border-b border-[#E1E8ED]">投递策略</h3>
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">每日投递上限</label>
              <input
                type="number"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
                className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">投递间隔（分钟）</label>
              <input
                type="number"
                value={interval}
                onChange={(e) => setInterval_(Number(e.target.value))}
                className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">自动打招呼语</label>
            <textarea
              rows={3}
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="您好，我对贵公司的职位很感兴趣，希望能有机会进一步沟通..."
              className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors resize-none"
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-5 px-5 py-2.5 bg-accent text-white rounded-lg hover:bg-[#FF8C5A] transition-colors font-medium disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  );
}
