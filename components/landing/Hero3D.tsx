"use client";

import { Canvas } from "@react-three/fiber";
import {
  Environment,
  Float,
  MeshDistortMaterial,
  Sparkles,
  OrbitControls,
} from "@react-three/drei";
import { Suspense } from "react";
import * as THREE from "three";

/**
 * Elegant abstract hero scene — a softly-distorted golden orb wrapped in a
 * glassy emerald ring, floating amid sparkles. Purely decorative; renders
 * nothing meaningful for screen readers (the canvas is aria-hidden upstream).
 */

function Orb() {
  return (
    <Float speed={1.4} rotationIntensity={0.6} floatIntensity={1.1}>
      <mesh castShadow scale={1.55}>
        <icosahedronGeometry args={[1, 24]} />
        <MeshDistortMaterial
          color="#f59e0b"
          emissive="#b45309"
          emissiveIntensity={0.35}
          roughness={0.15}
          metalness={0.85}
          distort={0.32}
          speed={1.6}
        />
      </mesh>
    </Float>
  );
}

function Ring() {
  return (
    <Float speed={1.1} rotationIntensity={1.2} floatIntensity={0.6}>
      <mesh rotation={[Math.PI / 2.4, 0.4, 0]} scale={2.55}>
        <torusGeometry args={[1, 0.018, 24, 160]} />
        <meshStandardMaterial
          color="#34d399"
          emissive="#10b981"
          emissiveIntensity={0.8}
          roughness={0.2}
          metalness={0.6}
        />
      </mesh>
    </Float>
  );
}

const Hero3D = () => {
  return (
    <Canvas
      aria-hidden="true"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 6], fov: 42 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
      className="!absolute inset-0"
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={2.2} color="#fde68a" />
        <pointLight position={[-5, -3, -4]} intensity={2.4} color="#10b981" />
        <Orb />
        <Ring />
        <Sparkles
          count={70}
          scale={9}
          size={2.4}
          speed={0.4}
          opacity={0.7}
          color="#fcd34d"
        />
        <Environment preset="city" />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.7}
          minPolarAngle={Math.PI / 2.6}
          maxPolarAngle={Math.PI / 1.7}
        />
      </Suspense>
    </Canvas>
  );
};

export default Hero3D;
