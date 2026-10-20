'use client';
import {useId,useLayoutEffect,type MutableRefObject} from 'react';
import {browserBuildHandoff} from './browserBuildHandoff';
import {registerUnarchivedDraftGuard} from './unarchivedDraftGuard';

/** Keep an explicitly opened/dirty model mounted until its domain can preserve it. */
export function useUnarchivedDraftGuard(workflow:string,active:boolean){
  const id=useId();
  useLayoutEffect(()=>{if(!active)return;return registerUnarchivedDraftGuard(browserBuildHandoff,workflow,'unarchived:'+id);},[workflow,active,id]);
}

/** Register before interaction; the event updates this boolean before domain callbacks. */
export function useUnarchivedDraftRefGuard(workflow:string,blocked:MutableRefObject<boolean>){
  const id=useId();
  useLayoutEffect(()=>registerUnarchivedDraftGuard(browserBuildHandoff,workflow,'unarchived:'+id,()=>blocked.current),[workflow,blocked,id]);
}
