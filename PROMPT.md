# Cursor prompt — Air Harp

Paste the **Master prompt** into Cursor Agent (Composer, Agent mode) with the repo open.
Then run the **Phase prompts** one at a time. Test each phase before moving on, and commit after each one.

---

## Master prompt (paste first)

```
You are working on "Air Harp", a browser-only musical instrument controlled by hand gestures from a webcam. Read .cursor/rules/air-harp.mdc and every file in src/ before doing anything. Then give me a 5-line summary of the architecture so I know you've understood it. Don't edit anything yet.

## The product (target experience)
A full-screen, mirrored webcam feed, slightly darkened. Hand skeletons are drawn on top (green bones, red joints), and debug mode can toggle them.

1. CREATE A STRING: Pinch thumb + index (on either hand), drag, and release. While pinching, a dashed preview line runs from the start point to the current pinch point. On release, a permanent string appears between the two points if it is longer than the minimum length. Each string:
   - is a bright line with a soft neon glow in its own hue (same note = same color)
   - has small perpendicular tick marks along its length (every 4th tick longer) and end caps, like a ruler / guitar fret markers
   - has a pitch set by its length: longer = lower, quantized to a musical scale (default C major pentatonic across 3 octaves)

2. PLUCK A STRING: Swipe an extended (not pinching) index fingertip across a string. Detection uses segment intersection between the fingertip's previous and current positions, so fast swipes register. On pluck:
   - play a Karplus–Strong plucked-string tone at the string's frequency, with volume from swipe speed and stereo pan from x-position
   - the string vibrates as a decaying standing wave (fundamental + some 2nd harmonic, biased toward the hit point, displaced in the swipe direction). Glow intensity and thickness rise with energy, then decay back to rest over ~1 s
   - a burst of additive-blended spark particles sprays from the contact point in the string's hue
   - a per-string cooldown (~160 ms) prevents double triggers

3. Both hands work at the same time, independently: one can draw while the other plays.

4. Controls: D toggles debug (skeleton + HUD with fps/string count), Z undoes the last string, C clears all strings.

## Hard constraints
- Vanilla JS + Vite + Canvas 2D + Web Audio. No frameworks, no TypeScript, no extra deps unless I approve.
- 60 fps on an M2 MacBook in Chrome with 2 hands + 24 strings.
- All tunables in src/config.js.
- Must work over http://localhost (getUserMedia). Audio starts only after the Start button (autoplay policy).
- Handle failure modes: camera denied, GPU delegate failure (fallback to CPU exists), hand leaving and re-entering frame (no phantom swipe), hands swapping index order (key by handedness).

## How I want you to work
- One phase at a time. Stop when it's done, and tell me exactly how to test it (gesture → expected result).
- Prefer extending existing modules over rewriting them. Show diffs, not whole files, unless a file is new.
- If a requirement is ambiguous, pick the option that feels most like a real instrument, then tell me which you picked.
- Never silently change config defaults. If you think a default is wrong, say so and why.
```

---

## Phase prompts

### Phase 1: Verify & harden the starter
```
Run through the current code as if you were a reviewer. Find bugs or edge cases in: pinch hysteresis, pinch-release accidentally plucking, the first frame after a hand appears, mirroring math, canvas sizing vs CSS scaling, and AudioContext state. Fix real issues only and list each one with a one-line reason. Then add a small on-screen toast (bottom-center, fades after 1.5 s) for: "Camera ready", "String added (note name)", "Undo", "Cleared".
```

### Phase 2: Feel (the most important phase)
```
Make plucking feel great:
1. Swipe velocity: compute fingertip velocity in px/ms using a short ring buffer (last 4 frames) instead of a single-frame delta, and map it to both volume and visual amplitude with a soft curve.
2. Latency: measure the time from detection to sound. Make sure there's no avoidable delay (e.g. use ctx.currentTime with no scheduling offset, and keep the buffer cache warm by pre-generating every scale note at startup).
3. Strum: if one swipe crosses several strings in the same frame, sort the hits by distance from the swipe start and stagger them by 12 ms each, like a real strum.
4. Add a "pinch-hold to mute" gesture: pinching ON a string (within 15 px) dampens it immediately (fast decay of both visual and audio). Audio damping needs each pluck's gain node kept per string so it can be ramped down.
Explain the tradeoffs you made.
```

