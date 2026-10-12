import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { AuditPage } from './pages/AuditPage';
import { BriefPage } from './pages/BriefPage';
import { CheckInPage } from './pages/CheckInPage';
import { DeskPage } from './pages/DeskPage';
import { TodayPage } from './pages/TodayPage';
import { WorklistPage } from './pages/WorklistPage';
import { useRoute, type Page } from './state/router';

const TITLES: Record<Page, string> = {
  today: 'Today',
  desk: 'Follow-up desk',
  worklist: 'Worklist',
  checkin: 'Registration',
  audit: 'Audit trail',
  brief: 'About this prototype',
};

export function App() {
  const { page } = useRoute();

  useEffect(() => {
    document.title = `${TITLES[page]} · Dobara`;
    window.scrollTo(0, 0);
  }, [page]);

  return (
    <Layout page={page}>
      {page === 'today' && <TodayPage />}
      {page === 'desk' && <DeskPage />}
      {page === 'worklist' && <WorklistPage />}
      {page === 'checkin' && <CheckInPage />}
      {page === 'audit' && <AuditPage />}
      {page === 'brief' && <BriefPage />}
    </Layout>
  );
}
