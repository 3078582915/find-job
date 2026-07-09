import { STATUS_LABELS } from '../types';

interface StatusBadgeProps {
  status: string;
}

const colorMap: Record<string, string> = {
  delivered: 'bg-[#1E3A5F]/10 text-[#1E3A5F]',
  viewed: 'bg-[#27AE60]/10 text-[#27AE60]',
  pending: 'bg-[#F39C12]/10 text-[#F39C12]',
  rejected: 'bg-[#E74C3C]/10 text-[#E74C3C]',
  interview: 'bg-[#8E44AD]/10 text-[#8E44AD]',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${colorMap[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}
