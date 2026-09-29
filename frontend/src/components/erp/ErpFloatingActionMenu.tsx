'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { FaEllipsisV } from 'react-icons/fa';
import { ErpButton, ErpSheet, useErpPresentationScope, type ErpAction } from './index';

/** An anchored overlay that escapes scroll containers; a focused sheet on mobile. */
export default function ErpFloatingActionMenu({ label, actions }: { label: string; actions: ErpAction[] }) {
  const [open, setOpen] = React.useState(false);
  const [mobile, setMobile] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 8, top: 8, maxHeight: 400 });
  const trigger = React.useRef<HTMLButtonElement>(null);
  const popup = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const scope = useErpPresentationScope();

  const close = React.useCallback((restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }, []);

  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  React.useLayoutEffect(() => {
    if (!open || mobile) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor || !popup.current) return;
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const height = popup.current.scrollHeight;
      const below = window.innerHeight / zoom - anchor.bottom / zoom - 16;
      const above = anchor.top / zoom - 16;
      const flip = below < height && above > below;
      const maxHeight = Math.max(44, flip ? above : below);
      const width = Math.min(240, window.innerWidth / zoom - 16);
      setPosition({
        left: Math.max(8, Math.min(anchor.left / zoom, window.innerWidth / zoom - width - 8)),
        top: flip ? Math.max(8, anchor.top / zoom - Math.min(height, maxHeight) - 8) : anchor.bottom / zoom + 8,
        maxHeight,
      });
    };
    place();
    popup.current?.querySelector<HTMLElement>('button:not([disabled]),a[href]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, mobile, close]);

  const content = actions.map(action => (
    <ErpButton {...action} key={action.label} variant="ghost" className="w-full justify-start border-0"
      onClick={() => { close(); action.onClick?.(); }} />
  ));

  return <>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}
      className="sds-action sds-action-outline relative inline-flex h-11 w-11 shrink-0 items-center justify-center p-0">
      <FaEllipsisV aria-hidden="true" className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2" />
    </button>
    {open && !mobile && createPortal(
      <div ref={popup} id={id} role="dialog" aria-label={label} dir="rtl"
        className={`${scope === 'workspace' ? 'sds-neumorphic-scope ' : ''}fixed z-[90] w-60 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-1.5 shadow-[var(--sds-shadow-raised)]`}
        style={position} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); close(); }
          if (event.key === 'Tab') close();
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const controls = Array.from(popup.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]') ?? []);
            const index = controls.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
            controls[next]?.focus();
          }
        }}>{content}</div>, document.body)}
    <ErpSheet open={open && mobile} onClose={close} title={label} scope={scope} returnFocusElement={trigger.current}>
      <div id={id} className="space-y-1">{content}</div>
    </ErpSheet>
  </>;
}
