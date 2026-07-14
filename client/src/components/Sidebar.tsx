import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  History,
  Link2,
  Menu,
  X,
} from 'lucide-react';

const navItems = [
  { path: '/', label: '求职 Agent', icon: Bot },
  { path: '/jobs', label: '职位广场', icon: BriefcaseBusiness },
  { path: '/platforms', label: '平台管理', icon: Link2 },
  { path: '/history', label: '查看记录', icon: History },
  { path: '/dashboard', label: '数据概览', icon: BarChart3 },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="fixed left-4 top-4 z-[150] flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white lg:hidden"
        onClick={() => setOpen((value) => !value)}
        title={open ? '关闭导航' : '打开导航'}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside
        className={`fixed left-0 top-0 z-[100] h-screen w-[240px] border-r border-white/10 bg-[#193653] text-white transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-white">
            <Bot size={21} />
          </div>
          <div>
            <div className="text-base font-semibold">求职 Agent</div>
            <div className="text-xs text-white/55">LangGraph 工作台</div>
          </div>
        </div>

        <nav className="px-3 py-5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `mb-1 flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                    isActive
                      ? 'bg-white/14 text-white'
                      : 'text-white/70 hover:bg-white/8 hover:text-white'
                  }`
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {open && (
        <button
          type="button"
          aria-label="关闭导航"
          className="fixed inset-0 z-[90] bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
