# Hand-Controlled 3D Viewer - Complete Project Guide

## 📋 Project Overview

This is a production-ready web application that allows users to control 3D models in the browser using hand tracking and gestures from their webcam. The app runs entirely client-side with no server processing required.

## 🏗️ Architecture

### Tech Stack
- **Frontend Framework**: React 19 + Vite 7
- **Language**: TypeScript (strict mode)
- **3D Rendering**: Three.js r182
- **Hand Tracking**: MediaPipe Hands (client-side, browser-based)
- **Styling**: Tailwind CSS v4 + custom CSS
- **Icons**: Lucide React
- **Build Tool**: Vite with HMR (Hot Module Replacement)

### Project Structure
```
cv3d/
├── src/
│   ├── components/
│   │   └── Hand3DViewer.tsx       # Main React component
│   ├── lib/
│   │   ├── handTracking.ts        # MediaPipe hand tracking logic
│   │   ├── gestures.ts            # Gesture detection algorithms
│   │   └── threeScene.ts          # Three.js scene management
│   ├── App.tsx                    # Root component
│   ├── main.tsx                   # Entry point
│   └── index.css                  # Global styles + Tailwind
├── public/                        # Static assets
├── index.html                     # HTML template
├── package.json                   # Dependencies
├── tsconfig.json                  # TypeScript config
├── vite.config.ts                 # Vite config
├── tailwind.config.js             # Tailwind config
└── postcss.config.js              # PostCSS config (for Tailwind v4)
```

## 🎯 Core Features

### 1. **Webcam + Hand Tracking**
- Requests webcam access on first load
- Uses MediaPipe Hands to track 21 landmarks per hand
- Supports 1-2 hands simultaneously
- Runs at ~15-30 FPS on typical laptops
- Shows webcam preview in bottom-left corner

