'use client';

import type { ReactNode } from 'react';
import { Check, FileQuestion, MessageSquareText, X } from 'lucide-react';
import { EmptyState, labelClass } from '@/components/ui/kit';
import type { PitData } from '@/lib/data/team-documents';
import { Section } from './primitives';

function resolvePhotoUri(robotPhoto: PitData['robotPhoto']): string | null {
  if (!robotPhoto) return null;
  if (typeof robotPhoto === 'string') return robotPhoto;
  const base64 = robotPhoto.content ?? robotPhoto.data;
  const mime = robotPhoto.contentType ?? robotPhoto.content_type ?? 'image/jpeg';
  if (base64) {
    const clean = base64.replace(/^data:[^;]+;base64,/, '');
    return `data:${mime};base64,${clean}`;
  }
  return null;
}

function capitalizeSelector(value?: string): string | undefined {
  if (!value) return value;
  return value
    .split(/[\s/]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' / ');
}

const DEFENSE_LABELS: Record<number, string> = {
  1: 'Never practiced',
  2: 'Played once or twice',
  3: 'Decent, fine with either role',
  4: 'Strong, played several matches',
  5: 'Practiced & willing to dedicate',
};
const HP_LABELS: Record<number, string> = {
  1: 'No confidence / practice',
  2: 'Some practice, not confident',
  3: 'Moderate confidence',
  4: 'Confident & experienced',
  5: 'Extremely confident & practiced',
};

