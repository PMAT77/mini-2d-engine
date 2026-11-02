const running = new WeakMap<HTMLElement, Animation>();
const snapshots = new WeakMap<HTMLElement, HTMLElement>();
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Logical state changes immediately; only the outgoing pixels remain during dismissal. */
export function showPanel(node: HTMLElement, open: boolean): void {
  const style = node.hidden ? null : getComputedStyle(node);
  const from = { opacity: style?.opacity ?? '0', translate: style && style.translate !== 'none' ? style.translate : node.hidden ? '-10px 0' : '0 0' };
  running.get(node)?.cancel();
  node.hidden = false;
  node.inert = !open;
  node.style.pointerEvents = open ? '' : 'none';
  if (!node.animate || reduced()) { node.hidden = !open; return; }
  const animation = node.animate([from, open ? { opacity: 1, translate: '0 0' } : { opacity: 0, translate: '-6px 0' }],
    { duration: open ? 180 : 120, easing: 'cubic-bezier(.2,.7,.2,1)' });
  running.set(node, animation);
  animation.onfinish = () => { if (running.get(node) === animation) { node.hidden = !open; running.delete(node); } };
}

export function revealContent(node: HTMLElement): void {
  running.get(node)?.cancel();
  if (!reduced() && node.animate) {
    const animation = node.animate([{ opacity: .25, translate: '4px 0' }, { opacity: 1, translate: '0 0' }],
      { duration: 120, easing: 'ease-out' });
    running.set(node, animation);
  }
}

export function crossfadeContent(node: HTMLElement, update: () => void): void {
  snapshots.get(node)?.remove();
  if (reduced() || !node.animate) { update(); return; }
  const rect = node.getBoundingClientRect(), old = node.cloneNode(true) as HTMLElement;
  old.inert = true; old.setAttribute('aria-hidden', 'true'); old.removeAttribute('id');
  for (const child of [old, ...Array.from(old.querySelectorAll<HTMLElement>('*'))]) for (const name of child.getAttributeNames()) {
    if (name === 'id' || name === 'role' || name.startsWith('data-') || name.startsWith('aria-')) child.removeAttribute(name);
  }
  old.setAttribute('aria-hidden', 'true');
  Object.assign(old.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', pointerEvents: 'none', zIndex: '1' });
  node.parentElement?.append(old); update(); revealContent(node);
  snapshots.set(node, old);
  const exit = old.animate([{ opacity: .75 }, { opacity: 0 }], { duration: 120 });
  exit.onfinish = () => old.remove(); exit.oncancel = () => old.remove();
}
