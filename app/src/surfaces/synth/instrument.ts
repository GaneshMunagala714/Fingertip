import type { MusicalEvent } from "./gestures";

type ToneModule = typeof import("tone");

/** Plays the same musical events the visuals receive. Silent until resume(). */
export class Instrument {
  private tone: ToneModule | null = null;
  private synth: import("tone").PolySynth | null = null;
  private filter: import("tone").Filter | null = null;
  private analyser: import("tone").Analyser | null = null;
  private nodes: Array<{ dispose: () => void }> = [];
  private held = new Set<string>();
  ready = false;

  async resume() {
    if (!this.tone) this.tone = await import("tone");
    const Tone = this.tone;
    await Tone.start();
    await Tone.getContext().resume();
    if (this.ready) return;
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.03, decay: 0.24, sustain: 0.34, release: 1.2 },
    });
    synth.maxPolyphony = 8;
    const filter = new Tone.Filter(880, "lowpass");
    const reverb = new Tone.Reverb({ decay: 3.2, wet: 0.4 });
    const gain = new Tone.Gain(0.4);
    const limiter = new Tone.Limiter(-2);
    const analyser = new Tone.Analyser("waveform", 64);
    synth.connect(filter);
    filter.connect(reverb);
    reverb.connect(gain);
    gain.connect(limiter);
    limiter.toDestination();
    gain.connect(analyser);
    await reverb.generate();
    this.synth = synth;
    this.filter = filter;
    this.analyser = analyser;
    this.nodes = [synth, filter, reverb, gain, limiter, analyser];
    this.ready = true;
  }

  play(event: MusicalEvent) {
    if (!this.ready || !this.synth || !this.tone) return;
    const notes = event.midis.map((midi) => this.tone!.Frequency(midi, "midi").toNote());
    if (event.type === "note_on" || event.type === "chord_on") {
      this.synth.triggerAttack(notes, this.tone.now(), event.velocity);
      for (const note of notes) this.held.add(note);
      return;
    }
    this.synth.triggerRelease(notes, this.tone.now());
    for (const note of notes) this.held.delete(note);
  }

  express(amount: number) {
    if (!this.filter || !this.tone) return;
    const freq = 260 + Math.min(1, Math.max(0, amount)) * 4600;
    this.filter.frequency.rampTo(freq, 0.08);
  }

  energy(): number {
    if (!this.analyser) return 0;
    const value = this.analyser.getValue();
    if (!(value instanceof Float32Array) || value.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < value.length; i += 1) sum += value[i] * value[i];
    return Math.min(1, Math.sqrt(sum / value.length) * 3.4);
  }

  releaseAll() {
    if (this.synth && this.tone && this.held.size) {
      this.synth.triggerRelease([...this.held], this.tone.now());
    }
    this.held.clear();
  }

  async stop() {
    this.releaseAll();
    for (const node of this.nodes) node.dispose();
    this.nodes = [];
    this.synth = null;
    this.filter = null;
    this.analyser = null;
    this.ready = false;
    try {
      const raw = this.tone?.getContext().rawContext;
      if (raw instanceof AudioContext) await raw.suspend();
    } catch {
      /* The context may already be closed. */
    }
  }
}
