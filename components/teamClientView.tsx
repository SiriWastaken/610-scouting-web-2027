'use client'

import React, { useState, useMemo } from 'react';

// --- Types based on provided schemas ---
interface MatchData {
  start?: { match: number; alliance: string; position?: string; scoutName?: string; };
  auto?: { fuelScored: number; fuelFed: number; hangLevel: number; paths?: string[]; markers?: any[]; fieldFlipped?: boolean; };
  teleop?: { fuelscored: number; fuelpassed: number; fuelPlowed: number; teleopFuelFed: number; L1hang: number; missedL1: number; L2hang: number; missedL2: number; L3hang: number; missedL3: number; playedDefense: number; breakDuration: number; breakSeverity: number | string; general?: string; };
}

interface TeamStats {
  team: number;
  matches: MatchData[];
  avgFuelScored: number;
  avgClimbLevel: number;
  autopathCount: number;
  pitData?: any; // Inherited from ExpertScoutReport structure
  cardReports?: any;
}

export default function TeamsClientView({ initialTeams, teamNames }: { initialTeams: TeamStats[], teamNames: Record<number, string> }) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedMatchIdx, setSelectedMatchIdx] = useState<number | null>(null);

  const selectedTeam = useMemo(() => initialTeams.find(t => t.team === selectedTeamId) || null, [initialTeams, selectedTeamId]);
  const selectedMatch = useMemo(() => (selectedTeam && selectedMatchIdx !== null) ? selectedTeam.matches[selectedMatchIdx] : null, [selectedTeam, selectedMatchIdx]);

  return (
    <div className="flex flex-col gap-6 w-full">
      
      {/* --- Team Selector[cite: 20] --- */}
      <section className="bg-[var(--panel)] border border-[var(--line)] rounded-xl p-5">
        <label className="block text-[var(--foreground)] text-lg font-semibold mb-3">Select Team:</label>
        <select 
          className="w-full bg-[var(--background)] border border-[var(--line)] text-[var(--foreground)] p-3 rounded-lg focus:outline-none focus:border-[var(--green)] transition-colors"
          value={selectedTeamId || ''}
          onChange={(e) => { setSelectedTeamId(Number(e.target.value)); setSelectedMatchIdx(null); }}
        >
          <option value="" disabled>Select a Team</option>
          {initialTeams.map(t => (
            <option key={t.team} value={t.team}>
              {t.team} - {teamNames[t.team] || 'Unknown'}
            </option>
          ))}
        </select>
      </section>

      {selectedTeam && (
        <div className="flex flex-col gap-8 animate-fade-in">
          
          {/* --- Team Overview[cite: 21] --- */}
          <section className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-6 flex flex-col gap-6">
             <div className="text-center border-b border-[var(--line)] pb-4">
                <h2 className="text-3xl font-bold text-[var(--foreground)]">{selectedTeam.team} {teamNames[selectedTeam.team] ? ` - ${teamNames[selectedTeam.team]}` : ''}</h2>
                <p className="text-[var(--muted)] text-xs uppercase tracking-widest mt-2">Performance Analytics</p>
                <div className="mt-3 inline-block bg-[var(--green-strong)] text-white px-4 py-1.5 rounded-full text-xs font-bold">
                  {selectedTeam.matches.length} Matches Recorded
                </div>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard title="Avg Fuel Scored" value={selectedTeam.avgFuelScored?.toFixed(1) || '0.0'} />
                <StatCard title="Avg Climb Level" value={selectedTeam.avgClimbLevel?.toFixed(1) || '0.0'} />
                <StatCard title="Auto Paths" value={selectedTeam.autopathCount || '0'} />
             </div>
          </section>

          {/* --- Chart Visualizer[cite: 19] --- */}
          <section className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-6 overflow-hidden">
            <h3 className="text-xl font-bold mb-4">Performance Trends</h3>
            <div className="h-64 w-full flex items-end gap-2 border-b border-[var(--line)] pb-2 relative">
               {/* Simplified Web CSS Bar Chart Implementation mapping matches to bars */}
               {selectedTeam.matches.map((m, i) => {
                  const total = (m.auto?.fuelScored || 0) + (m.teleop?.fuelscored || 0);
                  const maxTotal = Math.max(...selectedTeam.matches.map(x => (x.auto?.fuelScored || 0) + (x.teleop?.fuelscored || 0)), 1);
                  const heightPct = (total / maxTotal) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center group relative h-full">
                       <div 
                         className="w-full bg-[var(--green)] rounded-t-sm opacity-80 hover:opacity-100 transition-all duration-300"
                         style={{ height: `${heightPct}%`, minHeight: '4px' }}
                       />
                       <span className="text-[10px] text-[var(--muted)] mt-2 absolute -bottom-6">M{m.start?.match}</span>
                       
                       {/* Tooltip on hover */}
                       <div className="opacity-0 group-hover:opacity-100 absolute -top-10 bg-[var(--panel-raised)] border border-[var(--line)] text-xs p-2 rounded pointer-events-none z-10 shadow-lg whitespace-nowrap">
                         Match {m.start?.match}: {total} pts
                       </div>
                    </div>
                  )
               })}
            </div>
          </section>

          {/* --- Match Details & Selection[cite: 22, 23] --- */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-6">
              <label className="block text-[var(--foreground)] text-lg font-semibold mb-3">Inspect Match:</label>
              <select 
                className="w-full bg-[var(--background)] border border-[var(--line)] text-[var(--foreground)] p-3 rounded-lg focus:outline-none focus:border-[var(--green)]"
                value={selectedMatchIdx !== null ? selectedMatchIdx : ''}
                onChange={(e) => setSelectedMatchIdx(Number(e.target.value))}
              >
                <option value="" disabled>Select a Match</option>
                {selectedTeam.matches.map((m, idx) => (
                  <option key={idx} value={idx}>Match {m.start?.match || idx + 1}</option>
                ))}
              </select>
            </div>

            {selectedMatch ? (
              <div className="bg-[var(--panel-raised)] border border-[var(--line)] rounded-2xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-white">Match {selectedMatch.start?.match || 'N/A'}</h3>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${selectedMatch.start?.alliance === 'blue' ? 'bg-blue-600' : 'bg-red-600'}`}>
                    {selectedMatch.start?.alliance?.toUpperCase() || 'UNK'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-[var(--background)] p-3 rounded-lg border border-[var(--line)]">
                    <p className="text-[var(--muted)] text-xs mb-1">Scout</p>
                    <p className="font-semibold">{selectedMatch.start?.scoutName || 'Unknown'}</p>
                  </div>
                  <div className="bg-[var(--background)] p-3 rounded-lg border border-[var(--line)]">
                    <p className="text-[var(--muted)] text-xs mb-1">Fuel Scored</p>
                    <p className="font-semibold text-[var(--green)]">{selectedMatch.teleop?.fuelscored || 0}</p>
                  </div>
                </div>
                {selectedMatch.teleop?.general && (
                  <div className="bg-[var(--background)] p-3 rounded-lg border border-[var(--line)] text-sm text-[var(--muted)]">
                    {selectedMatch.teleop.general}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[var(--panel-raised)] border border-[var(--line)] border-dashed rounded-2xl p-6 flex items-center justify-center text-[var(--muted)]">
                Select a match to view details.
              </div>
            )}
          </section>

          {/* --- Auto Path Visualization[cite: 27] --- */}
          {selectedMatch && selectedMatch.auto?.paths && (
             <section className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-6">
                <h3 className="text-xl font-bold mb-4">Auto Pathing</h3>
                <div className="relative w-full aspect-[2/1] bg-[var(--background)] border border-[var(--line)] rounded-lg overflow-hidden flex items-center justify-center">
                  <svg viewBox="0 0 1000 500" className="w-full h-full absolute inset-0 z-10">
                    {selectedMatch.auto.paths.map((p, i) => (
                      <path key={i} d={p} stroke="var(--green)" strokeWidth="4" fill="none" strokeLinecap="round" />
                    ))}
                    {selectedMatch.auto.markers?.map((m, i) => (
                       <circle key={i} cx={m.x * 1000} cy={m.y * 500} r="12" fill={m.type === 'pickup' ? '#0066B3' : '#ED1C24'} stroke="#fff" strokeWidth="2" />
                    ))}
                  </svg>
                  <p className="text-[var(--muted)] z-0 italic">Field Map Background Rendered Here</p>
                </div>
             </section>
          )}

          {/* --- Match Data Table[cite: 24] --- */}
          <section className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl overflow-hidden w-full">
            <div className="px-6 py-4 border-b border-[var(--line)] bg-[var(--panel-raised)] flex justify-between items-center">
              <h3 className="text-lg font-bold">Match Performance Log</h3>
              <span className="bg-[var(--green-strong)] px-3 py-1 rounded-full text-xs font-bold text-white">
                {selectedTeam.matches.length} Matches
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--background)] border-b border-[var(--line)] text-[var(--muted)] text-xs uppercase tracking-wider">
                    <th className="p-4 border-r border-[var(--line)]">Match</th>
                    <th className="p-4 text-center">Auto Score</th>
                    <th className="p-4 text-center">Auto Fed</th>
                    <th className="p-4 text-center">Teleop Score</th>
                    <th className="p-4 text-center border-r border-[var(--line)]">Teleop Pass</th>
                    <th className="p-4 text-center">Def?</th>
                    <th className="p-4 text-center">Broke</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {selectedTeam.matches.map((m, i) => (
                    <tr key={i} className="border-b border-[var(--line)] hover:bg-[var(--panel-raised)] transition-colors">
                      <td className="p-4 border-r border-[var(--line)] font-bold">{m.start?.match || '-'}</td>
                      <td className="p-4 text-center text-blue-400">{m.auto?.fuelScored || 0}</td>
                      <td className="p-4 text-center text-blue-200">{m.auto?.fuelFed || 0}</td>
                      <td className="p-4 text-center text-[var(--green)] font-bold">{m.teleop?.fuelscored || 0}</td>
                      <td className="p-4 text-center border-r border-[var(--line)] text-gray-300">{m.teleop?.fuelpassed || 0}</td>
                      <td className="p-4 text-center">{m.teleop?.playedDefense ? 'Yes' : '-'}</td>
                      <td className="p-4 text-center text-orange-400">{m.teleop?.breakDuration ? `${m.teleop.breakDuration}s` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* --- Expert Scout Report[cite: 25] --- */}
          <section className="bg-[var(--panel)] border border-emerald-500/30 rounded-2xl overflow-hidden">
             <div className="bg-emerald-900/20 p-4 border-b border-emerald-500/30">
                <h3 className="text-emerald-400 text-lg font-bold uppercase tracking-wider">Expert Scout Report</h3>
             </div>
             <div className="p-6 text-[var(--muted)]">
                {selectedTeam.pitData ? (
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <DetailBlock label="Drivetrain" value={selectedTeam.pitData.drivetrainType} />
                      <DetailBlock label="Weight & Height" value={`${selectedTeam.pitData.robotWeight} lbs / ${selectedTeam.pitData.robotHeight} in`} />
                      <DetailBlock label="Scoring Zones" value={selectedTeam.pitData.scoringZones} />
                      <DetailBlock label="Climb Capability" value={selectedTeam.pitData.climbCapability} highlight />
                   </div>
                ) : (
                   <p className="italic text-center py-4">No Expert Scout Interview recorded for Team {selectedTeam.team}.</p>
                )}
             </div>
          </section>

          {/* --- Card Reports Table[cite: 26] --- */}
          <section className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-6">
            <h3 className="text-lg font-bold mb-4">Card Violations</h3>
            {!selectedTeam.cardReports || selectedTeam.cardReports.length === 0 ? (
               <div className="bg-[var(--background)] p-6 rounded-xl border border-dashed border-[var(--line)] text-center text-[var(--muted)]">
                 No card violations recorded for this team.
               </div>
            ) : (
               <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
                 <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className="bg-[var(--background)] border-b border-[var(--line)] text-[var(--muted)] text-xs uppercase tracking-wider">
                       <th className="p-3">Match</th>
                       <th className="p-3 text-center">Card</th>
                       <th className="p-3">Rule</th>
                       <th className="p-3 w-1/2">Notes</th>
                     </tr>
                   </thead>
                   <tbody className="text-sm text-[var(--foreground)]">
                     {selectedTeam.cardReports.map((c, i) => (
                       <tr key={i} className="border-b border-[var(--line)] hover:bg-[var(--panel-raised)]">
                         <td className="p-3">{c.match}</td>
                         <td className={`p-3 text-center font-bold ${c.cardType === 'Yellow' ? 'text-yellow-500' : 'text-red-500'}`}>{c.cardType}</td>
                         <td className="p-3">{c.ruleViolation}</td>
                         <td className="p-3 text-[var(--muted)] text-xs">{c.notes}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            )}
          </section>

        </div>
      )}
    </div>
  );
}

// Helper generic components for standardizing UI blocks
function StatCard({ title, value }: { title: string, value: string | number }) {
  return (
    <div className="bg-[var(--background)] p-4 rounded-xl border border-[var(--line)] text-center flex flex-col items-center justify-center">
      <span className="text-[var(--muted)] text-xs font-bold uppercase tracking-wider mb-2">{title}</span>
      <span className="text-2xl font-mono text-[var(--green)] font-bold">{value}</span>
    </div>
  )
}

function DetailBlock({ label, value, highlight }: { label: string, value?: string, highlight?: boolean }) {
  return (
    <div>
      <span className="text-[var(--muted)] text-xs font-bold uppercase block mb-1">{label}</span>
      <div className={`p-3 rounded-lg border ${highlight ? 'bg-emerald-900/10 border-emerald-500/30 text-emerald-300' : 'bg-[var(--background)] border-[var(--line)] text-[var(--foreground)]'}`}>
         {value || 'N/A'}
      </div>
    </div>
  )
}