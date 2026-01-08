import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { GestureResult } from "./gestures";

export type ThreeController = {
    setModelByIndex: (index: number) => void;
    loadUserModel: (file: File) => Promise<void>;
    applyGesture: (gesture: GestureResult) => void;
    resize: (width: number, height: number) => void;
    resetCamera: () => void;
    setBloomStrength: (strength: number) => void;
    setPhysicsEnabled: (enabled: boolean) => void;
    setModelColor: (color: string | number) => void;
    cycleToNextModel: () => void;
    dispose: () => void;
};

export async function initThreeScene(canvas: HTMLCanvasElement): Promise<ThreeController> {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510); // Deep space blue
    scene.fog = new THREE.FogExp2(0x050510, 0.15); // Fog for depth

    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ReinhardToneMapping;

    // --- Post Processing (BLOOM) ---
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5, // Strength
        0.4, // Radius
        0.85 // Threshold
    );
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 2); // Brighter
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    // --- Starfield Background ---
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPosArray = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
        starPosArray[i] = (Math.random() - 0.5) * 50;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPosArray, 3));
    const starMaterial = new THREE.PointsMaterial({
        size: 0.05,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
    });
    const starField = new THREE.Points(starGeometry, starMaterial);
    scene.add(starField);

    // Container to hold models so transforms (position/rotation) persist across model swaps
    const modelContainer = new THREE.Group();
    scene.add(modelContainer);

    // currentObject now refers to the container, which is what we manipulate with gestures
    const currentObject: THREE.Object3D = modelContainer;

    // let currentObject: THREE.Object3D | null = null; // Removed old logic
    const loader = new GLTFLoader();

    // Physics & Smoothing State
    let isPhysicsEnabled = false;
    let zoomVelocity = 0;
    const targetPosition = new THREE.Vector3(0, 0, 0); // For smooth damping
    let currentModelColor = new THREE.Color(0x00ffff); // Default Cyan

    // Helper to create particle mesh from geometry
    // Helper to create particle mesh from geometry
    const createParticleMesh = (geometry: THREE.BufferGeometry, overrideColor?: THREE.Color) => {
        const material = new THREE.PointsMaterial({
            color: overrideColor || currentModelColor, // Use override or dynamic
            size: 0.05,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
        });

        if (overrideColor) {
            material.userData.preserveColor = true;
        }

        const points = new THREE.Points(geometry, material);
        return points;
    };

    // Store both Geometries (default) and Object3D (uploaded)
    const models: (THREE.BufferGeometry | THREE.Object3D)[] = [
        new THREE.BoxGeometry(2, 2, 2, 10, 10, 10),
        new THREE.SphereGeometry(1.5, 32, 32),
        new THREE.TorusGeometry(1.2, 0.5, 16, 100),
        new THREE.CylinderGeometry(1, 1, 2, 32, 10),
        new THREE.ConeGeometry(1.5, 3, 32, 10),
        new THREE.IcosahedronGeometry(1.5, 2),
        new THREE.DodecahedronGeometry(1.5, 1),
    ];

    const setModelByIndex = (index: number) => {
        // Clear previous model from container
        modelContainer.clear();

        if (index >= 0 && index < models.length) {
            const item = models[index];
            let newMesh: THREE.Object3D;

            if (item instanceof THREE.BufferGeometry) {
                // Default shapes: Create particle mesh
                newMesh = createParticleMesh(item);
            } else {
                // Uploaded models: Clone the object
                newMesh = item.clone();
            }

            // Allow physics or other properties to update if needed?
            // Nothing specific needed here for now.

            modelContainer.add(newMesh);
        }
    };

    // Set initial model (Cube)
    setModelByIndex(0);

    const loadUserModel = async (file: File) => {
        try {
            const url = URL.createObjectURL(file);
            const gltf = await loader.loadAsync(url);

            // Create a group to hold the particle version of the model
            const particleGroup = new THREE.Group();

            gltf.scene.traverse((child) => {
                if ((child as any).isMesh) {
                    const mesh = child as THREE.Mesh;
                    // Create particles from this mesh's geometry
                    // Clone geometry to avoid mutating original resource if shared
                    const geometry = mesh.geometry.clone();

                    // Extract color from original material if available
                    let originalColor: THREE.Color | undefined;
                    if (mesh.material) {
                        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
                        if ((mat as any).color) {
                            originalColor = (mat as any).color;
                        }
                    }

                    const points = createParticleMesh(geometry, originalColor);

                    // Copy transforms
                    points.position.copy(mesh.position);
                    points.rotation.copy(mesh.rotation);
                    points.scale.copy(mesh.scale);

                    particleGroup.add(points);
                }
            });

            // If no meshes found, maybe it's just point clouds? Or empty?
            if (particleGroup.children.length === 0) {
                // Fallback: just add the scene as is (maybe it's lights/cameras?)
                particleGroup.add(gltf.scene);
            }

            // Auto-fit processing
            const box = new THREE.Box3().setFromObject(particleGroup);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 3 / (maxDim || 1); // Avoid div by zero
            particleGroup.scale.set(scale, scale, scale);

            // Center
            const center = box.getCenter(new THREE.Vector3());
            particleGroup.position.sub(center.multiplyScalar(scale));

            // Add to cycle
            models.push(particleGroup);

            // Switch to new model immediately
            currentShapeIndex = models.length - 1;
            setModelByIndex(currentShapeIndex);

            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Failed to load model", err);
            alert("Failed to load model (Support: GLB/GLTF)");
        }
    };

    const applyGesture = (gesture: GestureResult) => {
        if (!currentObject) return;

        switch (gesture.mode) {
            case "zoom_in":
            case "zoom_out":
                if (gesture.scaleDelta) {
                    const s = currentObject.scale.x * gesture.scaleDelta;
                    currentObject.scale.set(s, s, s);

                    // Update Velocity for Physics
                    if (isPhysicsEnabled) {
                        // Velocity is the difference from 1.0 (neutral)
                        // e.g., scaleDelta 1.05 -> vel +0.05
                        zoomVelocity = gesture.scaleDelta - 1;
                    }
                }
                break;
            case "move":
                // 1. Translation (Move)
                if (gesture.translateDelta) {
                    const factor = 2.5; // Increased sensitivity (was 0.5)
                    // Update: Reverted to -= based on user feedback (Left -> Left)
                    // Modify TARGET position for smoothing
                    targetPosition.x -= gesture.translateDelta.dx * factor;
                    targetPosition.y -= gesture.translateDelta.dy * factor;
                }

                // 2. Rotation (New)
                if (gesture.rotation) {
                    // Create target quaternion from hand rotation
                    // Hand rotation comes from gestures.ts as {x: pitch, y: yaw, z: roll}

                    // We want 1:1 mapping with the hand.
                    // Pitch (X): Hand tips forward -> Model tips forward.
                    // Yaw (Y): Hand turns left -> Model turns left.
                    // Roll (Z): Hand tilts side -> Model tilts side.

                    const targetEuler = new THREE.Euler(

                        gesture.rotation.x + 1.57, // Correcting offset
                        -gesture.rotation.y, // Mirror Yaw for Selfie Mode feeling
                        -gesture.rotation.z, // Invert Roll for mirrored interaction
                        'XYZ'
                    );
                    const targetQuaternion = new THREE.Quaternion().setFromEuler(targetEuler);

                    // Smoothly interpolate current rotation to target
                    // Adjust slerp factor for smoothness vs responsiveness (0.1 is smooth, 0.5 is fast)
                    currentObject.quaternion.slerp(targetQuaternion, 0.1);
                }
                break;
            case "cycle_model":
                if (gesture.cycleModel) {
                    cycleToNextModel();
                }
                break;
        }
    };

    let currentShapeIndex = 0;

    const cycleToNextModel = () => {
        currentShapeIndex = (currentShapeIndex + 1) % models.length;
        setModelByIndex(currentShapeIndex);
    };

    const resetCamera = () => {
        if (!currentObject) return;
        targetPosition.set(0, 0, 0); // Reset smoothing target
        currentObject.position.set(0, 0, 0);
        currentObject.rotation.set(0, 0, 0);
        zoomVelocity = 0; // Stop any physics
        // Reset scale based on original fit
        // const box = new THREE.Box3().setFromObject(currentObject);
        // This is tricky because we modified the scale. 
        // Ideally we'd store initial scale. 
        // For simplicity, cycle models effectively resets the current one:
        setModelByIndex(currentShapeIndex);
    };

    const resize = (width: number, height: number) => {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        composer.setSize(width, height);
    };

    // Animation Loop
    let animationId: number;
    const loop = () => {
        animationId = requestAnimationFrame(loop);

        const time = performance.now() * 0.001;

        // Optimize: Only rotate if starField exists (which it does)
        starField.rotation.y = time * 0.05;

        // PHYSICS MOMENTUM
        if (isPhysicsEnabled && currentObject) {
            if (Math.abs(zoomVelocity) > 0.0001) {
                // Apply momentum
                const s = currentObject.scale.x * (1 + zoomVelocity);
                currentObject.scale.set(s, s, s);

                // Friction / Decay
                zoomVelocity *= 0.92; // 8% loss per frame
            } else {
                zoomVelocity = 0;
            }
        } else {
            // Instant stop if physics disabled
            zoomVelocity = 0;
        }

        // POSITION SMOOTHING
        if (currentObject) {
            currentObject.position.lerp(targetPosition, 0.1);
        }

        // Pulse Current Object (Iterate children since currentObject is container)
        if (currentObject) {
            currentObject.traverse((child) => {
                if ((child as any).material && (child as any).material.size) {
                    const mat = (child as any).material as THREE.PointsMaterial;
                    // Heartbeat opacity
                    mat.opacity = 0.6 + Math.sin(time * 2) * 0.2;
                }
            });

            if (!controls.enabled) {
                // Floating disabled to prioritize smooth gesture tracking
            }
        }

        controls.update();
        composer.render();
    };
    loop();

    const setBloomStrength = (strength: number) => {
        bloomPass.strength = strength;
    };

    const setPhysicsEnabled = (enabled: boolean) => {
        isPhysicsEnabled = enabled;
        if (!enabled) zoomVelocity = 0;
    };

    const setModelColor = (color: string | number) => {
        currentModelColor = new THREE.Color(color);

        // Update current object if it exists
        if (currentObject) {
            currentObject.traverse((child) => {
                if ((child as any).material) {
                    const mat = (child as any).material;
                    // Only update if not preserved
                    if (mat.color && !mat.userData.preserveColor) {
                        mat.color.set(currentModelColor);
                    }
                }
            });
        }
    };

    return {
        setModelByIndex,
        loadUserModel,
        applyGesture,
        resize,
        resetCamera,
        setBloomStrength,
        setPhysicsEnabled,
        setModelColor,
        cycleToNextModel,
        dispose: () => {
            cancelAnimationFrame(animationId);
            controls.dispose();
            renderer.dispose();
            models.forEach(item => {
                if (item instanceof THREE.BufferGeometry) item.dispose();
                // Object3D doesn't have simple dispose, need to traverse? 
                // For simplicity, let's just leave it or basic clean up
            });
        },
    };
}
