# YouTube Effects

## Files
- **pitch-variation.js** — Sweeps playbackRate between 0.5x (octave down) and 2.0x (octave up)
- **audio-distortion.js** — Waveshaper distortion effect on audio
- **vhs-shader.js** — VHS style: chromatic aberration, wavy distortion, vignette, scanlines
- **toon-shader.js** — Toon/cel shader: posterized colors + Sobel edge outlines

## Usage

### Via Bridge API (recommended)

```bash
# Inject an effect onto the active YouTube tab
curl -X POST http://localhost:3001/tab/execute \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$(cat demos/youtube-effects/vhs-shader.js)\"}"
```

### Via DevTools

Open browser DevTools console on any video page and paste the script contents.

## Stop effects
- Pitch: `clearInterval(window.__pitchInterval); document.querySelector("video").playbackRate=1.0;`
- Shaders: `document.querySelectorAll("canvas[data-gl],#__toonCanvas").forEach(c=>c.remove()); document.querySelector("video").style.opacity="1";`
