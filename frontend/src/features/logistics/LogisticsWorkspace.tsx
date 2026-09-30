import type { ComponentProps, ReactNode } from 'react';
import { ErpPage, ErpPresentationProvider } from '@/components/erp';

/** Compose existing workspace surfaces without changing shared navigation or documents. */
export function LogisticsWorkspace({ children, printPreview = false }: { children: ReactNode; printPreview?: boolean }) {
  return (
    <ErpPresentationProvider scope={printPreview ? "default" : "workspace"}><div className={printPreview ? 'min-w-0' : 'sds-neumorphic-scope sds-neumorphic-workflow-scope min-w-0 pb-6'}>
      {children}
    </div></ErpPresentationProvider>
  );
}

export function LogisticsPage({ printPreview = false, ...props }: ComponentProps<typeof ErpPage> & { printPreview?: boolean }) {
  return <LogisticsWorkspace printPreview={printPreview}><ErpPage {...props} /></LogisticsWorkspace>;
}
