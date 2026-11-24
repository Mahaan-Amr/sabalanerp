import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { WorkspaceProvider } from '../../src/contexts/WorkspaceContext';
import { WorkspaceNavigation } from '../../src/components/WorkspaceNavigation';

const router: AppRouterInstance = {
  back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {},
};

function Fixture() {
  const [pathname, setPathname] = useState('/dashboard/accounting/contracts');
  // Start with the provider unresolved while the sidebar already sees the Accounting URL.
  const [workspacePath, setWorkspacePath] = useState('/dashboard');
  const { login, logout } = useAuth();

  function navigate(path: string) {
    setPathname(path);
    setWorkspacePath(path);
  }

  async function changeActor() {
    await logout();
    await login('manager', 'fixture');
  }

  return (
    <PathnameContext.Provider value={workspacePath}>
      <WorkspaceProvider>
        <PathnameContext.Provider value={pathname}>
          <button onClick={() => navigate('/dashboard')}>Main dashboard</button>
          <button onClick={() => navigate('/dashboard/crm')}>CRM workspace</button>
          <button onClick={() => navigate('/dashboard/sales')}>Sales workspace</button>
          <button onClick={() => void changeActor()}>Change actor</button>
          <WorkspaceNavigation />
        </PathnameContext.Provider>
      </WorkspaceProvider>
    </PathnameContext.Provider>
  );
}

createRoot(document.getElementById('fixture')!).render(
  <AppRouterContext.Provider value={router}>
    <AuthProvider><Fixture /></AuthProvider>
  </AppRouterContext.Provider>,
);
