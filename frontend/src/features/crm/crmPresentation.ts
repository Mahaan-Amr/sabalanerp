/** CRM routes also serve Sales and Partner entry points; retain their presentation. */
export function usesCrmPresentation(pathname: string, params: { get: (name: string) => string | null }) {
  return (pathname === '/dashboard/crm' || pathname.startsWith('/dashboard/crm/'))
    && params.get('workspace') !== 'sales'
    && params.get('partnerContract') !== '1'
    && params.get('returnTo') !== 'contract';
}
