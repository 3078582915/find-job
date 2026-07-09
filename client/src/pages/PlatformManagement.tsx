import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { PLATFORM_LABELS } from '../types';

export default function PlatformManagement() {
  const { platforms, loadingPlatforms, loadPlatforms, doLoginBoss, doLogoutPlatform } = useStore();
  const [loginLoading, setLoginLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => { loadPlatforms(); }, []);

  const handleLoginBoss = async () => {
    setLoginLoading(true);
    setMessage({ type: 'info', text: '正在打开浏览器，请在弹出的浏览器窗口中扫码登录 BOSS直聘...' });
    try {
      await doLoginBoss();
      setMessage({ type: 'success', text: 'BOSS直聘登录成功！现在可以去职位广场抓取职位了。' });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || '未知错误';
      setMessage({ type: 'error', text: `登录失败：${msg}` });
    } finally {
      setLoginLoading(false);
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
              <li>点击"扫码登录"后，会弹出浏览器窗口</li>
              <li>在浏览器中用 BOSS直聘 App 扫码完成登录</li>
              <li>登录成功后关闭浏览器，系统自动保存登录状态</li>
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
                    {p.loginType === 'qrcode' ? '扫码登录' : '账号密码登录'}
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
                {p.name === 'boss' ? (
                  p.bound ? (
                    <>
                      <button
                        onClick={() => handleLoginBoss()}
                        disabled={loginLoading}
                        className="px-4 py-2 text-sm rounded-lg border border-[#E1E8ED] hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                      >
                        重新登录
                      </button>
                      <button
                        onClick={() => handleLogout(p.name)}
                        className="px-4 py-2 text-sm rounded-lg border border-[#E1E8ED] text-[#E74C3C] hover:bg-[#E74C3C]/10 transition-colors"
                      >
                        退出登录
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleLoginBoss}
                      disabled={loginLoading}
                      className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-[#FF8C5A] transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {loginLoading && (
                        <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      )}
                      {loginLoading ? '等待登录...' : '扫码登录'}
                    </button>
                  )
                ) : (
                  <button
                    disabled
                    className="px-4 py-2 text-sm rounded-lg border border-[#E1E8ED] text-[#7F8C8D] cursor-not-allowed"
                  >
                    即将支持
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
