'use client';

import type { ReactNode } from 'react';
import { Check, FileQuestion, X } from 'lucide-react';
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
          <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${source === 'Observed' ? 'bg-teleop-soft text-teleop' : 'bg-surface-2 text-muted'}`}>
            {source}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function InfoBlock({ label, value, highlight, wide }: { label: string; value?: string; highlight?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className={labelClass}>{label}</dt>
      <dd className={`mt-0.5 text-sm leading-6 ${!value ? 'text-muted' : highlight ? 'font-semibold text-accent-text' : 'text-ink'}`}>
        {value || 'N/A'}
      </dd>
    </div>
  );
}

function BadgeBlock({ label, value }: { label: string; value?: string }) {
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

interface RatingProps { label: string; value?: number; max: number; descriptions?: Record<number, string> }

/** 1..max boxes with the chosen one solid and the lower ones tinted. */
function ratingBoxClass(n: number, value?: number) {
  if (!value || n > value) return 'bg-surface-2 text-muted';
  return n === value ? 'bg-accent text-accent-foreground' : 'bg-accent-muted text-accent-text';
}

function RatingBlock({ label, value, max, descriptions }: RatingProps) {
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-1.5">
        <div className="flex gap-1" role="img" aria-label={value ? `${value} out of ${max}` : 'Not rated'}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <span key={n} className={`flex h-7 flex-1 items-center justify-center rounded-sm text-xs font-bold ${ratingBoxClass(n, value)}`}>{n}</span>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{descriptions && value ? descriptions[value] : value ? `${value} of ${max}` : 'Not rated'}</p>
      </dd>
    </div>
  );
}

export function ExpertScoutReport({ pitData, teamNumber }: { pitData?: PitData; teamNumber: number }) {
  if (!pitData) return <NoPitInterview teamNumber={teamNumber} />;

  const photoUri = resolvePhotoUri(pitData.robotPhoto);

  return (
    <Section
      title="Expert Scout Report"
      aside={pitData.scoutName ? <span className="text-xs text-muted">Interviewed by {pitData.scoutName}</span> : undefined}
    >
      <div className={photoUri ? 'grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}>
        {photoUri && <RobotPhoto src={photoUri} teamNumber={teamNumber} />}
        <DrivetrainSection pit={pitData} />
      </div>

      <div className="border-t border-line">
        <SubsystemsSection pit={pitData} />
        <CapabilitiesSection pit={pitData} />
        <DriverSection pit={pitData} />
        <GettingToKnowSection pit={pitData} />
        <ObservationsSection pit={pitData} />
        <LegacySection pit={pitData} />
      </div>
    </Section>
  );
}

function NoPitInterview({ teamNumber }: { teamNumber: number }) {
  return (
    <Section title="Expert Scout Report">
      <EmptyState icon={FileQuestion} title={`No pit interview for ${teamNumber} yet`}>
        Swing by their pit! The report appears here as soon as the interview is synced.
      </EmptyState>
    </Section>
  );
}

function RobotPhoto({ src, teamNumber }: { src: string; teamNumber: number }) {
  return (
    <div className="border-b border-line bg-surface-2 p-3 md:border-b-0 md:border-r">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Team ${teamNumber} robot`} className="mx-auto h-64 w-full rounded-md object-contain" />
    </div>
  );
}

type SectionProps = { pit: PitData };

function DrivetrainSection({ pit }: SectionProps) {
  return (
    <ReportSection title="Drivetrain" source="Ask">
      <InfoBlock label="Drivetrain" value={capitalizeSelector(pit.drivetrainType || pit.driveBase)} />
      <InfoBlock label="Swerve Orientation" value={capitalizeSelector(pit.swerveOrientation)} />
      <InfoBlock label="Drive Motors" value={capitalizeSelector(pit.driveMotors)} />
      <InfoBlock label="Dimensions + Bumper" value={capitalizeSelector(pit.drivetrainDimensions)} />
      <InfoBlock label="Weight (lbs)" value={pit.robotWeight} />
      <InfoBlock label="Height (in)" value={pit.robotHeight} />
    </ReportSection>
  );
}

function SubsystemsSection({ pit }: SectionProps) {
  return (
    <ReportSection title="Subsystems" source="Ask">
      <InfoBlock label="Top (Corral)" value={capitalizeSelector(pit.openOrClosedTop)} />
      <BadgeBlock label="Functional Intake?" value={pit.funcIntake} />
      <InfoBlock label="Type of Shooter" value={capitalizeSelector(pit.typeOfShooter)} />
      <InfoBlock label="Type of Indexer" value={capitalizeSelector(pit.typeOfIndexer)} />
      <InfoBlock label="Hopper Capacity" value={pit.hopperCapacity?.toString()} />
    </ReportSection>
  );
}

