# Air Harp 🎐

Draw glowing strings in the air with a pinch, then pluck them with your fingertip.
It runs in the browser using MediaPipe hand tracking, Web Audio (Karplus–Strong) and Canvas 2D.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome, click **Start**, and allow camera access.

## Controls

| Gesture / key | Action |
|---|---|
| Pinch thumb + index, drag, release | Create a string (longer = lower note) |
| Swipe index finger across a string | Pluck it |
| `D` | Toggle debug (skeleton + HUD) |
| `Z` | Undo last string |
| `C` | Clear all strings |

## Structure

```
src/
  config.js     every tunable number
  tracking.js   camera + MediaPipe HandLandmarker
  gestures.js   per-hand pinch/move state machine
  strings.js    string model + hit-testing
  audio.js      Karplus–Strong synth + length→pitch
  particles.js  spark particles
  render.js     all drawing
  main.js       wiring + frame loop
```

## Working with Cursor

`.cursor/rules/air-harp.mdc` is loaded automatically. Open `PROMPT.md`, paste the master prompt, then go through the phases one at a time.

## Tips

- Use good, even lighting facing you. Hand tracking struggles with strong backlight.
- Sit 50–90 cm from the camera.
- If the pinch feels too sensitive, tune `pinchStart` / `pinchRelease` in `config.js`.
