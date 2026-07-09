interface StatCardProps {
  value: number;
  label: string;
  icon: string;
  color: 'primary' | 'accent' | 'success' | 'warning' | 'danger';
}

const colorMap = {
  primary: 'from-[#1E3A5F] to-[#2E5A8F]',
  accent: 'from-[#FF6B35] to-[#FF8C5A]',
  success: 'from-[#27AE60] to-[#2ECC71]',
  warning: 'from-[#F39C12] to-[#F5AB35]',
  danger: 'from-[#E74C3C] to-[#EC7063]',
};

export default function StatCard({ value, label, icon, color }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl p-6 relative overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1">
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${colorMap[color]}`} />
      <div className="text-4xl font-bold text-[#2C3E50] mb-2">{value}</div>
      <div className="text-sm text-[#7F8C8D]">{label}</div>
      <div className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center text-2xl opacity-20">
        {icon}
      </div>
    </div>
  );
}
