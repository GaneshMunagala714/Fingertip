export const PENTATONIC = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86] as const;

export type MusicalEvent = {
  id: string;
  type: "note_on" | "note_off" | "chord_on" | "chord_off";
  midi: number;
  midis: number[];
  velocity: number;
  expression: number;
  x: number;
  y: number;
  hand: 0 | 1;
  timestampMs: number;
};

export type HandFrame = {
  x: number;
  y: number;
  pinch: number;
  palm: boolean;
};

type Memory = {
  pinching: boolean;
  midi: number | null;
  midis: number[];
  palmSince: number | null;
  chord: boolean;
  lastOnset: number;
};

const PINCH_ON = 0.045;
const PINCH_OFF = 0.075;
const PALM_HOLD_MS = 450;
const COOLDOWN_MS = 120;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiFromX(x: number): number {
  const t = Math.min(1, Math.max(0, (x - 0.12) / 0.76));
  const index = Math.round(t * (PENTATONIC.length - 1));
  return PENTATONIC[index];
}

export function noteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

export function pitchWord(midi: number): "Low" | "Mid" | "High" {
  if (midi < 67) return "Low";
  if (midi < 79) return "Mid";
  return "High";
}

export function chordFor(midi: number): number[] {
  const index = PENTATONIC.indexOf(midi as (typeof PENTATONIC)[number]);
  const rootIndex = index === -1 ? 0 : index;
  const third = PENTATONIC[Math.min(PENTATONIC.length - 1, rootIndex + 2)];
  const fifth = PENTATONIC[Math.min(PENTATONIC.length - 1, rootIndex + 4)];
  return Array.from(new Set([PENTATONIC[rootIndex], third, fifth]));
}

export function harmonyFor(midi: number): number {
  const index = PENTATONIC.indexOf(midi as (typeof PENTATONIC)[number]);
  if (index === -1) return midi + 7;
  return PENTATONIC[Math.min(PENTATONIC.length - 1, index + 2)];
}

export function expressionFromY(y: number): number {
  return Math.min(1, Math.max(0, 1 - y));
}

export function velocityFromExpression(expression: number, hand: 0 | 1): number {
  const base = 0.28 + expression * 0.62;
  return hand === 1 ? base * 0.62 : base;
}

type Point = { x: number; y: number };

export function frameFromLandmarks(landmarks: Point[], mirror = true): HandFrame | null {
  if (landmarks.length < 21) return null;
  const anchor = landmarks[9] ?? landmarks[0];
  const pinch = Math.hypot(landmarks[4].x - landmarks[8].x, landmarks[4].y - landmarks[8].y);
  return {
    x: mirror ? 1 - anchor.x : anchor.x,
    y: anchor.y,
    pinch,
    palm: isOpenPalm(landmarks, pinch),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isOpenPalm(landmarks: Point[], pinch: number): boolean {
  if (pinch < PINCH_OFF) return false;
  const wrist = landmarks[0];
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  let extended = 0;
  for (let i = 0; i < tips.length; i += 1) {
    if (distance(landmarks[tips[i]], wrist) > distance(landmarks[pips[i]], wrist) * 1.08) {
      extended += 1;
    }
  }
  return extended >= 4;
}

function blank(): Memory {
  return { pinching: false, midi: null, midis: [], palmSince: null, chord: false, lastOnset: Number.NEGATIVE_INFINITY };
}

export class GestureTracker {
  private memory: Memory[] = [blank(), blank()];
  private sequence = 0;

  update(hands: Array<HandFrame | null>, now: number): MusicalEvent[] {
    const events: MusicalEvent[] = [];
    for (let hand = 0; hand < 2; hand += 1) {
      const frame = hands[hand] ?? null;
      const memory = this.memory[hand] ?? blank();
      this.memory[hand] = memory;
      if (!frame) {
        events.push(...this.release(hand as 0 | 1, memory, now, 0.5, 0.5));
        continue;
      }
      const expression = expressionFromY(frame.y);
      const pinching = memory.pinching ? frame.pinch < PINCH_OFF : frame.pinch < PINCH_ON;
      if (pinching && !memory.pinching) {
        if (now - memory.lastOnset >= COOLDOWN_MS) {
          if (memory.chord) events.push(this.event("chord_off", hand as 0 | 1, memory, expression, frame, now));
          memory.chord = false;
          memory.palmSince = null;
          const melody = midiFromX(frame.x);
          const other = this.memory[0];
          const midi = hand === 1 && other?.midi ? harmonyFor(other.midi) : melody;
          memory.midi = midi;
          memory.midis = [midi];
          memory.pinching = true;
          memory.lastOnset = now;
          events.push(this.event("note_on", hand as 0 | 1, memory, expression, frame, now));
        }
      } else if (!pinching && memory.pinching) {
        events.push(this.event("note_off", hand as 0 | 1, memory, expression, frame, now));
        memory.pinching = false;
        memory.midi = null;
        memory.midis = [];
      }

      if (frame.palm && !memory.pinching) {
        if (memory.palmSince === null) memory.palmSince = now;
        if (!memory.chord && now - memory.palmSince >= PALM_HOLD_MS && now - memory.lastOnset >= COOLDOWN_MS) {
          const midi = midiFromX(frame.x);
          memory.midi = midi;
          memory.midis = chordFor(midi);
          memory.chord = true;
          memory.lastOnset = now;
          events.push(this.event("chord_on", hand as 0 | 1, memory, expression, frame, now));
        }
      } else if (memory.chord && !frame.palm) {
        events.push(this.event("chord_off", hand as 0 | 1, memory, expression, frame, now));
        memory.chord = false;
        memory.palmSince = null;
        memory.midi = null;
        memory.midis = [];
      } else if (!frame.palm) {
        memory.palmSince = null;
      }
    }
    return events;
  }

  private release(hand: 0 | 1, memory: Memory, now: number, x: number, y: number): MusicalEvent[] {
    const frame = { x, y, pinch: 1, palm: false };
    const expression = 0.4;
    const events: MusicalEvent[] = [];
    if (memory.pinching) {
      events.push(this.event("note_off", hand, memory, expression, frame, now));
    }
    if (memory.chord) {
      events.push(this.event("chord_off", hand, memory, expression, frame, now));
    }
    this.memory[hand] = { ...blank(), lastOnset: now };
    return events;
  }

  private event(
    type: MusicalEvent["type"],
    hand: 0 | 1,
    memory: Memory,
    expression: number,
    frame: HandFrame,
    now: number,
  ): MusicalEvent {
    this.sequence += 1;
    const midi = memory.midi ?? midiFromX(frame.x);
    const midis = memory.midis.length ? memory.midis.slice() : [midi];
    return {
      id: `note-${this.sequence}`,
      type,
      midi,
      midis,
      velocity: velocityFromExpression(expression, hand),
      expression,
      x: frame.x,
      y: frame.y,
      hand,
      timestampMs: now,
    };
  }
}
