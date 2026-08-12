import { useAuth } from '../auth/AuthProvider';
import { DailyKpis } from './components/DailyKpis';
import { MyDayHeader } from './components/MyDayHeader';
import { TodayAgenda } from './components/TodayAgenda';
import { UrgentSignatures } from './components/UrgentSignatures';
import { RecentFiles } from './components/RecentFiles';
import { AIRecommendation } from './components/AIRecommendation';
import { FollowUpReminders } from './components/FollowUpReminders';
import { UrgentTasks } from './components/UrgentTasks';
import { PraviaAiCard } from './components/PraviaAiCard';
import { FinancialSummary } from './components/FinancialSummary';
import type { WidgetSection } from './myDay.types';
import { useMyDay } from './useMyDay';
import styles from './MyDayPage.module.css';

export function MyDayPage() {
  const { user } = useAuth();
  const { status, data, error, retry } = useMyDay();
  const loading = status === 'loading';
  const sectionError = (section: WidgetSection) => data?.errors[section] ?? (status === 'error' ? error ?? undefined : undefined);

  if (!user) return null;

  return (
    <div className={styles.page}>
      <MyDayHeader name={user.name} dateValue={data?.date} />
      <DailyKpis data={data} loading={loading} />
      <div className={styles.dashboardGrid}>
        <UrgentTasks items={data?.urgentTasks ?? []} loading={loading} error={sectionError('tasks')} onRetry={retry} className={styles.tasks} />
        <TodayAgenda items={data?.agenda ?? []} loading={loading} error={sectionError('agenda')} onRetry={retry} className={styles.agenda} />
        <UrgentSignatures items={data?.urgentSignatures ?? []} loading={loading} error={sectionError('signatures')} onRetry={retry} className={styles.signatures} />
        <AIRecommendation insight={data?.recommendation} loading={loading} error={sectionError('recommendation')} onRetry={retry} className={styles.recommendation} />
        <RecentFiles items={data?.recentFiles ?? []} loading={loading} error={sectionError('recentFiles')} onRetry={retry} className={styles.recent} />
        <FollowUpReminders items={data?.reminders ?? []} loading={loading} error={sectionError('reminders')} onRetry={retry} className={styles.reminders} />
        <PraviaAiCard canViewFinance={data?.permissions.canViewFinance === true} className={styles.ai} />
      </div>
      {data?.permissions.canViewFinance === true && (
        <FinancialSummary finance={data.finance} loading={loading} error={sectionError('finance')} onRetry={retry} />
      )}
    </div>
  );
}
