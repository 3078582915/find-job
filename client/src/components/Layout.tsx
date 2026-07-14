import type { ReactNode } from 'react';
import Sidebar from './Sidebar';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-h-screen flex-1 p-5 pt-16 lg:ml-[240px] lg:p-6">
        {children}
      </main>
    </div>
  );
}
