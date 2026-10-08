'use client';

import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { EmptyState, rowClass, tableClass, theadClass } from '@/components/ui/kit';
import { useTeamDocuments } from '@/lib/realtime/hooks';
import { docTeam, toCardReport, type CardReport } from '@/lib/data/team-documents';

const thCls = 'px-4 py-2.5 text-left';
const tdCls = 'px-4 py-3 text-sm text-ink';

export function CardReportsTable({ teamNumber }: { teamNumber: string | number }) {
  const teamKey = String(teamNumber);
  const { docs, loading } = useTeamDocuments('reports', Number(teamNumber) || undefined, new RegExp(`^report_(?:card_)?${teamKey}_`));
  const reports = useMemo(() => docs.filter((doc) => docTeam(doc) === teamKey).map(toCardReport), [docs, teamKey]);

  if (loading && !reports.length) return <p className="px-5 py-8 text-center text-sm text-muted">Pulling card data…</p>;
  if (!reports.length) {
    return (
      <EmptyState icon={ShieldCheck} title="No Card Reports">
        No card violations recorded for this team. Clean driving!
      </EmptyState>
    );
  }

  return <CardTable reports={reports} />;
}

function CardTable({ reports }: { reports: CardReport[] }) {
  return (
    <div className="overflow-x-auto">
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th className={thCls}>Match</th>
            <th className={thCls}>Team</th>
            <th className={thCls}>Card</th>
            <th className={thCls}>Rule</th>
            <th className={thCls}>Notes</th>
            <th className={`${thCls} text-right`}>Timestamp</th>
          </tr>
        </thead>
        <tbody>{reports.map((report) => <CardRow key={report.sourceId} report={report} />)}</tbody>
      </table>
    </div>
  );
}

function CardRow({ report }: { report: CardReport }) {
  return (
    <tr className={rowClass}>
      <td className={`${tdCls} font-mono`}>{report.match}</td>
      <td className={`${tdCls} font-mono`}>{report.team}</td>
      <td className={`${tdCls} font-semibold`}>
        <span className="inline-flex items-center gap-2">
          <span className={`h-4 w-3 rounded-[2px] ${report.cardType === 'Yellow' ? 'bg-[#f5c518]' : 'bg-alliance-red'}`} aria-hidden="true" />
          {report.cardType}
        </span>
      </td>
      <td className={`${tdCls} font-mono`}>{report.ruleViolation}</td>
      <td className={tdCls}>{report.notes}</td>
      <td className={`${tdCls} text-right text-xs text-muted`}>{report.timestamp ? new Date(report.timestamp).toLocaleString() : 'N/A'}</td>
    </tr>
  );
}
