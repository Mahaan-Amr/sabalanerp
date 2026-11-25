import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { ThemeProvider } from '../../src/contexts/ThemeContext';
import { WorkspaceProvider } from '../../src/contexts/WorkspaceContext';
import { SessionContinuationHost } from '../../src/components/SessionContinuationHost';
import { authAPI } from '../../src/lib/api';
import DashboardLayout from '../../src/app/dashboard/layout';

const router: AppRouterInstance = {
  back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {},
};
const searchParams = new URLSearchParams();

function Fixture() {
  const [pathname, setPathname] = useState('/dashboard/accounting/contracts');
  const { login, logout } = useAuth();

  async function changeActor() {
    await logout();
    await login('manager', 'fixture');
  }

  return (
    <PathnameContext.Provider value={pathname}>
      <SearchParamsContext.Provider value={searchParams}>
        <ThemeProvider>
          <WorkspaceProvider>
            <button onClick={() => setPathname('/dashboard')}>Main dashboard</button>
            <button onClick={() => setPathname('/dashboard/crm')}>CRM workspace</button>
            <button onClick={() => setPathname('/dashboard/sales')}>Sales workspace</button>
            <button onClick={() => void changeActor()}>Change actor</button>
            <button onClick={() => void authAPI.getMe().catch(() => undefined)}>Check session</button>
            <button onClick={() => void logout()}>Sign out</button>
            <DashboardLayout><p>Active dashboard route</p></DashboardLayout>
          </WorkspaceProvider>
        </ThemeProvider>
      </SearchParamsContext.Provider>
    </PathnameContext.Provider>
  );
}

createRoot(document.getElementById('fixture')!).render(
  <AppRouterContext.Provider value={router}>
    <AuthProvider><SessionContinuationHost><Fixture /></SessionContinuationHost></AuthProvider>
  </AppRouterContext.Provider>,
);
