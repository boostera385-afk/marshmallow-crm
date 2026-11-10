/**
 * Notification sound utility — plays a two-tone chime using Web Audio API.
 * No external sound file required. Handles browser autoplay restrictions gracefully.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => undefined);
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function playTone(ctx: AudioContext, frequency: number, startTime: number, duration: number, volume: number, type: OscillatorType = "sine") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration);
}

/**
 * Plays a pleasant two-tone notification chime.
 * Safe to call multiple times — creates fresh oscillator nodes each time.
 */
export function playAssignmentSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Two ascending tones for a pleasant "ding-ding" effect
  playTone(ctx, 587.33, now, 0.18, 0.25);         // D5
  playTone(ctx, 783.99, now + 0.15, 0.28, 0.20);   // G5
}

/**
 * Plays an urgent repeating notification chime for about 4.5 seconds.
 */
export function playUrgentAlertSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Repeat the "ding-ding" 8 times over 4 seconds
  for (let i = 0; i < 8; i++) {
    const offset = i * 0.6; // repeat every 600ms
    playTone(ctx, 587.33, now + offset, 0.18, 0.25);
    playTone(ctx, 783.99, now + offset + 0.15, 0.28, 0.20);
  }
}

/** Siren cycles per level: a warning sounds briefly, critical twice as long. */
export const SYSTEM_ALARM_CYCLES = { warning: 3, critical: 6 } as const;

/**
 * Database overload alarm for Admins: a "wee-woo" siren (square wave, high/low
 * alternating) that sounds nothing like the lead chimes above, so it is never
 * mistaken for an ordinary notification. Warning ~1.8 s, critical ~3.6 s.
 */
export function playSystemAlarmSound(level: "warning" | "critical"): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  for (let i = 0; i < SYSTEM_ALARM_CYCLES[level]; i++) {
    const offset = i * 0.6;
    playTone(ctx, 880, now + offset, 0.28, 0.12, "square"); // high
    playTone(ctx, 660, now + offset + 0.3, 0.28, 0.12, "square"); // low
  }
}
