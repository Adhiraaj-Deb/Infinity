import type { HandLandmarks } from "./handTracking";

export type GestureMode = "idle" | "zoom_in" | "zoom_out" | "move" | "cycle_model";

export type GestureResult = {
    mode: GestureMode;
    scaleDelta?: number;
    translateDelta?: { dx: number; dy: number };
    rotation?: { x: number; y: number; z: number };
    cycleModel?: boolean;
};

// State tracking for gesture transitions
let previousHandState: "open" | "pinch" | "fist" | null = null;
let fistStartTime: number | null = null;
let wasInFist = false;

// Helper to calculate roll/pitch/yaw
// Helper to calculate roll/pitch/yaw using true 3D coordinates
function calculateHandRotation(hand: HandLandmarks): { x: number, y: number, z: number } {
    const wrist = hand[0];
    const middleMCP = hand[9]; // Base of middle finger
    const indexMCP = hand[5];  // Base of index finger
    const pinkyMCP = hand[17]; // Base of pinky finger

    // PITCH (X-axis Rotation): Tipping hand forward/backward
    // Vector: Wrist -> Middle MCP
    // We compare Y (down) vs Z (depth).
    // Note: MediaPipe Z is normalized similar to X/Y relative to image width/height at the center.
    // However, calibration might vary.
    const pDy = middleMCP.y - wrist.y;
    const pDz = (middleMCP.z || 0) - (wrist.z || 0);
    // Calculate angle relative to vertical (Y-axis).
    // Offset by -PI/2 so that when hand is vertical (flat to screen), pitch is 0.
    // Math.atan2(y, z) ? 
    // Let's stick to standard: atan2(opp, adj).
    // If we want angle from vertical:
    const pitch = Math.atan2(pDz, pDy);
    // Explanation:
    // Hand flat vertical: dy is large (approx 1), dz is 0. atan2(0, 1) = 0. Correct.
    // Hand pointing at camera: dy is 0, dz is negative (closer). atan2(-1, 0) = -PI/2.
    // Hand pointing away: dy is 0, dz is positive. atan2(1, 0) = PI/2.

    // YAW (Y-axis Rotation): Turning hand left/right
    // Vector: Index MCP -> Pinky MCP
    // We compare X (horizontal) vs Z (depth).
    const yDx = pinkyMCP.x - indexMCP.x;
    const yDz = (pinkyMCP.z || 0) - (indexMCP.z || 0);
    // At rest (flat): dx is positive, dz is 0. atan2(0, 1) = 0.
    // Turn left (thumb away): dx decreases, dz changes.
    const yaw = Math.atan2(yDz, yDx);

    // ROLL (Z-axis Rotation): Tilting hand side-to-side (clock/anti-clock)
    // Vector: Index MCP -> Pinky MCP
    // We compare X vs Y.
    const rDx = pinkyMCP.x - indexMCP.x;
    const rDy = pinkyMCP.y - indexMCP.y;
    // Standard 2D rotation
    const roll = Math.atan2(rDy, rDx);

    // Coordinate mapping note:
    // These return radians in [ -PI, PI ].
    // They will be passed to Three.js which expects Euler angles.
    return { x: pitch - (Math.PI / 2), y: yaw, z: roll };
}

// Helper to detect hand state
function detectHandState(hand: HandLandmarks): "open" | "pinch" | "fist" {
    const thumbTip = hand[4];
    const indexTip = hand[8];
    const middleTip = hand[12];
    const ringTip = hand[16];
    const pinkyTip = hand[20];
    const wrist = hand[0];

    // Calculate distance between thumb and index for pinch
    const pinchDist = Math.sqrt(
        Math.pow(thumbTip.x - indexTip.x, 2) + Math.pow(thumbTip.y - indexTip.y, 2)
    );

    // Calculate average distance from wrist to fingertips
    const tips = [indexTip, middleTip, ringTip, pinkyTip];
    const avgDistToWrist = tips.reduce((acc, tip) => {
        return acc + Math.sqrt(Math.pow(tip.x - wrist.x, 2) + Math.pow(tip.y - wrist.y, 2));
    }, 0) / 4;

    // Thresholds
    const PINCH_THRESHOLD = 0.05;
    const FIST_THRESHOLD = 0.12;  // Tightened back to 0.12 (was 0.16) to prevent false positives
    const OPEN_THRESHOLD = 0.15;

    // Robust Fist Detection:
    // Check if fingertips are closer to wrist than their MCP joints (Knuckles)
    // Indices: Index(5), Middle(9), Ring(13), Pinky(17)
    const fingersClosed = [8, 12, 16, 20].every((tipIdx) => {
        const mcpIdx = tipIdx - 3; // 5, 9, 13, 17
        const tipToWrist = Math.sqrt(Math.pow(hand[tipIdx].x - wrist.x, 2) + Math.pow(hand[tipIdx].y - wrist.y, 2));
        const mcpToWrist = Math.sqrt(Math.pow(hand[mcpIdx].x - wrist.x, 2) + Math.pow(hand[mcpIdx].y - wrist.y, 2));
        // If tip is significantly closer to wrist than knuckle, it's curled
        return tipToWrist < (mcpToWrist * 1.2); // Factor to allow some slack
    });

    // Priority 1: FIST
    // Combine distance check with geometric check for robustness
    if (avgDistToWrist < FIST_THRESHOLD && fingersClosed) {
        return "fist";
    }

    // Priority 2: PINCH (Move trigger)
    if (pinchDist < PINCH_THRESHOLD) {
        return "pinch";
    }

    // Priority 3: OPEN PALM
    // If not a fist and not a pinch, and fingers extended?
    if (avgDistToWrist > OPEN_THRESHOLD) {
        return "open";
    }

    return previousHandState || "open";
}

