// Pomoč za okna (dialoge), ki se lahko odprejo eno nad drugim (kartica → prodaja/cilj).
// Escape zapre samo najvišje okno; drsenje strani ostane zaklenjeno, dokler je odprto katerokoli.

let locks = 0;

export function lockScroll(): () => void {
  locks += 1;
  document.body.style.overflow = 'hidden';
  return () => {
    locks = Math.max(0, locks - 1);
    if (locks === 0) document.body.style.overflow = '';
  };
}

/** Ali je element najvišje odprto okno (zadnji [role=dialog] v dokumentu)? */
export function isTopDialog(el: Element | null): boolean {
  const all = document.querySelectorAll('[role="dialog"]');
  return Boolean(el) && all[all.length - 1] === el;
}
