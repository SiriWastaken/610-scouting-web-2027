/** The 610 mark: team number on a green tile, used in the sidebar, header, and sign-in page. */
export function BrandMark({ subtitle = "Crescent Coyotes" }: { subtitle?: string }) {
  return <span className="flex items-center gap-2.5">
    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand font-display text-lg font-bold leading-none text-brand-ink">610</span>
    <span className="leading-tight">
      <span className="block font-display text-[15px] font-bold tracking-[0.06em] text-ink">610 / SCOUTING</span>
      <span className="block text-xs text-muted">{subtitle}</span>
    </span>
  </span>;
}
