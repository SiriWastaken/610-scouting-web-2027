// The team mark (number on a green tile, product name and team name), from app.config.ts. Used in the sidebar, the
// phone header and the sign-in page.
import { appConfig } from "@/app.config";

/** The team mark: team number on a green tile, used in the sidebar, header, and sign-in page. */
export function BrandMark({ subtitle = appConfig.team.name }: { subtitle?: string }) {
  return <span className="flex items-center gap-2.5">
    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-base font-bold leading-none text-brand-ink">{appConfig.team.number}</span>
    <span className="leading-tight">
      <span className="block text-[15px] font-semibold leading-5 text-ink">{appConfig.team.productName}</span>
      <span className="block text-xs text-muted">{subtitle}</span>
    </span>
  </span>;
}