function CapabilitiesSection({ pit }: SectionProps) {
  return (
    <ReportSection title="Capabilities" source="Interview">
      <BadgeBlock label="Over Bump?" value={capitalizeSelector(pit.canDriveOverBump)} />
      <BadgeBlock label="Under Trench?" value={capitalizeSelector(pit.canGoUnderTrench)} />
      <InfoBlock label="Scoring Zones (Claimed)" value={capitalizeSelector(pit.scoringZones)} />
      <InfoBlock label="Auton Start Position" value={capitalizeSelector(pit.autonStartPosition)} />
      <InfoBlock label="Climb Capability" value={capitalizeSelector(pit.climbCapability)} highlight />
      <BadgeBlock label="Can Pass Fuel?" value={capitalizeSelector(pit.canPassFuel)} />
      <BadgeBlock label="Practiced Passing?" value={capitalizeSelector(pit.hasPassedBefore)} />
    </ReportSection>
  );
}

function DriverSection({ pit }: SectionProps) {
  return (
    <ReportSection title="Driver & Strategy" source="Interview">
      <RatingBlock label="Driver Years Exp (1-4)" value={pit.driverYearsExperience || Number(pit.driverExperience)} max={4} />
      <RatingBlock label="Defense Comfort (1-5)" value={pit.defenseComfortDetailed || pit.defenseComfort} max={5} descriptions={DEFENSE_LABELS} />
      <RatingBlock label="Human Player Confidence (1-5)" value={pit.humanPlayerConfidence} max={5} descriptions={HP_LABELS} />
    </ReportSection>
  );
}

function GettingToKnowSection({ pit }: SectionProps) {
  return (
    <ReportSection title="Getting to know them" source="Interview">
      <InfoBlock label="Favorite Part of Robot" value={capitalizeSelector(pit.favoriteRobotPart)} />
      <InfoBlock label="Team Fun Fact" value={capitalizeSelector(pit.teamFunFact)} />
      <InfoBlock label="Team Goals" value={capitalizeSelector(pit.teamGoals)} wide />
      {pit.hasRobotName && (
        <>
          <BadgeBlock label="Has Robot Name?" value={pit.hasRobotName} />
          {pit.hasRobotName.toLowerCase() === 'yes' && (
            <>
              <InfoBlock label="Robot Name" value={pit.robotName} />
              <InfoBlock label="Name Origin" value={pit.robotNameOrigin} />
            </>
          )}
        </>
      )}
    </ReportSection>
  );
}

function ObservationsSection({ pit }: SectionProps) {
  return (
    <ReportSection title="Pit Scouter Observations" source="Observed">
      <BadgeBlock label="Zones Verified?" value={capitalizeSelector(pit.scoringZonesVerified)} />
      <BadgeBlock label="Vision Verified?" value={capitalizeSelector(pit.hasVisionTracking)} />
      <InfoBlock label="Scoring Aids Observed" value={capitalizeSelector(pit.scoringAids)} />
      <BadgeBlock label="Scoring Aids Verified?" value={capitalizeSelector(pit.scoringAidsVerified)} />
      <BadgeBlock label="Jank or Tippy?" value={capitalizeSelector(pit.robotJankOrTippy)} />
      <InfoBlock label="Red Flags" value={capitalizeSelector(pit.redFlags)} highlight={!!pit.redFlags} />
      <InfoBlock label="Extra Comments" value={capitalizeSelector(pit.extraComments)} wide />
    </ReportSection>
  );
}

function LegacySection({ pit }: SectionProps) {
  if (!(pit.qualStrategy || pit.playoffStrategy || pit.robotUnique || pit.teamUnique || pit.idealAlliance)) return null;
  return (
    <ReportSection title="Legacy Data" source="Legacy">
      {pit.qualStrategy && <InfoBlock label="Qual Strategy" value={pit.qualStrategy} />}
      {pit.playoffStrategy && <InfoBlock label="Playoff Strategy" value={pit.playoffStrategy} />}
      {pit.robotUnique && <InfoBlock label="Robot Uniqueness" value={pit.robotUnique} />}
      {pit.teamUnique && <InfoBlock label="Team Uniqueness" value={pit.teamUnique} />}
      {pit.idealAlliance && <InfoBlock label="Dream Alliance" value={pit.idealAlliance} highlight />}
    </ReportSection>
  );
}
