import { afterEach, describe, expect, it, vi } from "vitest";

/** Records every tone the Web Audio API is asked to play. Synthetic, no real audio. */
function fakeAudio() {
  const tones: { type: string; frequency: number; start: number }[] = [];
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() {
      const osc = {
        type: "sine", freq: 0,
        frequency: { setValueAtTime: (f: number) => { osc.freq = f; } },
        connect() {},
        start: (t: number) => { tones.push({ type: osc.type, frequency: osc.freq, start: t }); },
        stop() {},
      };
      return osc;
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return tones;
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("overload alarm sound", () => {
  it("is a square-wave high/low siren, unlike the sine lead chimes", async () => {
    const tones = fakeAudio();
    const { playSystemAlarmSound, playAssignmentSound } = await import("./notification-sound");
    playSystemAlarmSound("warning");
    expect(tones).toHaveLength(6); // 3 cycles of high + low
    expect(new Set(tones.map((t) => t.type))).toEqual(new Set(["square"]));
    expect(tones.map((t) => t.frequency)).toEqual([880, 660, 880, 660, 880, 660]);
    tones.length = 0;
    playAssignmentSound();
    expect(tones.every((t) => t.type === "sine")).toBe(true);
  });

  it("sounds twice as long for critical", async () => {
    const tones = fakeAudio();
    const { playSystemAlarmSound } = await import("./notification-sound");
    playSystemAlarmSound("critical");
    expect(tones).toHaveLength(12);
    expect(Math.max(...tones.map((t) => t.start))).toBeCloseTo(5 * 0.6 + 0.3);
  });
});
