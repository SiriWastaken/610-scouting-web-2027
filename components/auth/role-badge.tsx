import { ROLE_LABELS, type AccountStatus, type Role } from "@/lib/auth/roles";

const tone: Record<Role, string> = {
  MEMBER: "border-[var(--line)] text-[var(--muted)]",
  SCOUT: "border-[var(--line)] text-[var(--foreground)]",
  SCOUT_LEAD: "border-[rgba(120,192,145,0.35)] text-[var(--green)]",
  ADMIN: "border-[rgba(120,192,145,0.6)] bg-[rgba(120,192,145,0.1)] text-[var(--green)]",
  ROOT: "border-amber-400/60 bg-amber-400/10 text-amber-300",
};

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone[role]}`}>{ROLE_LABELS[role]}</span>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const style = status === "active" ? "text-[var(--green)]" : status === "pending" ? "text-amber-300" : "text-red-400";
  const symbol = status === "active" ? "●" : status === "pending" ? "◐" : "⊘";
  return <span className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider ${style}`}><span aria-hidden="true">{symbol}</span>{status}</span>;
}
