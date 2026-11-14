import { midiFromX, noteName, PENTATONIC, pitchWord, type MusicalEvent } from "./gestures";

type Pluck = { midi: number; life: number; chord: boolean };

export class AuroraWorld {
  private ctx: CanvasRenderingContext2D;
  private plucks: Pluck[] = [];
  private hand = { x: 0.5, y: 0.45, present: false, sx: 0.5, sy: 0.45 };
  private energy = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private chordLabel = "";

  constructor(
    private canvas: HTMLCanvasElement,
    private reduced: boolean,
  ) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas is unavailable.");
    this.ctx = context;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setHand(x: number, y: number, present: boolean) {
    this.hand.x = x;
    this.hand.y = y;
    this.hand.present = present;
  }

  setEnergy(energy: number) {
    this.energy = energy;
  }

  clear() {
    this.plucks = [];
    this.chordLabel = "";
  }

  push(event: MusicalEvent) {
    if (event.type === "note_off" || event.type === "chord_off") {
      if (event.type === "chord_off") this.chordLabel = "";
      return;
    }
    const chord = event.type === "chord_on";
    this.chordLabel = chord ? event.midis.map((midi) => noteName(midi)).join("  ") : "";
    for (const midi of event.midis) {
      this.plucks.push({ midi, life: 1, chord });
    }
    if (this.plucks.length > 36) this.plucks.splice(0, this.plucks.length - 36);
  }

  frame(time: number) {
    if (this.canvas.clientWidth !== this.width || this.canvas.clientHeight !== this.height) this.resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.hand.sx += (this.hand.x - this.hand.sx) * 0.22;
    this.hand.sy += (this.hand.y - this.hand.sy) * 0.22;
    const hover = this.hand.present ? midiFromX(this.hand.sx) : null;
    this.plucks = this.plucks.filter((pluck) => pluck.life > 0.02);
    for (const pluck of this.plucks) pluck.life -= this.reduced ? 0.02 : 0.012;

    for (const midi of PENTATONIC) {
      const active = this.plucks.some((pluck) => pluck.midi === midi);
      const hovered = midi === hover;
      this.drawString(midi, time, active, hovered);
    }
    this.drawLabel(hover);
  }

  private drawString(midi: number, time: number, active: boolean, hovered: boolean) {
    const ctx = this.ctx;
    const x = this.stringX(midi);
    const pluck = this.plucks.find((item) => item.midi === midi);
    const amp = pluck ? (this.reduced ? 0 : 10 * pluck.life * (pluck.chord ? 1.35 : 1)) : 0;
    const top = 72;
    const bottom = this.height - 108;
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.strokeStyle = active
      ? `rgba(246, 247, 251, ${0.9})`
      : hovered
        ? "rgba(221, 208, 255, 0.9)"
        : "rgba(246, 247, 251, 0.38)";
    ctx.lineWidth = (active ? 2.4 : hovered ? 1.8 : 1) + this.energy * 2;
    const steps = 24;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const y = top + (bottom - top) * t;
      const wave = Math.sin(t * Math.PI) * Math.sin(time * 0.03 + midi) * amp;
      const px = x + wave;
      if (i === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
    if (hovered || active) {
      ctx.font = "12px Geist, Inter, sans-serif";
      ctx.fillStyle = active ? "rgba(246, 247, 251, 0.95)" : "rgba(221, 208, 255, 0.9)";
      ctx.textAlign = "center";
      ctx.fillText(noteName(midi), x, top - 10);
    }
  }

  private drawLabel(hover: number | null) {
    if (!this.hand.present && !this.chordLabel) return;
    const ctx = this.ctx;
    const midi = hover ?? midiFromX(this.hand.sx);
    const text = this.chordLabel ? `Chord  ${this.chordLabel}` : `${noteName(midi)}   ${pitchWord(midi)}`;
    const y = 86 + this.hand.sy * (this.height - 220);
    const x = this.stringX(midi);
    ctx.font = "600 22px Geist, Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(7, 11, 22, 0.55)";
    const width = ctx.measureText(text).width + 28;
    const left = Math.min(this.width - width - 16, Math.max(16, x + 18));
    ctx.beginPath();
    ctx.rect(left, y - 22, width, 36);
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.fillText(text, left + 14, y + 4);
  }

  private stringX(midi: number): number {
    const index = Math.max(0, (PENTATONIC as readonly number[]).indexOf(midi));
    const t = 0.12 + (index / (PENTATONIC.length - 1)) * 0.76;
    return t * this.width;
  }
}
