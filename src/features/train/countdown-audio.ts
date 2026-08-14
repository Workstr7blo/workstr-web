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
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function resumeAudioContext(): void {
  if (!audioContext || audioContext.state === 'running' || resumePending) return;
  resumePending = audioContext.resume().then(() => {
    resumePending = null;
    const cue = pendingCue;
    pendingCue = null;
    if (cue) playTone(cue);
  }).catch(() => {
    resumePending = null;
    pendingCue = null;
  });
}

export function unlockCountdownAudio(): void {
  if (typeof AudioContext === 'undefined') return;
  try {
    audioContext ||= new AudioContext();
    resumeAudioContext();
  } catch { /* Audio cues are an optional enhancement. */ }
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