### 2. **3D Scene**
- Three.js scene with perspective camera
- Orbit controls for mouse interaction
- Dark background (#1a1a2e)
- Hemisphere + directional lighting
- Particle-based rendering for default shapes

### 3. **Seven Default 3D Models**
1. Cube
2. Sphere
3. Torus (donut)
4. Cylinder
5. Cone
6. Icosahedron
7. Dodecahedron

### 4. **User 3D File Upload**
- Accepts `.glb` and `.gltf` files
- Auto-centers and scales uploaded models
- Uses GLTFLoader from Three.js

### 5. **Hand Gesture Controls**

#### Rotation (Open Palm)
- **Detection**: All fingers extended (tips far from wrist)
- **Control**: Index fingertip position maps to rotation
  - Horizontal movement → Y-axis rotation
  - Vertical movement → X-axis rotation

#### Scale (Pinch)
- **Detection**: Thumb tip and index tip close together (< 5% screen width)
- **Control**: Moving hand up/down while pinching scales the model
  - Moving up → Scale up
  - Moving down → Scale down

#### Translation (Fist)
- **Detection**: All fingertips close to wrist
- **Control**: Wrist movement maps to model position
  - Horizontal → X-axis movement
  - Vertical → Y-axis movement

## 🔧 Implementation Details

### Module 1: Hand Tracking (`src/lib/handTracking.ts`)

**Purpose**: Initialize MediaPipe and provide hand landmark data

**Key Functions**:
```typescript
export async function startHandTracking(
  videoElement: HTMLVideoElement,
  callbacks: HandTrackingCallbacks
): Promise<() => void>
```

**How it works**:
1. Loads MediaPipe vision tasks from CDN
2. Creates HandLandmarker with GPU acceleration
3. Starts webcam video stream (1280x720)
4. Runs detection loop using `requestAnimationFrame`
5. Calls `onResults` callback with landmark data
6. Returns cleanup function to stop camera and MediaPipe

**Important**: Uses `type` imports for TypeScript types to avoid ES module errors:
```typescript
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from "@mediapipe/tasks-vision";
```

### Module 2: Gesture Recognition (`src/lib/gestures.ts`)

**Purpose**: Convert hand landmarks into gesture commands

**Key Functions**:
```typescript
export function detectGesture(
  prevLandmarks: HandLandmarks[] | null,
  currentLandmarks: HandLandmarks[]
): GestureResult
```

**Gesture Detection Logic**:

1. **Pinch Detection**:
   - Calculate Euclidean distance between thumb tip (landmark 4) and index tip (landmark 8)
   - If distance < 0.05 (5% of screen), it's a pinch
   - Track Y-position change of pinch center for scaling

2. **Fist Detection**:
   - Calculate average distance from wrist (landmark 0) to all fingertips (8, 12, 16, 20)
   - If average < 0.15, it's a fist
   - Track wrist position change for translation

3. **Open Palm Detection**:
   - If average distance > 0.25, it's an open palm
   - Track index fingertip movement for rotation

**Sensitivity Tuning**:
- Rotation: `dx * 5, dy * 5`
- Scale: `1 + (prevY - currentY) * 2`
- Translation: `dx * 2, dy * 2`

### Module 3: Three.js Scene (`src/lib/threeScene.ts`)

**Purpose**: Manage 3D scene, models, and rendering

**Key Functions**:
```typescript
export async function initThreeScene(canvas: HTMLCanvasElement): Promise<ThreeController>
```

**Scene Setup**:
1. Creates scene with dark background
2. Sets up perspective camera (FOV 75°, position z=5)
3. Initializes WebGL renderer with antialiasing
4. Adds orbit controls for mouse interaction
5. Adds hemisphere light + directional light
6. Creates 7 default geometries as particle meshes
7. Starts animation loop

**Model Management**:
- `setModelByIndex(index)`: Switches between default shapes
- `loadUserModel(file)`: Loads GLB/GLTF files, auto-fits to view
- `applyGesture(gesture)`: Applies rotation/scale/translation deltas
- `resize(width, height)`: Handles window resize
- `dispose()`: Cleanup function

**Particle Rendering**:
```typescript
const material = new THREE.PointsMaterial({
  color: 0x00ffff,
  size: 0.05,
  transparent: true,
  opacity: 0.8,
  blending: THREE.AdditiveBlending,
});
```

**Important**: Uses correct Three.js import paths:
```typescript
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
```

### Module 4: Main Component (`src/components/Hand3DViewer.tsx`)

**Purpose**: React component that ties everything together

**State Management**:
- `hasCameraAccess`: null | boolean (camera permission status)
- `gestureMode`: "idle" | "rotate" | "scale" | "translate"
- `selectedShape`: 0-6 (current shape index)
- `showOverlay`: boolean (tracking active/paused)

**Refs**:
- `videoRef`: HTMLVideoElement for webcam
- `canvasRef`: HTMLCanvasElement for Three.js
- `threeControllerRef`: ThreeController instance
- `prevLandmarksRef`: Previous frame landmarks for delta calculation

**Lifecycle**:
1. `useEffect` on mount:
   - Initialize Three.js scene
   - Start hand tracking
   - Set up window resize listener
2. On unmount:
   - Cleanup hand tracking
   - Dispose Three.js resources

**UI Layout**:
- Full-screen dark background
- Top-left: Glassmorphism card with title, mode indicator, gesture guide
- Bottom-left: Webcam preview (mirrored)
- Bottom: Control bar with shape selectors + upload button

## 🐛 Common Issues & Solutions

### Issue 1: Blank Page / Module Loading Errors

**Symptoms**: White blank page, no console errors visible

**Root Cause**: TypeScript types imported as values cause ES module failures

**Solution**: Use `import type` for all TypeScript-only types:
```typescript
// ❌ Wrong
import { HandLandmarks } from "./handTracking";

// ✅ Correct
import type { HandLandmarks } from "./handTracking";

// ✅ Also correct (inline type import)
import { startHandTracking, type HandLandmarks } from "./handTracking";
```

**Files to check**:
- `src/lib/handTracking.ts`
- `src/lib/gestures.ts`
- `src/lib/threeScene.ts`
- `src/components/Hand3DViewer.tsx`

### Issue 2: Three.js Import Errors

**Symptoms**: `Module not found` errors for OrbitControls or GLTFLoader

**Root Cause**: Incorrect import paths (old Three.js syntax)

**Solution**: Use `three/addons` instead of `three/examples/jsm`:
```typescript
// ❌ Wrong (old path)
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ✅ Correct (new path for Three.js r150+)
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
```

### Issue 3: Tailwind CSS Not Working

**Symptoms**: No styles applied, or PostCSS errors

**Root Cause**: Tailwind CSS v4 requires different configuration

**Solution**: 
1. Install `@tailwindcss/postcss`:
   ```bash
   npm install @tailwindcss/postcss
   ```

2. Update `postcss.config.js`:
   ```javascript
   import tailwindcss from '@tailwindcss/postcss';
   import autoprefixer from 'autoprefixer';

   export default {
     plugins: [tailwindcss, autoprefixer],
   };
   ```

3. Update `src/index.css`:
   ```css
   @import "tailwindcss";
   ```

### Issue 4: Camera Permission Denied

**Symptoms**: Black webcam preview, error in console

**Solution**: 
- Check browser permissions (chrome://settings/content/camera)
- Ensure HTTPS or localhost (required for getUserMedia)
- Show user-friendly error message in UI

### Issue 5: Hand Tracking Not Working

**Symptoms**: Mode stays "idle", no gesture detection

**Debugging Steps**:
1. Check console for MediaPipe errors
2. Verify webcam feed is visible
3. Ensure good lighting and hand visibility
4. Check if landmarks are being detected (add console.log in callback)

**Common Causes**:
- Poor lighting
- Hand too close/far from camera
- MediaPipe model failed to load (check network tab)

## 📦 Dependencies

### Production Dependencies
```json
{
  "@mediapipe/tasks-vision": "^0.10.22",
  "@react-three/drei": "^10.7.7",
  "@react-three/fiber": "^9.5.0",
  "@types/three": "^0.182.0",
  "clsx": "^2.1.1",
  "lucide-react": "^0.562.0",
  "react": "^19.2.0",
  "react-dom": "^19.2.0",
  "tailwind-merge": "^3.4.0",
  "three": "^0.182.0"
}
```

### Dev Dependencies
```json
{
  "@tailwindcss/postcss": "^4.x",
  "@vitejs/plugin-react": "^5.1.1",
  "autoprefixer": "^10.4.23",
  "postcss": "^8.5.6",
  "tailwindcss": "^4.1.18",
  "typescript": "~5.9.3",
  "vite": "^7.2.4"
}
```

## 🚀 Development Workflow

### Initial Setup
```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Open browser to http://localhost:5173/
```

### Making Changes

1. **Edit code** - Vite HMR will auto-reload
2. **Check console** - Look for TypeScript/runtime errors
3. **Test gestures** - Use webcam to verify hand tracking
4. **Build for production** - `npm run build`

### Adding New Gestures

1. **Define detection logic** in `src/lib/gestures.ts`:
   ```typescript
   // Example: Thumbs up detection
   const thumbUp = hand[4].y < hand[3].y && hand[4].y < hand[2].y;
   ```

2. **Add to GestureMode type**:
   ```typescript
   export type GestureMode = "idle" | "rotate" | "scale" | "translate" | "thumbsup";
   ```

3. **Handle in `threeScene.ts`**:
   ```typescript
   case "thumbsup":
     // Your custom action
     break;
   ```

### Adding New 3D Shapes

1. **Add geometry** in `threeScene.ts`:
   ```typescript
   const shapes = [
     // ... existing shapes
     new THREE.TetrahedronGeometry(1.5, 0),
   ];
   ```

2. **Add button** in `Hand3DViewer.tsx`:
   ```typescript
   const SHAPES = [
     // ... existing shapes
     { name: "Tetrahedron", icon: Triangle },
   ];
   ```

## 🎨 UI Customization

### Colors
- Background: `#0f0f1a` (dark blue-black)
- Glassmorphism cards: `bg-white/5 backdrop-blur-xl border-white/10`
- Accent gradient: `from-blue-400 to-purple-400`
- Active state: `bg-purple-500/20 border-purple-500/50`

### Responsive Design
- Uses Tailwind breakpoints: `md:p-8` (medium screens and up)
- Webcam preview: Fixed size on desktop, scales on mobile
- Control bar: Horizontal scroll on small screens

## 🔐 Security Considerations

- **No server-side processing** - All computation happens in browser
- **No data storage** - No user data is saved or transmitted
- **Camera access** - Only used for hand tracking, not recorded
- **HTTPS required** - For getUserMedia API (or localhost)

## 📊 Performance Optimization

### Current Performance
- **Hand tracking**: ~15-30 FPS (depends on device)
- **3D rendering**: 60 FPS (capped by requestAnimationFrame)
- **Memory usage**: ~50-100 MB (varies with model complexity)

### Optimization Tips
1. **Reduce particle count** - Lower geometry subdivisions
2. **Throttle gesture detection** - Skip frames if needed
3. **Use simpler models** - Fewer vertices for uploaded GLB files
4. **Disable orbit controls** - When using hand gestures exclusively

## 🧪 Testing Checklist

- [ ] Webcam permission flow works
- [ ] All 7 default shapes load correctly
- [ ] GLB/GLTF upload works (test with sample model)
- [ ] Open palm rotation works smoothly
- [ ] Pinch scaling works in both directions
- [ ] Fist translation works on X and Y axes
- [ ] Mode indicator updates correctly
- [ ] UI is responsive on different screen sizes
- [ ] No console errors on page load
- [ ] Camera cleanup on page unload

## 📝 Future Enhancements

- [ ] Add more gesture types (peace sign, thumbs up, etc.)
- [ ] Implement gesture history/undo
- [ ] Add model texture/material controls
- [ ] Support for multiple simultaneous models
- [ ] Export modified models
- [ ] VR/AR mode support
- [ ] Mobile device support (touch + accelerometer)
- [ ] Gesture training mode for custom gestures

## 🆘 Troubleshooting for New Agents

If you're a new AI agent helping with this project, here's what to check first:

1. **Is the dev server running?** Check `npm run dev` in terminal
2. **Are there TypeScript errors?** Check for red squiggles in IDE
3. **Is the page blank?** Check browser console for module errors
4. **Are imports correct?** Verify all `import type` statements
5. **Is Three.js working?** Check import paths use `three/addons`
6. **Is Tailwind working?** Verify `@tailwindcss/postcss` is installed

## 📚 Key Learning Resources

- [MediaPipe Hands Documentation](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
- [Three.js Documentation](https://threejs.org/docs/)
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [Vite Guide](https://vitejs.dev/guide/)

## 📄 License & Credits

This project was built as a demonstration of browser-based hand tracking and 3D interaction. Feel free to use and modify as needed.

**Key Technologies**:
- MediaPipe by Google
- Three.js by Mr.doob and contributors
- React by Meta
- Vite by Evan You
