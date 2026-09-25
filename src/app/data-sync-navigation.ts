export function bindDataSyncNavigation(root: ParentNode, syncNow: () => void): void {
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#sync-now')) { syncNow(); return; }
    const open = target.closest<HTMLElement>('[data-sync-open]');
    if (open) { showDetail(open); return; }
    const back = target.closest<HTMLElement>('[data-sync-back]');
    if (back) showMain(back);
  });
}

function showDetail(trigger: HTMLElement): void {
  const card = trigger.closest<HTMLElement>('.data-sync-card');
  const next = trigger.dataset.syncOpen;
  if (!card || !next) return;
  card.querySelector<HTMLElement>('.data-sync-main')?.setAttribute('hidden', '');
  card.querySelectorAll<HTMLElement>('.data-sync-detail').forEach((detail) => { detail.hidden = detail.dataset.syncView !== next; });
  card.querySelector<HTMLElement>(`.data-sync-detail[data-sync-view="${next}"] h3`)?.focus();
}

function showMain(trigger: HTMLElement): void {
  const card = trigger.closest<HTMLElement>('.data-sync-card');
  if (!card) return;
  card.querySelector<HTMLElement>('.data-sync-main')?.removeAttribute('hidden');
  card.querySelectorAll<HTMLElement>('.data-sync-detail').forEach((detail) => { detail.hidden = true; });
  const row = trigger.dataset.syncReturn ? card.querySelector<HTMLElement>(`[data-sync-open="${trigger.dataset.syncReturn}"]`) : null;
  row?.focus();
}
