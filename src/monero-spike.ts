import { runMoneroPhase1Probe } from './features/monero/phase1-report';

const root = document.querySelector<HTMLPreElement>('#monero-spike-report');

runMoneroPhase1Probe().then((report) => {
  if (root) root.textContent = JSON.stringify(report, null, 2);
  (window as unknown as { __WORKSTR_MONERO_SPIKE__?: unknown }).__WORKSTR_MONERO_SPIKE__ = report;
}).catch((error) => {
  const report = { conclusion: 'fail', error: error instanceof Error ? error.message : String(error ?? 'unknown error') };
  if (root) root.textContent = JSON.stringify(report, null, 2);
  (window as unknown as { __WORKSTR_MONERO_SPIKE__?: unknown }).__WORKSTR_MONERO_SPIKE__ = report;
});
