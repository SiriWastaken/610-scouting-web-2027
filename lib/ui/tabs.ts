// Navigation tab identities. Each tab has a pastel hue defined in app/globals.css
// (--tab-<name>, --tab-<name>-bg). The hue appears only while the tab is active,
// on the sidebar item and on the icon tile in that page's header. Never in data.
import type { CSSProperties } from "react";

export type TabName = "teams" | "averages" | "strategy" | "boxplot" | "coverage" | "admin";

/** Sets `--tab` and `--tab-bg` for an element and its children; classes read them as `text-(--tab)` and `bg-(--tab-bg)`. */
export function tabVars(tab: TabName): CSSProperties {
  return { "--tab": `var(--tab-${tab})`, "--tab-bg": `var(--tab-${tab}-bg)` } as CSSProperties;
}
