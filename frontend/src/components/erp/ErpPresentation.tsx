'use client';

import React from 'react';

type PresentationScope = 'default' | 'workspace';

const ErpPresentationContext = React.createContext<PresentationScope>('default');

/** Carries workspace presentation through body-mounted overlays without changing behavior. */
export function ErpPresentationProvider({ scope, children }: React.PropsWithChildren<{ scope: PresentationScope }>) {
  return <ErpPresentationContext.Provider value={scope}>{children}</ErpPresentationContext.Provider>;
}

export function useErpPresentationScope() {
  return React.useContext(ErpPresentationContext);
}