### Phase 3: Visual polish (match the reference video)
```
Polish visuals to match a "neon light strings over webcam" look:
- Render strings to an offscreen canvas and composite with 'lighter' for real bloom (2 blur passes at different radii), instead of relying only on shadowBlur, which is slow. Keep 60 fps.
- While vibrating, add a subtle chromatic shimmer: 2 faint offset copies of the string in hue±25.
- Particles: add a few longer "lightning" sparks that follow the string direction, plus a brief flash at the contact point.
- Electric crackle effect for strong plucks (velocity > 0.8): a jagged, randomly displaced polyline along the string for ~120 ms, regenerated every frame.
- Show the note name (e.g. "G4") floating briefly above the contact point on pluck.
Benchmark before/after with the HUD fps and report the numbers.
```

### Phase 4: Musical features
```
Add musical controls:
1. A minimal top-right panel (vanilla HTML/CSS, glassmorphism, collapsible) with: scale selector (major pentatonic, minor pentatonic, major, natural minor, Hirajoshi, Raga Bhairav-ish approximation), root note, octave range, reverb amount, and instrument timbre (KS "harp", KS "bass" with a lower decay + low-pass, and a "glass" sine+partials synth).
2. A pitch-label mode that shows each string's note at its midpoint.
3. Snap-to-grid option: string endpoints snap to a 40 px grid so harps look tidy.
4. Persist strings + settings in localStorage (wrap in try/catch) and restore on load.
Keep all defaults in config.js; the panel only overrides them at runtime.
```

### Phase 5: Gestures v2
```
Add gestures, each with hysteresis/cooldown and a debug overlay showing its state:
1. Open-palm hold (all 5 fingers extended, palm facing camera, held 800 ms) → clear all strings, with a sweeping wipe animation.
2. Grab & move: pinch on a string's END CAP (within 20 px) drags that endpoint and live-updates its pitch. Pinch on the string body (not a cap) instead moves the whole string.
3. Two-hand pinch: if both hands pinch at the same time, create a string between the two pinch points (it follows both hands until one releases).
4. Finger-extended detection util (based on tip-to-wrist distance vs PIP-to-wrist distance) so plucking only triggers when the index is extended.
Document every gesture in the start screen.
```

### Phase 6: Record & share
```
Add a record button (and R key): use canvas.captureStream(60) + the master audio routed through a MediaStreamAudioDestinationNode, combine both into a MediaRecorder (webm/vp9 if supported, otherwise fall back), and download "air-harp-<timestamp>.webm" on stop. Show a red recording dot + timer. Make sure recording doesn't drop the app below 50 fps.
```

### Phase 7: Ship
```
Prepare for deployment to Vercel:
- vite build passes. Self-host the MediaPipe wasm + model in /public (copy them from node_modules / download script) so there are no runtime CDN dependencies, and update config paths.
- Add a mobile/tablet fallback message if no camera exists, plus a "touch mode" where finger drags on the touchscreen create strings and swipes pluck (same StringField API).
- Add OG meta tags + a favicon.
- README: setup, controls, gesture list, architecture diagram (ASCII), known limitations.
```

---

## Debug prompts (use when stuck)

- **"Plucks don't trigger / trigger twice"**: `Add a debug overlay that draws each hand's prevTip→tip segment in yellow and flashes a string red when hits() returns it. Log every hit with string id, velocity, and ms since last pluck. Then diagnose.`
- **"Laggy"**: `Profile the frame loop. Wrap detectForVideo, the draw passes, and particles in performance.now() timers. Show a breakdown in the HUD and fix the top offender.`
- **"Pinch is flaky"**: `Plot the pinch ratio for each hand as a live sparkline in the HUD, with the start/release thresholds drawn as lines, so I can tune them.`
- **"Sound clicks/pops"**: `Check for gain discontinuities. Add 2-5 ms attack/release ramps on every gain change and confirm the compressor isn't pumping.`
