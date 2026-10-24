/** Restore an overlay to its opener, or an enabled control in the same workflow form. */
export function restoreErpSheetWorkflowFocus(trigger: HTMLElement | null, form: HTMLFormElement | null, closingOverlay: HTMLElement | null): void {
  const eligible = (element: HTMLElement | null): element is HTMLElement => {
    if (!element?.isConnected || closingOverlay?.contains(element)) return false;
    if (element.matches(':disabled,[aria-disabled="true"]') || element.closest('[inert],[hidden],[aria-hidden="true"]')) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return element.getClientRects().length > 0 && style?.visibility !== 'hidden' && style?.visibility !== 'collapse' && style?.display !== 'none';
  };
  const focus = (element: HTMLElement): boolean => { element.focus(); return element.ownerDocument.activeElement === element; };
  if (eligible(trigger) && focus(trigger)) return;
  if (!form?.isConnected || closingOverlay?.contains(form)) return;
  const controls = form.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex]');
  for (const control of controls) {
    if (control.closest('form') === form && Number.isInteger(control.tabIndex) && control.tabIndex >= 0 && eligible(control) && focus(control)) return;
  }
}