export function detectGesture(
    prevLandmarks: HandLandmarks[] | null,
    currentLandmarks: HandLandmarks[]
): GestureResult {
    if (!currentLandmarks || currentLandmarks.length === 0) {
        return { mode: "idle" };
    }

    const hand = currentLandmarks[0];

    // --- TWO-HANDED ZOOM LOGIC ---
    // Priority: If 2 hands are visible and both are pinching, we Zoom.
    if (currentLandmarks.length === 2) {
        const hand1 = currentLandmarks[0];
        const hand2 = currentLandmarks[1];
        const state1 = detectHandState(hand1);
        const state2 = detectHandState(hand2);

        if (state1 === "pinch" && state2 === "pinch") {
            // Calculate distance between the two pinch centers
            const center1 = {
                x: (hand1[4].x + hand1[8].x) / 2,
                y: (hand1[4].y + hand1[8].y) / 2
            };
            const center2 = {
                x: (hand2[4].x + hand2[8].x) / 2,
                y: (hand2[4].y + hand2[8].y) / 2
            };

            const currentDist = Math.sqrt(
                Math.pow(center1.x - center2.x, 2) + Math.pow(center1.y - center2.y, 2)
            );

            // Check if we have previous data to compare against
            if (prevLandmarks && prevLandmarks.length === 2) {
                const prevHand1 = prevLandmarks[0];
                const prevHand2 = prevLandmarks[1];

                // We need to match hands? MediaPipe usually keeps order if tracking persists.
                // Assuming index 0 is hand 1, index 1 is hand 2.

                const prevCenter1 = {
                    x: (prevHand1[4].x + prevHand1[8].x) / 2,
                    y: (prevHand1[4].y + prevHand1[8].y) / 2
                };
                const prevCenter2 = {
                    x: (prevHand2[4].x + prevHand2[8].x) / 2,
                    y: (prevHand2[4].y + prevHand2[8].y) / 2
                };

                const prevDist = Math.sqrt(
                    Math.pow(prevCenter1.x - prevCenter2.x, 2) + Math.pow(prevCenter1.y - prevCenter2.y, 2)
                );

                if (prevDist > 0) {
                    const scaleDelta = currentDist / prevDist;

                    // Stabilize jitter
                    if (Math.abs(1 - scaleDelta) > 0.005) {
                        return {
                            mode: scaleDelta > 1 ? "zoom_in" : "zoom_out",
                            scaleDelta: scaleDelta
                        };
                    }
                }
            }
            // If we are here, we are in 2-hand pinch mode but maybe no delta yet,
            // or delta is small. We should Return 'idle' but BLOCK single hand gestures.
            // Returning 'idle' here prevents falling through to single hand logic.
            return { mode: "idle" };
        }
    }

    const currentState = detectHandState(hand);
    const now = performance.now();

    // --- ZOOM LOGIC (FIST Transitions) ---

    // Zoom Out: Open -> Fist
    if (previousHandState === "open" && currentState === "fist") {
        previousHandState = currentState;
        fistStartTime = now;
        wasInFist = true;
        return {
            mode: "zoom_out",
            scaleDelta: 0.8  // Increased step size (was 0.95)
        };
    }

    // Zoom In: Fist -> Open (if held long enough to not be a cycle)
    if (previousHandState === "fist" && currentState === "open") {
        const fistDuration = fistStartTime ? now - fistStartTime : 1000;

        // Cycle Model Check: Quick gesture (< 600ms)
        if (fistDuration < 600) {
            wasInFist = false;
            fistStartTime = null;
            previousHandState = currentState;
            return {
                mode: "cycle_model",
                cycleModel: true
            };
        }

        // Otherwise it's a Zoom In trigger
        previousHandState = currentState;
        return {
            mode: "zoom_in",
            scaleDelta: 1.25 // Increased step size (was 1.05)
        };
    }

    // --- MOVE LOGIC (PINCH State) ---
    // If holding a pinch (and not a fist), move the model
    if (currentState === "pinch" && prevLandmarks && prevLandmarks.length > 0) {
        const prevHand = prevLandmarks[0];

        // Use Index Finger Tip for more intuitive dragging? Or Wrist?
        // Utilizing wrist or center of pinch is usually more stable.
        // Let's use the average of Thumb and Index.
        const prevCenter = {
            x: (prevHand[4].x + prevHand[8].x) / 2,
            y: (prevHand[4].y + prevHand[8].y) / 2
        };
        const currentCenter = {
            x: (hand[4].x + hand[8].x) / 2,
            y: (hand[4].y + hand[8].y) / 2
        };

        const dx = (currentCenter.x - prevCenter.x) * 12; // Massively increased sensitivity (was ~3)
        const dy = (currentCenter.y - prevCenter.y) * 12;

        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
            previousHandState = currentState;
            return {
                mode: "move",
                translateDelta: { dx, dy }
            };
        }
    }

    // --- ROTATION LOGIC (OPEN State) ---
    // User requested: determine rotation based on palm turn when OPEN
    // Update: User requested NO movement (translation), ONLY rotation.
    if (currentState === "open") {
        const rotation = calculateHandRotation(hand);

        previousHandState = currentState;
        return {
            mode: "move",
            rotation: rotation,
            translateDelta: undefined // Explicitly undefined
        };
    }

    // Reset fist tracking if held too long (optional safety)
    if (currentState === "fist" && fistStartTime && (now - fistStartTime) > 2000) {
        // Just let it stay in fist state, allowing 'Zoom In' on release
    }

    // If state changed but didn't trigger above actions, update tracker
    previousHandState = currentState;
    return { mode: "idle" };
}
