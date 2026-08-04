import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { PLATFORM_LABELS } from '../types';

export default function PlatformManagement() {
  const { platforms, loadingPlatforms, loadPlatforms, doLoginPlatform, doLogoutPlatform } = useStore();
  const [loginLoading, setLoginLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => { loadPlatforms({ verify: true }); }, []);

  const handleLoginPlatform = async (name: string) => {
    const label = PLATFORM_LABELS[name] || name;
    setLoginLoading(name);
    setMessage({
      type: 'info',
      text: name === 'shixiseng'
        ? '正在打开实习僧登录窗口，可使用密码、短信、微信、微博或 QQ 登录。'
        : `正在打开浏览器，请在弹出的 Chrome 窗口中完成 ${label} 登录...`,
    });
    try {
      await doLoginPlatform(name);
      setMessage({ type: 'success', text: `${label} 登录成功！现在可以去职位广场抓取职位了。` });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || '未知错误';
      setMessage({ type: 'error', text: `登录失败：${msg}` });
    } finally {
      setLoginLoading(null);
    }
  };

  const handleLogout = async (name: string) => {
    if (!window.confirm(`确定要退出 ${PLATFORM_LABELS[name]} 登录吗？`)) return;
    await doLogoutPlatform(name);
    setMessage({ type: 'info', text: `${PLATFORM_LABELS[name]} 已退出登录` });
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold text-[#2C3E50]">平台管理</h1>
        <p className="text-sm text-[#7F8C8D] mt-2">登录招聘平台，授权职位抓取</p>
      </div>

      {/* 提示信息 */}
      <div className="bg-[#1E3A5F]/5 border border-[#1E3A5F]/20 rounded-xl p-4 mb-5 text-sm text-[#2C3E50]">
        <div className="flex items-start gap-3">
          <span className="text-xl">💡</span>
          <div>
            <p className="font-medium mb-1">使用说明</p>
            <ol className="list-decimal list-inside text-[#7F8C8D] space-y-0.5 text-xs">
              <li>点击"浏览器登录"后，会弹出 Chrome 浏览器窗口</li>
              <li>在浏览器里按平台要求扫码、验证码或账号密码完成登录</li>
              <li>登录成功后系统会保存该平台 cookies 登录态</li>
              <li>之后在"职位广场"抓取职位时自动复用登录状态</li>
            </ol>
          </div>
        </div>
      </div>

      {message && (
        <div className={`mb-5 px-4 py-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-[#27AE60]/10 text-[#27AE60]' :
          message.type === 'error' ? 'bg-[#E74C3C]/10 text-[#E74C3C]' :
          'bg-[#F39C12]/10 text-[#F39C12]'
        }`}>
          {message.text}
        </div>
      )}

      {loadingPlatforms ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-6 h-[140px] skeleton" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {platforms.map((p) => (
            <div
              key={p.name}
              className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300"
            >
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold text-white shrink-0"
                  style={{ background: p.color }}
                >
                  {p.logo}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{p.label}</h3>
                  <p className="text-xs text-[#7F8C8D]">
                    {!p.requiresLoginForCrawl
                      ? '公开职位无需登录，投递前可登录'
                      : p.loginType === 'qrcode' ? '扫码/浏览器登录' : '浏览器登录'}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  p.bound
                    ? 'bg-[#27AE60]/10 text-[#27AE60]'
                    : 'bg-[#E1E8ED] text-[#7F8C8D]'
                }`}>
                  {p.bound ? '● 已登录' : '○ 未登录'}
                </span>
              </div>

              {p.bound && p.lastLogin && (
                <p className="text-xs text-[#7F8C8D] mb-3">
                  最后登录：{p.lastLogin}
                </p>
              )}

              <div className="flex gap-2">
                {p.bound ? (
                  <>
                    <button
                      onClick={() => handleLoginPlatform(p.name)}
                      disabled={Boolean(loginLoading)}
                      className="px-4 py-2 text-sm rounded-lg border border-[#E1E8ED] hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                    >
                      {loginLoading === p.name ? '等待登录...' : '重新登录'}
                    </button>
                    <button
                      onClick={() => handleLogout(p.name)}
                      disabled={Boolean(loginLoading)}
                      className="px-4 py-2 text-sm rounded-lg border border-[#E1E8ED] text-[#E74C3C] hover:bg-[#E74C3C]/10 transition-colors disabled:opacity-50"
                    >
                      退出登录
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleLoginPlatform(p.name)}
                    disabled={Boolean(loginLoading)}
                    className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-[#FF8C5A] transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {loginLoading === p.name && (
                      <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    )}
                    {loginLoading === p.name ? '等待登录...' : '浏览器登录'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
