import { useState, useEffect } from "react";
import { DataTable } from "@/components/data-table";
import { fetchTeamAggregates } from "@/services/couchbase";

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    fetchTeamAggregates().then(setTeams);
  }, []);

  return <div className="mx-auto max-w-[1320px]">
    <PageIntro eyebrow="01 / TEAM INDEX" title="Teams" description="A working view of teams observed at the event, with the core scouting signals used for match planning." />

    <DataTable teams={teams} />
  </div>;
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-7 max-w-2xl"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">{eyebrow}</div><h1 className="text-3xl font-medium tracking-tight text-[var(--foreground)]">{title}</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p></div>;
}