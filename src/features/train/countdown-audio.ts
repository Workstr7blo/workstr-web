export type CountdownCue = 'short' | 'final';

export class CountdownCueGuard {
  private played = new Set<string>();

  countdown(channel: string, period: string | number, secondsRemaining: number): CountdownCue | null {
    if (secondsRemaining < 1 || secondsRemaining > 5) return null;
    return this.once(`${channel}:${period}:${secondsRemaining}`, 'short');
  }

  finish(channel: string, period: string | number): CountdownCue | null {
    return this.once(`${channel}:${period}:final`, 'final');
  }

  reset(): void {
    this.played.clear();
  }

  private once(key: string, cue: CountdownCue): CountdownCue | null {
    if (this.played.has(key)) return null;
    this.played.add(key);
    return cue;
  }
}

let audioContext: AudioContext | null = null;
let pendingCue: CountdownCue | null = null;
let resumePending: Promise<void> | null = null;
let keepAlive: AudioBufferSourceNode | null = null;

// A resume() that never settles must not disable cues for the rest of the
// workout, so the in-flight guard is dropped even if the promise hangs.
const RESUME_LATCH_MS = 2_000;

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | undefined {
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor };
  return audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
}

// Starting a silent source inside the click handler is what actually consumes
// WebKit's user activation. Creating or resuming the context alone can report
// `running` while later timer-driven oscillators remain inaudible.
function primeAudioContext(): void {
  if (!audioContext) return;
  const source = audioContext.createBufferSource();
  source.buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate || 22_050);
  source.connect(audioContext.destination);
  source.start(0);
}

// WebKit interrupts a context that has gone quiet, and an EMOM is silent for
// most of every round. An inaudible looping source keeps the audio session
// alive between cues so round two is not the first casualty.
function startKeepAlive(): void {
  if (!audioContext || keepAlive) return;
  const rate = audioContext.sampleRate || 22_050;
  const source = audioContext.createBufferSource();
  source.buffer = audioContext.createBuffer(1, Math.max(1, Math.floor(rate)), rate);
  source.loop = true;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0, audioContext.currentTime);
  source.connect(gain);
  gain.connect(audioContext.destination);
  source.start(0);
  keepAlive = source;
}

// Recover from an interruption without a user gesture where the platform
// allows it, and replay the cue that arrived while the context was down.
function watchAudioContext(context: AudioContext): void {
  if (typeof context.addEventListener !== 'function') return;
  context.addEventListener('statechange', () => {
    if (context !== audioContext) return;
    if (context.state === 'running') {
      resumePending = null;
      startKeepAlive();
      const cue = pendingCue;
      pendingCue = null;
      if (cue) playTone(cue);
    } else {
      keepAlive = null;
      resumeAudioContext();
    }
  });
}

function playTone(cue: CountdownCue): void {
  if (!audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  const final = cue === 'final';
  const duration = final ? 0.65 : 0.09;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(final ? 1175 : 880, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(final ? 0.18 : 0.1, now + 0.012);
  if (final) gain.gain.exponentialRampToValueAtTime(0.13, now + 0.28);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  // Every cue builds two nodes; without this the graph grows for the whole session.
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function resumeAudioContext(): void {
  if (!audioContext || audioContext.state === 'running' || resumePending) return;
  const attempt = audioContext.resume().then(() => {
    if (resumePending !== attempt) return;
    resumePending = null;
    startKeepAlive();
    const cue = pendingCue;
    pendingCue = null;
    if (cue) playTone(cue);
  }).catch(() => {
    if (resumePending !== attempt) return;
    resumePending = null;
    pendingCue = null;
  });
  resumePending = attempt;
  setTimeout(() => { if (resumePending === attempt) resumePending = null; }, RESUME_LATCH_MS);
}

// Safe to call on any user gesture during a session, not just the start button:
// a real gesture is the only thing that reliably revives an interrupted context.
export function unlockCountdownAudio(): void {
  const AudioContextCtor = audioContextConstructor();
  if (!AudioContextCtor) return;
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContextCtor();
      watchAudioContext(audioContext);
    }
    resumeAudioContext();
    primeAudioContext();
    if (audioContext.state === 'running') startKeepAlive();
  } catch { /* Audio cues are an optional enhancement. */ }
}

export function countdownAudioState(): string {
  return audioContext ? audioContext.state : 'not started';
}

export function playCountdownCue(cue: CountdownCue | null): void {
  if (!cue || !audioContext) return;
  try {
    if (audioContext.state === 'running') playTone(cue);
    else {
      if (cue === 'final' || !pendingCue) pendingCue = cue;
      resumeAudioContext();
    }
  } catch { /* Never let a device audio failure interrupt a workout. */ }
}
