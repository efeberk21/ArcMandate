/**
 * Starlight that follows the pointer across interactive cards.
 * One delegated listener writes the pointer position into --mx / --my on the
 * nearest element marked with [data-spotlight] or a known card class; CSS paints
 * the glow. No per-card listeners, nothing runs for touch input.
 */
const SELECTOR = '[data-spotlight], .journey-step, .bookmark, .welcome-principles article, .mandate-limit, button.secondary, button.danger';

export function installSpotlight(root: Document = document) {
  if (typeof window === 'undefined') return () => {};
  let frame = 0;
  let pending: { el: HTMLElement; x: number; y: number } | null = null;
  const flush = () => {
    frame = 0;
    if (!pending) return;
    const { el, x, y } = pending;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${x - rect.left}px`);
    el.style.setProperty('--my', `${y - rect.top}px`);
    pending = null;
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const el = (event.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
    if (!el) return;
    pending = { el, x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  };
  root.addEventListener('pointermove', onMove, { passive: true });
  return () => { root.removeEventListener('pointermove', onMove); if (frame) cancelAnimationFrame(frame); };
}
