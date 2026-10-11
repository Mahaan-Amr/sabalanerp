import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { useCrossWorkspaceDutyCount } from '../../src/features/cross-workspace-duties/useCrossWorkspaceDutyCount';

const Counter = ({ workspace }: { workspace: string }) => <output>{useCrossWorkspaceDutyCount(workspace)}</output>;
function Fixture() {
  const [workspace, setWorkspace] = useState('sales');
  const [mounted, setMounted] = useState(true);
  const auth = useAuth();
  return <>
    <button onClick={() => setWorkspace('accounting')}>accounting</button>
    <button onClick={() => void auth.logout()}>logout</button>
    <button onClick={() => void auth.login('fixture', 'fixture')}>login</button>
    <button onClick={() => setMounted(value => !value)}>mount</button>
    {mounted && <><Counter workspace={workspace} /><Counter workspace={workspace} /></>}
  </>;
}
createRoot(document.getElementById('fixture')!).render(<AuthProvider><Fixture /></AuthProvider>);
