'use client';

import type { ReactNode } from 'react';
import { selectClass } from '@/components/ui/kit';

export function Section({
  title,
  aside,
  children,
  className = '',
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function NativeSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string | null;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
}) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${selectClass} h-11 text-base sm:text-sm`}>
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** A value in the alliance's colour, with the word, so it never relies on colour alone. */
export function AllianceTag({ alliance }: { alliance?: string }) {
  const side = alliance?.toLowerCase();
  const color = side === 'blue' ? 'text-alliance-blue' : side === 'red' ? 'text-alliance-red' : 'text-muted';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${color}`}>
      <span className="h-3 w-1.5 rounded-sm bg-current" aria-hidden="true" />
      {side === 'blue' ? 'Blue alliance' : side === 'red' ? 'Red alliance' : 'Alliance unknown'}
    </span>
  );
}