/** One group of the interview. `source` says whether the answer was asked or seen, which matters when trusting it. */
function ReportSection({ title, source, children }: { title: string; source?: 'Ask' | 'Interview' | 'Observed' | 'Legacy'; children: ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-4 first:border-t-0 sm:px-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {source && (
          <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em] ${source === 'Observed' ? 'bg-teleop-soft text-teleop' : 'bg-surface-2 text-muted'}`}>
            {source}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function InfoBlock({ label, value, highlight, wide }: { label: string; value?: string; half?: boolean; highlight?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className={labelClass}>{label}</dt>
      <dd className={`mt-0.5 text-sm leading-6 ${!value ? 'text-muted' : highlight ? 'font-semibold text-accent-text' : 'text-ink'}`}>
        {value || 'N/A'}
      </dd>
    </div>
  );
}

function BadgeBlock({ label, value }: { label: string; value?: string; half?: boolean }) {
  const isYes = value?.toLowerCase() === 'yes';
  const isNo = value?.toLowerCase() === 'no';
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className={`mt-0.5 flex items-center gap-1.5 text-sm ${isYes ? 'font-semibold text-good' : isNo ? 'font-semibold text-bad' : 'text-muted'}`}>
        {isYes ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : isNo ? <X className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : null}
        {isYes ? 'Yes' : isNo ? 'No' : 'N/A'}
      </dd>
    </div>
  );
}

function RatingBlock({
  label,
  value,
  max,
  descriptions,
}: {
  label: string;
  value?: number;
  max: number;
  descriptions?: Record<number, string>;
}) {
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-1.5">
        <div className="flex gap-1" role="img" aria-label={value ? `${value} out of ${max}` : 'Not rated'}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className={`flex h-7 flex-1 items-center justify-center rounded text-xs font-bold ${
                value && n <= value ? (n === value ? 'bg-accent text-accent-foreground' : 'bg-accent-muted text-accent-text') : 'bg-surface-2 text-muted'
              }`}
            >
              {n}
            </span>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{descriptions && value ? descriptions[value] : value ? `${value} of ${max}` : 'Not rated'}</p>
      </dd>
    </div>
  );
}

export function ExpertScoutReport({ pitData, teamNumber }: { pitData?: PitData; teamNumber: number }) {
  if (!pitData) {
    return (
      <Section title="Expert Scout Report" icon={MessageSquareText}>
        <EmptyState icon={FileQuestion} title={`No pit interview for ${teamNumber} yet`}>
          Swing by their pit! The report appears here as soon as the interview is synced.
        </EmptyState>
      </Section>
    );
  }

  const photoUri = resolvePhotoUri(pitData.robotPhoto);

  return (
    <Section
      title="Expert Scout Report"
      icon={MessageSquareText}
      aside={pitData.scoutName ? <span className="text-xs text-muted">Interviewed by {pitData.scoutName}</span> : undefined}
    >
      <div className={photoUri ? 'grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}>
        {photoUri && (
          <div className="border-b border-line bg-surface-2 p-3 md:border-b-0 md:border-r">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUri} alt={`Team ${teamNumber} robot`} className="mx-auto h-64 w-full rounded-md object-contain" />
          </div>
        )}
        <ReportSection title="Drivetrain" source="Ask">
          <InfoBlock label="Drivetrain" value={capitalizeSelector(pitData.drivetrainType || pitData.driveBase)} />
          <InfoBlock label="Swerve Orientation" value={capitalizeSelector(pitData.swerveOrientation)} />
          <InfoBlock label="Drive Motors" value={capitalizeSelector(pitData.driveMotors)} />
          <InfoBlock label="Dimensions + Bumper" value={capitalizeSelector(pitData.drivetrainDimensions)} />
          <InfoBlock label="Weight (lbs)" value={pitData.robotWeight} />
          <InfoBlock label="Height (in)" value={pitData.robotHeight} />
        </ReportSection>
      </div>

      <div className="border-t border-line">
        <ReportSection title="Subsystems" source="Ask">
          <InfoBlock label="Top (Corral)" value={capitalizeSelector(pitData.openOrClosedTop)} />
          <BadgeBlock label="Functional Intake?" value={pitData.funcIntake} />
          <InfoBlock label="Type of Shooter" value={capitalizeSelector(pitData.typeOfShooter)} />
          <InfoBlock label="Type of Indexer" value={capitalizeSelector(pitData.typeOfIndexer)} />
          <InfoBlock label="Hopper Capacity" value={pitData.hopperCapacity?.toString()} />
        </ReportSection>

        <ReportSection title="Capabilities" source="Interview">
          <BadgeBlock label="Over Bump?" value={capitalizeSelector(pitData.canDriveOverBump)} />
          <BadgeBlock label="Under Trench?" value={capitalizeSelector(pitData.canGoUnderTrench)} />
          <InfoBlock label="Scoring Zones (Claimed)" value={capitalizeSelector(pitData.scoringZones)} />
          <InfoBlock label="Auton Start Position" value={capitalizeSelector(pitData.autonStartPosition)} />
          <InfoBlock label="Climb Capability" value={capitalizeSelector(pitData.climbCapability)} highlight />
          <BadgeBlock label="Can Pass Fuel?" value={capitalizeSelector(pitData.canPassFuel)} />
          <BadgeBlock label="Practiced Passing?" value={capitalizeSelector(pitData.hasPassedBefore)} />
        </ReportSection>

        <ReportSection title="Driver & Strategy" source="Interview">
          <RatingBlock
            label="Driver Years Exp (1-4)"
            value={pitData.driverYearsExperience || Number(pitData.driverExperience)}
            max={4}
          />
          <RatingBlock
            label="Defense Comfort (1-5)"
            value={pitData.defenseComfortDetailed || pitData.defenseComfort}
            max={5}
            descriptions={DEFENSE_LABELS}
          />
          <RatingBlock label="Human Player Confidence (1-5)" value={pitData.humanPlayerConfidence} max={5} descriptions={HP_LABELS} />
        </ReportSection>

        <ReportSection title="Getting to know them" source="Interview">
          <InfoBlock label="Favorite Part of Robot" value={capitalizeSelector(pitData.favoriteRobotPart)} />
          <InfoBlock label="Team Fun Fact" value={capitalizeSelector(pitData.teamFunFact)} />
          <InfoBlock label="Team Goals" value={capitalizeSelector(pitData.teamGoals)} wide />
          {pitData.hasRobotName && (
            <>
              <BadgeBlock label="Has Robot Name?" value={pitData.hasRobotName} />
              {pitData.hasRobotName.toLowerCase() === 'yes' && (
                <>
                  <InfoBlock label="Robot Name" value={pitData.robotName} />
                  <InfoBlock label="Name Origin" value={pitData.robotNameOrigin} />
                </>
              )}
            </>
          )}
        </ReportSection>

        <ReportSection title="Pit Scouter Observations" source="Observed">
          <BadgeBlock label="Zones Verified?" value={capitalizeSelector(pitData.scoringZonesVerified)} />
          <BadgeBlock label="Vision Verified?" value={capitalizeSelector(pitData.hasVisionTracking)} />
          <InfoBlock label="Scoring Aids Observed" value={capitalizeSelector(pitData.scoringAids)} />
          <BadgeBlock label="Scoring Aids Verified?" value={capitalizeSelector(pitData.scoringAidsVerified)} />
          <BadgeBlock label="Jank or Tippy?" value={capitalizeSelector(pitData.robotJankOrTippy)} />
          <InfoBlock label="Red Flags" value={capitalizeSelector(pitData.redFlags)} highlight={!!pitData.redFlags} />
          <InfoBlock label="Extra Comments" value={capitalizeSelector(pitData.extraComments)} wide />
        </ReportSection>

        {(pitData.qualStrategy || pitData.playoffStrategy || pitData.robotUnique || pitData.teamUnique || pitData.idealAlliance) && (
          <ReportSection title="Legacy Data" source="Legacy">
            {pitData.qualStrategy && <InfoBlock label="Qual Strategy" value={pitData.qualStrategy} />}
            {pitData.playoffStrategy && <InfoBlock label="Playoff Strategy" value={pitData.playoffStrategy} />}
            {pitData.robotUnique && <InfoBlock label="Robot Uniqueness" value={pitData.robotUnique} />}
            {pitData.teamUnique && <InfoBlock label="Team Uniqueness" value={pitData.teamUnique} />}
            {pitData.idealAlliance && <InfoBlock label="Dream Alliance" value={pitData.idealAlliance} highlight />}
          </ReportSection>
        )}
      </div>
    </Section>
  );
}
