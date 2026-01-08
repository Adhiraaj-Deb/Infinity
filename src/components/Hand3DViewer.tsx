import React, { useEffect, useRef, useState } from "react";
import { startHandTracking, type HandLandmarks } from "../lib/handTracking";
import { detectGesture } from "../lib/gestures";
import { initThreeScene, type ThreeController } from "../lib/threeScene";

export const Hand3DViewer: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const threeControllerRef = useRef<ThreeController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [hasCameraAccess, setHasCameraAccess] = useState<boolean | null>(null);
    const [gestureStatus, setGestureStatus] = useState<string | null>(null);
    const [brightness, setBrightness] = useState<number>(1.5);
    const [isCameraOn, setIsCameraOn] = useState<boolean>(true);
    const [isPhysicsEnabled, setIsPhysicsEnabled] = useState<boolean>(false);

    // Settings State
    const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
    const [modelColor, setModelColor] = useState<string>("#00ffff");

    const statusTimeoutRef = useRef<number | undefined>(undefined);
    const prevLandmarksRef = useRef<HandLandmarks[] | null>(null);
    const gestureCooldownRef = useRef<number>(0);

    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

    // 1. Initialize Three.js Scene (Once)
    useEffect(() => {
        if (canvasRef.current && !threeControllerRef.current) {
            initThreeScene(canvasRef.current).then((controller) => {
                threeControllerRef.current = controller;
                controller.setBloomStrength(brightness); // Apply initial brightness
            });

            const handleResize = () => {
                if (threeControllerRef.current) {
                    threeControllerRef.current.resize(window.innerWidth, window.innerHeight);
                }
            };
            window.addEventListener("resize", handleResize);

            return () => {
                window.removeEventListener("resize", handleResize);
                if (threeControllerRef.current) {
                    threeControllerRef.current.dispose();
                    threeControllerRef.current = null;
                }
            };
        }
    }, []); // Run once on mount

    // 2. Initialize Hand Tracking (Depends on isCameraOn)
    useEffect(() => {
        let cleanupHandTracking: (() => void) | undefined;

        const startTracking = async () => {
            if (isCameraOn && videoRef.current) {
                try {
                    setHasCameraAccess(null); // Reset to loading
                    cleanupHandTracking = await startHandTracking(videoRef.current, {
                        onResults: (landmarksArray) => {
                            if (!threeControllerRef.current) return;

                            // VISUALIZATION: Draw landmarks on overlay canvas
                            const canvas = overlayCanvasRef.current;
                            const video = videoRef.current;
                            if (canvas && video) {
                                const ctx = canvas.getContext("2d");
                                if (ctx) {
                                    // Match canvas size to video
                                    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                                        canvas.width = video.videoWidth;
                                        canvas.height = video.videoHeight;
                                    }

                                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                                    // Draw each hand
                                    for (const landmarks of landmarksArray) {
                                        // Draw Connectors
                                        ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
                                        ctx.lineWidth = 2;

                                        const connections = [
                                            // Thumb
                                            [0, 1], [1, 2], [2, 3], [3, 4],
                                            // Index
                                            [0, 5], [5, 6], [6, 7], [7, 8],
                                            // Middle
                                            [0, 9], [9, 10], [10, 11], [11, 12],
                                            // Ring
                                            [0, 13], [13, 14], [14, 15], [15, 16],
                                            // Pinky
                                            [0, 17], [17, 18], [18, 19], [19, 20],
                                            // Knuckles
                                            [5, 9], [9, 13], [13, 17]
                                        ];

                                        ctx.beginPath();
                                        for (const [start, end] of connections) {
                                            const p1 = landmarks[start];
                                            const p2 = landmarks[end];
                                            // Coordinates are normalized (0-1), map to canvas
                                            ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
                                            ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
                                        }
                                        ctx.stroke();

                                        // Draw Landmarks
                                        ctx.fillStyle = "white";
                                        for (const point of landmarks) {
                                            ctx.beginPath();
                                            ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, 2 * Math.PI);
                                            ctx.fill();
                                        }
                                    }
                                }
                            }

                            // Gesture Detection
                            const gesture = detectGesture(prevLandmarksRef.current, landmarksArray);

                            // logic: If cycling, trigger it and set cooldown.
                            // If cooldown active, ignore other gestures (avoid jumpy transitions).
                            if (gesture.cycleModel) {
                                threeControllerRef.current.applyGesture(gesture);
                                gestureCooldownRef.current = Date.now() + 1000; // 1s cooldown
                            } else {
                                if (Date.now() > gestureCooldownRef.current) {
                                    threeControllerRef.current.applyGesture(gesture);
                                }
                            }

                            // UI Feedback Logic
                            let newStatus: string | null = null;
                            if (gesture.cycleModel) newStatus = "Cycle Model";
                            else if (gesture.mode === "zoom_in") newStatus = "Zooming In";
                            else if (gesture.mode === "zoom_out") newStatus = "Zooming Out";
                            else if (gesture.mode === "move") {
                                if (gesture.rotation) newStatus = "Rotating"; // Updated text since move is separate
                                else if (gesture.translateDelta) newStatus = "Moving";
                            }

                            if (newStatus) {
                                setGestureStatus(newStatus);
                                if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
                                statusTimeoutRef.current = setTimeout(() => setGestureStatus(null), 200);
                            }

                            prevLandmarksRef.current = landmarksArray;
                        },
                        onError: (err) => {
                            console.error("Hand tracking error:", err);
                            setHasCameraAccess(false);
                            setIsCameraOn(false); // Turn off if failed
                        }
                    });
                    setHasCameraAccess(true);
                } catch (err) {
                    console.error("Failed to start hand tracking:", err);
                    setHasCameraAccess(false);
                    setIsCameraOn(false);
                }
            } else {
                setHasCameraAccess(false); // Consider "off" as no access/not active
            }
        };

        startTracking();

        return () => {
            if (cleanupHandTracking) cleanupHandTracking();
        };
    }, [isCameraOn]);


    return (
        <div className="relative w-full h-full bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#1a1a2e] overflow-hidden">
            {/* 3D Canvas - Full Screen */}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block touch-none" />

            {/* Gesture Status HUD - Top Center */}
            <div className={`absolute top-12 left-1/2 -translate-x-1/2 transition-opacity duration-300 pointer-events-none
                ${gestureStatus ? 'opacity-100' : 'opacity-0'}
            `}>
                <div className="liquid-glass px-8 py-3 rounded-full flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-white/90 font-medium tracking-widest uppercase text-sm drop-shadow-lg">
                        {gestureStatus}
                    </span>
                </div>
            </div>

            {/* Top Left: Settings Toggle */}
            <div className="absolute top-6 left-6 pointer-events-auto z-50">
                <button
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                    className="liquid-glass group p-3 flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 hover:bg-white/10"
                    title="Open Settings"
                >
                    <svg className="w-6 h-6 text-white/90 group-hover:rotate-90 transition-transform duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </button>
            </div>

            {/* Top Right: Camera Toggle */}
            <div className="absolute top-6 right-6 pointer-events-auto z-50">
                <button
                    onClick={() => setIsCameraOn(!isCameraOn)}
                    className="liquid-glass group p-3 flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95"
                    title={isCameraOn ? "Turn Camera Off" : "Turn Camera On"}
                >
                    {isCameraOn ? (
                        <svg className="w-6 h-6 text-white/90 group-hover:text-red-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    ) : (
                        <svg className="w-6 h-6 text-white/50 group-hover:text-green-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                    )}
                </button>
            </div>


            {/* Webcam Preview - Bottom Left */}
            <div className={`absolute bottom-6 left-6 pointer-events-auto transition-opacity duration-500 ${isCameraOn ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <div className="liquid-glass group">
                    <div className="relative w-56 h-40 rounded-3xl overflow-hidden">
                        <video
                            ref={videoRef}
                            className="w-full h-full object-cover transform -scale-x-100"
                            playsInline
                            muted
                        />
                        <canvas
                            ref={overlayCanvasRef}
                            className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 pointer-events-none"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />

                        {/* Loading/Error States omitted for brevity but preserved in logic */}
                        {!hasCameraAccess && hasCameraAccess !== null && isCameraOn && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 text-center">
                                <p className="text-xs text-red-300 font-medium">Camera access required</p>
                            </div>
                        )}
                        {hasCameraAccess === null && isCameraOn && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                                <div className="w-8 h-8 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* SETTINGS MENU OVERLAY - REFERENCE AESTHETIC */}
            <div className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-500
                ${isSettingsOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}
            `}>
                {/* Backdrop */}
                <div
                    className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-500"
                    onClick={() => setIsSettingsOpen(false)}
                />

                {/* Modal Window - Narrow & Vertical */}
                <div className={`relative w-[340px] bg-[#050505] border border-white/10 rounded-none shadow-2xl overflow-hidden flex flex-col transform transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]
                    ${isSettingsOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'}
                `}>
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
                        <h2 className="text-white font-serif text-xl tracking-wider">SETTINGS</h2>
                        <button
                            onClick={() => setIsSettingsOpen(false)}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-all"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div style={{ padding: '32px 28px' }}>

                        {/* SECTION: VISUAL EFFECTS */}
                        <div style={{ marginBottom: '40px' }}>
                            <h3 className="text-[10px] font-bold text-white/30 tracking-[0.2em] uppercase text-left" style={{ marginBottom: '20px' }}>Visual Effects</h3>

                            {/* Glow Intensity */}
                            <div style={{ marginBottom: '28px' }}>
                                <div className="text-center" style={{ marginBottom: '16px' }}>
                                    <span className="text-[11px] tracking-[0.15em] text-white/60 uppercase">Glow Intensity</span>
                                </div>
                                <div className="relative h-10 w-full flex items-center px-1">
                                    <div className="absolute w-full h-[2px] bg-white/10 rounded-full" />
                                    <div
                                        className="absolute h-[2px] bg-white rounded-full transition-all duration-75"
                                        style={{ width: `${(brightness / 3) * 100}%` }}
                                    />
                                    <input
                                        type="range"
                                        min="0"
                                        max="3"
                                        step="0.1"
                                        value={brightness}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            setBrightness(val);
                                            threeControllerRef.current?.setBloomStrength(val);
                                        }}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    <div
                                        className="absolute h-4 w-4 bg-white rounded-full shadow pointer-events-none transition-all duration-75"
                                        style={{ left: `calc(${(brightness / 3) * 100}% - 8px)` }}
                                    />
                                </div>
                            </div>

                            {/* Particle Color */}
                            <div>
                                <div className="text-center" style={{ marginBottom: '16px' }}>
                                    <span className="text-[11px] tracking-[0.15em] text-white/60 uppercase">Particle Color</span>
                                </div>
                                <div className="w-full">
                                    <button
                                        className="w-full py-4 rounded-lg border border-white/10 bg-white/5 flex items-center justify-between px-4 hover:bg-white/10 transition-colors group relative overflow-hidden"
                                    >
                                        <div className="flex items-center gap-3 z-10">
                                            <div
                                                className="w-5 h-5 rounded-full border border-white/20 shadow-[0_0_10px_inset_rgba(0,0,0,0.5)]"
                                                style={{ backgroundColor: modelColor }}
                                            />
                                            <span className="text-sm font-serif text-white/80">{modelColor.toUpperCase()}</span>
                                        </div>
                                        <svg className="w-3 h-3 text-white/30 z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>

                                        <input
                                            type="color"
                                            value={modelColor}
                                            onChange={(e) => {
                                                const color = e.target.value;
                                                setModelColor(color);
                                                threeControllerRef.current?.setModelColor(color);
                                            }}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* SEPARATOR */}
                        <div className="w-16 h-[1px] bg-white/10 mx-auto" style={{ marginBottom: '40px' }} />

                        {/* SECTION: INTERACTIONS */}
                        <div style={{ marginBottom: '40px' }}>
                            <h3 className="text-[10px] font-bold text-white/30 tracking-[0.2em] uppercase text-left" style={{ marginBottom: '20px' }}>Interactions</h3>

                            {/* Momentum Toggle */}
                            <div>
                                <div className="text-center" style={{ marginBottom: '16px' }}>
                                    <span className="text-[11px] tracking-[0.15em] text-white/60 uppercase">Physics Mode</span>
                                </div>
                                <button
                                    onClick={() => {
                                        const newState = !isPhysicsEnabled;
                                        setIsPhysicsEnabled(newState);
                                        threeControllerRef.current?.setPhysicsEnabled(newState);
                                    }}
                                    className={`w-full py-4 px-4 rounded-lg flex items-center justify-between transition-all duration-300 border
                                        ${isPhysicsEnabled
                                            ? 'bg-white text-black border-white'
                                            : 'bg-transparent text-white/50 border-white/10 hover:border-white/30'}
                                    `}
                                >
                                    <span className="text-sm font-serif tracking-wide">{isPhysicsEnabled ? 'Momentum On' : 'Momentum Off'}</span>
                                    {isPhysicsEnabled ? (
                                        <div className="w-2.5 h-2.5 bg-black rounded-full animate-pulse" />
                                    ) : (
                                        <div className="w-2.5 h-2.5 bg-white/20 rounded-full" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* SEPARATOR */}
                        <div className="w-16 h-[1px] bg-white/10 mx-auto" style={{ marginBottom: '40px' }} />

                        {/* SECTION: MODEL */}
                        <div>
                            <h3 className="text-[10px] font-bold text-white/30 tracking-[0.2em] uppercase text-left" style={{ marginBottom: '20px' }}>Model Source</h3>

                            <div className="grid grid-cols-3 gap-3">
                                <button
                                    onClick={() => threeControllerRef.current?.cycleToNextModel()}
                                    className="py-4 rounded-lg border border-white/10 bg-white/5 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all uppercase tracking-wider font-medium"
                                >
                                    Model
                                </button>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="py-4 rounded-lg border border-white/10 bg-white/5 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all uppercase tracking-wider font-medium"
                                >
                                    Upload
                                </button>
                                <button
                                    onClick={() => threeControllerRef.current?.resetCamera()}
                                    className="py-4 rounded-lg border border-white/10 bg-white/5 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all uppercase tracking-wider font-medium"
                                >
                                    Reset
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Fade */}
                    <div className="h-6 bg-gradient-to-t from-[#050505] to-transparent pointer-events-none absolute bottom-0 left-0 right-0" />
                </div>
            </div>


            {/* Hidden File Input for Model Upload */}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden" // Ensure it's hidden
                accept=".gltf,.glb" // Accept standard 3D formats
                style={{ display: 'none' }} // Double ensure hidden
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && threeControllerRef.current) {
                        threeControllerRef.current.loadUserModel(file);
                    }
                    // Reset input value to allow same file selection again
                    if (e.target) e.target.value = '';
                }}
            />

        </div >
    );
};
