'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { EmptyState, rowClass, tableClass, theadClass } from '@/components/ui/kit';
import { useRealtimeDocuments, useRealtimeResync } from '@/lib/realtime/hooks';
import { NO_DOCS, docTeam, queryDashboardDocuments, toCardReport, unwrapDoc } from '@/lib/data/team-documents';

export function CardReportsTable({ teamNumber }: { teamNumber: string | number }) {
  const teamKey = String(teamNumber);
  const [loaded, setLoaded] = useState<{ team: string; docs: Record<string, unknown>[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloads, setReloads] = useState(0);
  useRealtimeResync(() => setReloads((count) => count + 1));

  useEffect(() => {
    let isMounted = true;

    const loadCards = async () => {
      if (!teamNumber) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const allReports = await queryDashboardDocuments('reports', Number(teamNumber));
        if (isMounted) setLoaded({ team: String(teamNumber), docs: allReports.map(unwrapDoc) });
      } catch (error) {
        console.error('Error loading card reports:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadCards();
    return () => {
      isMounted = false;
    };
  }, [teamNumber, reloads]);

  const reportDocs = useRealtimeDocuments(loaded?.team === teamKey ? loaded.docs : NO_DOCS, new RegExp(`^report_(?:card_)?${teamKey}_`));
  const reports = useMemo(
    () => reportDocs.filter((doc) => docTeam(doc) === teamKey).map(toCardReport),
    [reportDocs, teamKey]
  );

  if (loading && !reports.length) {
    return <p className="px-5 py-8 text-center text-sm text-muted">Pulling card data…</p>;
  }

  if (!reports.length) {
    return (
      <EmptyState icon={ShieldCheck} title="No Card Reports">
        No card violations recorded for this team. Clean driving!
      </EmptyState>
    );
  }

  const thCls = 'px-4 py-2.5 text-left';
  const tdCls = 'px-4 py-3 text-sm text-ink';

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
        <tbody>
          {reports.map((r) => (
            <tr key={r.sourceId} className={rowClass}>
              <td className={`${tdCls} font-mono`}>{r.match}</td>
              <td className={`${tdCls} font-mono`}>{r.team}</td>
              <td className={`${tdCls} font-semibold`}>
                <span className="inline-flex items-center gap-2">
                  <span className={`h-4 w-3 rounded-[2px] ${r.cardType === 'Yellow' ? 'bg-[#f5c518]' : 'bg-alliance-red'}`} aria-hidden="true" />
                  {r.cardType}
                </span>
              </td>
              <td className={`${tdCls} font-mono`}>{r.ruleViolation}</td>
              <td className={tdCls}>{r.notes}</td>
              <td className={`${tdCls} text-right text-xs text-muted`}>
                {r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/A'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
