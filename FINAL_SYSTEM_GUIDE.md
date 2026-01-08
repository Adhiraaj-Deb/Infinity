# Infinity: Hand-Controlled 3D Viewer - COMPLETE SYSTEM GUIDE

> **Critical Context for AI Agents:** This document is the **Source of Truth** for the `Infinity` project. Read this first before making ANY changes.

## 1. 🏗️ Project Architecture

**Tech Stack:**
- **Framework:** React 19 + Vite 7 (TypeScript Strict Mode)
- **3D Engine:** Three.js r182 (Standard renderer, not Fiber)
- **AI/CV:** MediaPipe Hands (via `@mediapipe/tasks-vision`)
- **Styling:** Tailwind CSS v4 + Custom CSS in `index.css`
- **Hosting:** Vercel (Requires specific headers for WASM)

**File Structure:**
```
src/
├── components/
│   └── Hand3DViewer.tsx   # MAIN UI & LOGIC HUB. Handles Webcam, UI overlay, and React state.
├── lib/
│   ├── handTracking.ts    # MEDIAPIPE LOGIC. Initializes vision graph, runs detection loop.
│   ├── gestures.ts        # GESTURE ALGORITHM. Raw landmarks -> Intent strings ("pinch", "fist").
│   └── threeScene.ts      # THREE.JS LOGIC. Scene graph, particles, physics, and rendering loop.
├── App.tsx                # Root component (Mounts Hand3DViewer)
└── main.tsx               # Entry point
public/                    # Static assets
vercel.json                # CRITICAL: COOP/COEP headers for MediaPipe SharedArrayBuffer
```

---

## 2. 🧠 Core Logic & Algorithms

### A. Hand Tracking (`handTracking.ts`)
- **Initialization:** Loads `HandLandmarker` with `delegate: "GPU"`.
- **Loop:** `requestAnimationFrame` grabs video frame → runs detection → executes callback.
- **Headers Requirement:** MediaPipe requires `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`. These are configured in `vercel.json` (Vercel) and assumed local (Vite dev server).

### B. Gesture Recognition (`gestures.ts`)
We map geometric hand shapes to "Intents":

1.  **ZOOM/SCALE ("Pinch")**
    *   **Trigger:** Thumb tip (4) close to Index tip (8).
    *   **Control:** Moving the pinched hand UP/DOWN scales the model.
    *   **Constraint:** Requires `fistDuration` check to distinguish from "Cycle" gesture.

2.  **POSITION/TRANSLATE ("Fist/Grab")**
    *   **Trigger:** Fingers curled in (average distance to wrist is low).
    *   **Control:** Moving the fist moves the model on X/Y plane.
    *   **Logic:** Uses `wasInFist` state machine to detect transitions.

3.  **ROTATION ("Open Palm")**
    *   **Trigger:** Fingers extended.
    *   **Control:** Start position is locked; deviation rotates the model.
    *   **Smoothing:** Mapped 1:1 with hand tilt for intuitive control.

4.  **CYCLE MODEL ("Grip-and-Release")**
    *   **Trigger:** Rapid "Fist -> Open" transition (< 600ms).
    *   **Effect:** Switches to next 3D model.
    *   **Safety:** Triggers a **1-second gesture cooldown** to prevent accidental movement after cycling.

### C. 3D Scene Management (`threeScene.ts`)
This is a vanilla Three.js implementation wrapped in a functional closure pattern.

- **`modelContainer`**: The persistent Group object. **CRITICAL:** We rotate/move THIS container, not the individual meshes. This preserves orientation when switching models.
- **Particle System**: Default shapes are point clouds (`THREE.Points`). Uploaded GLBs are converted to particle clouds.
- **Smoothing (Damping)**:
    *   **Position:** We update `targetPosition` based on gestures, then `lerp` the container to it (factor 0.1).
    *   **Rotation:** We `slerp` quaternion to target hand rotation (factor 0.1).
    *   *Why?* Filters out webcam jitter for "heavy", smooth feel.
- **Color Preservation**: Uploaded models retain their vertex colors (`userData.preserveColor = true`) so the global color picker doesn't override them.

---

## 3. 🛠️ Critical Configurations

### Vercel Deployment (`vercel.json`)
You **MUST** keep this file for the camera to work in production.
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

### Tailwind v4
This project uses the new Tailwind v4. Configuration is in `index.css` (`@import "tailwindcss";`), not just `tailwind.config.js`.

---

## 4. 🚀 Future Development Guide

**To Add a New Gesture:**
1.  **`gestures.ts`**: Add detection logic (e.g., "Peace Sign"). Return `{ mode: "new_mode" }`.
2.  **`threeScene.ts`**: Add case in `applyGesture`. Define what happens (e.g., change color).
3.  **`Hand3DViewer.tsx`**: Add UI feedback in `onResults`.

**To Add New Models:**
1.  **`threeScene.ts`**: Add geometry to `models` array on init.
2.  **`Hand3DViewer.tsx`**: Update `SHAPES` list for the UI buttons.

**Common Gotchas:**
- **"Camera turns off":** Check `vercel.json` headers. Check console for `SharedArrayBuffer` errors.
- **"Model jumps around":** Check `gestureCooldownRef`. Transient gestures (like pinch while opening fist) cause jumps. Increase `cooldown` in `Hand3DViewer.tsx`.
- **"Upload color wrong":** Ensure `loadUserModel` sets `preserveColor` flag.

---

**Project Owner:** Adhiraaj Deb
**License:** MIT
**Repository:** https://github.com/Adhiraaj-Deb/Infinity
