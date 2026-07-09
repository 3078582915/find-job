import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl p-8 max-w-[500px] w-[90%] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-5">{title}</h2>
        {children}
        {footer && <div className="flex gap-3 justify-end mt-6">{footer}</div>}
      </div>
    </div>
  );
}
