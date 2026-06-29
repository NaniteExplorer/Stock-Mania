"use client";

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Grid, Line } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import type { Group, Mesh } from "three";

const CAPITAL = [
  { key: "EQUITY", share: 38, height: 2.5, color: "#7c6cff", x: -1.75, z: .2 },
  { key: "CASH", share: 22, height: 1.45, color: "#6ea8ff", x: -.85, z: -.15 },
  { key: "PROPERTY", share: 26, height: 1.9, color: "#f0b34d", x: .15, z: .08 },
  { key: "ESOPS", share: 14, height: 1.05, color: "#2dd4bf", x: 1.1, z: -.12 },
] as const;

function CapitalTower({ item, reduced }: { item: (typeof CAPITAL)[number]; reduced: boolean }) {
  const ref = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  useFrame(({ clock }) => {
    if (!ref.current || reduced) return;
    ref.current.position.y = item.height / 2 + Math.sin(clock.elapsedTime * 1.2 + item.x) * .025;
  });
  return (
    <mesh
      ref={ref}
      position={[item.x, item.height / 2, item.z]}
      scale={hovered ? [1.06, 1.025, 1.06] : 1}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      name={`${item.key} ${item.share}%`}
    >
      <boxGeometry args={[.68, item.height, .68]} />
      <meshStandardMaterial color={item.color} emissive={item.color} emissiveIntensity={hovered ? .72 : .35} metalness={.55} roughness={.24} transparent opacity={.92} />
    </mesh>
  );
}

function Scene({ reduced }: { reduced: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ pointer }) => {
    if (!group.current || reduced) return;
    group.current.rotation.y += (pointer.x * .18 - group.current.rotation.y) * .035;
    group.current.rotation.x += (-pointer.y * .06 - group.current.rotation.x) * .035;
  });

  return (
    <group ref={group} position={[.35, -.8, 0]} rotation={[0, -.16, 0]}>
      <Grid args={[7, 5]} position={[0, 0, 0]} cellSize={.25} cellThickness={.35} cellColor="#39405d" sectionSize={1} sectionThickness={.7} sectionColor="#6157bc" fadeDistance={7} infiniteGrid />
      {CAPITAL.map((item) => <CapitalTower key={item.key} item={item} reduced={reduced} />)}

      {/* Liability is intentionally below the zero plane: it subtracts value. */}
      <mesh position={[2, -.55, .1]}>
        <boxGeometry args={[.68, 1.1, .68]} />
        <meshStandardMaterial color="#fb6f86" emissive="#fb6f86" emissiveIntensity={.28} metalness={.4} roughness={.3} transparent opacity={.82} />
      </mesh>

      {/* Capital trajectory: a readable growth curve, not ambient decoration. */}
      <Line points={[[-2.2,.25,.55],[-1.4,.72,.55],[-.55,.9,.55],[.3,1.55,.55],[1.2,1.82,.55],[2.2,2.75,.55]]} color="#63e6be" lineWidth={2} />

      {/* Rupee vault core. The HTML overlay supplies an accessible ₹ label. */}
      <mesh position={[0, .48, 1.05]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[.52, .52, .18, 48]} />
        <meshStandardMaterial color="#111421" emissive="#7c6cff" emissiveIntensity={.45} metalness={.8} roughness={.16} />
      </mesh>
      <mesh position={[0, .58, 1.05]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[.38, .025, 12, 48]} />
        <meshBasicMaterial color="#b7afff" />
      </mesh>
    </group>
  );
}

export default function Hero3D() {
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [4.8, 3.6, 6.5], fov: 38 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={.7} />
      <directionalLight position={[4, 7, 4]} intensity={2.4} color="#d8d4ff" />
      <pointLight position={[-4, 2, 3]} intensity={1.2} color="#2dd4bf" />
      <Suspense fallback={null}><Scene reduced={reduced} /></Suspense>
    </Canvas>
  );
}
