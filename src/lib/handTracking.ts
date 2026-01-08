import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from "@mediapipe/tasks-vision";

export type HandLandmarks = Array<{ x: number; y: number; z?: number }>;

export type HandTrackingCallbacks = {
  onResults: (landmarks: HandLandmarks[]) => void;
  onError?: (err: unknown) => void;
};

let handLandmarker: HandLandmarker | null = null;
let animationFrameId: number | null = null;

export async function startHandTracking(
  videoElement: HTMLVideoElement,
  callbacks: HandTrackingCallbacks
): Promise<() => void> {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
    });

    // Start video stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 1280,
        height: 720,
        facingMode: "user",
      },
    });

    videoElement.srcObject = stream;
    await new Promise<void>((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play();
        resolve();
      };
    });

    const loop = () => {
      if (videoElement.paused || videoElement.ended) return;

      const now = performance.now();
      if (handLandmarker) {
        const results = handLandmarker.detectForVideo(videoElement, now);
        if (results.landmarks) {
          // Convert to our simpler type if needed, or pass directly
          callbacks.onResults(results.landmarks);
        }
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      stream.getTracks().forEach((track) => track.stop());
      handLandmarker?.close();
      handLandmarker = null;
    };
  } catch (error) {
    callbacks.onError?.(error);
    throw error;
  }
}
