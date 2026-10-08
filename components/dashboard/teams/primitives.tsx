// Small pieces shared by the Teams panels: the bordered Section and the alliance tag.
'use client';

import type { ReactNode } from 'react';

/** A bordered panel with a title row and optional right-hand content. */
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
