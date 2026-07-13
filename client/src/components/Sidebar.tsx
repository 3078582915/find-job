import { useState } from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { path: '/', label: '仪表盘', icon: '📊' },
  { path: '/jobs', label: '职位广场', icon: '🔍' },
  { path: '/platforms', label: '平台管理', icon: '🔗' },
  { path: '/history', label: '查看记录', icon: '📋' },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 移动端菜单按钮 */}
      <button
        className="fixed top-5 left-5 w-10 h-10 bg-primary rounded-lg z-[150] items-center justify-center text-white text-xl lg:hidden flex"
        onClick={() => setOpen(!open)}
      >
        ☰
      </button>

      <aside
        className={`w-[260px] bg-gradient-to-b from-primary to-[#152A45] text-white py-6 fixed h-screen left-0 top-0 z-[100] transition-transform duration-300 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-6 pb-8 border-b border-white/10">
          <div className="flex items-center gap-3 text-xl font-semibold">
            <div className="w-10 h-10 bg-accent rounded-[10px] flex items-center justify-center text-2xl">
              📄
            </div>
            <span>简历投递助手</span>
          </div>
        </div>

        <nav className="py-6">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 cursor-pointer transition-all duration-300 border-l-[3px] ${
                  isActive
                    ? 'bg-white/15 border-l-accent'
                    : 'border-l-transparent hover:bg-white/10'
                }`
              }
            >
              <span className="w-5 h-5 flex items-center justify-center">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 移动端遮罩 */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-[90] lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
