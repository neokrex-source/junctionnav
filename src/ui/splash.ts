/** The splash screen lives in index.html so it shows before the app code arrives. */
export function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('is-done');
  window.setTimeout(() => el.remove(), 450);
}

export const SPLASH_MIN_MS = 1250;
