// Explicit profiling builds only. No diagnostics UI or collection in normal releases.
const enabled = import.meta.env.VITE_DRWRITE_PROFILE === '1';
let counts: Record<string, number> = {};
let samples: Record<string, number[]> = {};
export const profileStart = () => enabled ? performance.now() : 0;
export function profileCount(name: string) {
  if (enabled) counts[name] = (counts[name] ?? 0) + 1;
}
export function profileEnd(name: string, start: number) {
  if (enabled) (samples[name] ??= []).push(performance.now() - start);
}
if (enabled && typeof window !== 'undefined') {
  window.addEventListener('beforeinput', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.novel-doc')) return;
    const start = performance.now();
    requestAnimationFrame(() => profileEnd('input-to-next-frame-ms', start));
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'F8') { counts = {}; samples = {}; event.preventDefault(); }
    if (event.key === 'F9') {
      event.preventDefault();
      const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [name, { n: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? 0,
          p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0,
          total: sorted.reduce((a, b) => a + b, 0) }];
      }));
      const result = { timestamp: new Date().toISOString(), counts, summary, samples };
      const output = import.meta.env.VITE_DRWRITE_PROFILE_OUTPUT;
      if (output) void import('./fs').then(({ writeText }) => writeText(output, JSON.stringify(result, null, 2)));
    }
  });
}
