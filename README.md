# Gesture-Controlled 3D Object

Control a 3D cube in the browser with your hands — no installs, just a webcam. Inspired by Apple Vision Pro.

- **Left hand** — rotates the object
- **Right hand** — scales it with a pinch gesture (thumb ↔ index finger)

## Tech

- JavaScript
- [MediaPipe Hands](https://developers.google.com/mediapipe) — tracks 21 landmarks per hand in real time
- [Three.js](https://threejs.org/) — 3D scene and rendering

## Run

```bash
cd gesture_3d
python -m http.server 8000
```

Open http://localhost:8000 and allow camera access.
