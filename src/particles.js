import { CONFIG } from "./config.js";

export class Particles {
  constructor() {
    this.items = [];
    this.queue = [];
    this.flashes = [];
  }

  /**
   * Burst now, or at a later frame time so a strum's sparks follow the notes.
   * `dir` is the string's unit tangent; lightning runs along it.
   */
  schedule(at, p, hue, strength, dir) {
    this.queue.push({ at, p, hue, strength, dir });
  }

  burst(p, hue, strength = 1, dir) {
    const n = Math.round(CONFIG.particlesPerPluck * (0.5 + strength));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.5 + Math.random() * 3.5) * (0.6 + strength);
      this.items.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 1, decay: 0.012 + Math.random() * 0.025,
        hue: hue + (Math.random() * 40 - 20),
        len: 2 + Math.random() * 6,
        bolt: false,
      });
    }
    const tx = dir?.x ?? 1;
    const ty = dir?.y ?? 0;
    for (let i = 0; i < CONFIG.lightningPerPluck; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const j = (Math.random() - 0.5) * 0.55;
      const speed = (3.2 + Math.random() * 4) * (0.65 + strength);
      this.items.push({
        x: p.x, y: p.y,
        vx: (tx * sign - ty * j) * speed,
        vy: (ty * sign + tx * j) * speed,
        life: 1, decay: 0.018 + Math.random() * 0.012,
        hue: hue + (Math.random() * 16 - 8),
        len: CONFIG.lightningLen * (0.65 + Math.random() * 0.7),
        bolt: true,
      });
    }
    this.flashes.push({ x: p.x, y: p.y, hue, life: 1 });
  }

  update(now = 0) {
    let i = 0;
    while (i < this.queue.length) {
      if (this.queue[i].at <= now) {
        const q = this.queue[i];
        this.burst(q.p, q.hue, q.strength, q.dir);
        this.queue.splice(i, 1);
      } else i++;
    }
    let w = 0;
    for (let k = 0; k < this.items.length; k++) {
      const q = this.items[k];
      q.x += q.vx; q.y += q.vy;
      q.vx *= 0.96; q.vy = q.vy * 0.96 + 0.04;
      q.life -= q.decay;
      if (q.life > 0) this.items[w++] = q;
    }
    this.items.length = w;
    w = 0;
    for (let k = 0; k < this.flashes.length; k++) {
      const f = this.flashes[k];
      f.life -= CONFIG.flashDecay;
      if (f.life > 0) this.flashes[w++] = f;
    }
    this.flashes.length = w;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const q of this.items) {
      ctx.strokeStyle = `hsla(${q.hue}, 100%, ${q.bolt ? 86 : 75}%, ${q.life})`;
      ctx.lineWidth = q.bolt ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      if (q.bolt) {
        const kink = 2.2;
        ctx.lineTo(q.x - q.vx * q.len * 0.45 - q.vy * kink, q.y - q.vy * q.len * 0.45 + q.vx * kink);
        ctx.lineTo(q.x - q.vx * q.len, q.y - q.vy * q.len);
      } else {
        ctx.lineTo(q.x - q.vx * q.len * 0.5, q.y - q.vy * q.len * 0.5);
      }
      ctx.stroke();
    }
    for (const f of this.flashes) {
      ctx.fillStyle = `hsla(${f.hue}, 100%, 92%, ${f.life * 0.85})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 7 + (1 - f.life) * 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
