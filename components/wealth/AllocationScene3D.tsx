"use client";

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useRef, useState } from "react";
import type { Group } from "three";

export interface Slice3D {
  key: string;
  label: string;
  value: number;
  percent: number;
}

const GAP = 0.05; // radians between segments

interface SegmentProps {
  start: number;
  length: number;
  color: string;
  raised: boolean;
  onOver: () => void;
  onOut: () => void;
  onSelect: () => void;
}

/** One extruded torus arc representing an asset class. */
function Segment({ start, length, color, raised, onOver, onOut, onSelect }: SegmentProps) {
  const mid = start + length / 2;
  const offset = raised ? 0.16 : 0;
  return (
    <mesh
      rotation={[0, 0, start]}
      position={[Math.cos(mid) * offset, Math.sin(mid) * offset, 0]}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onOver();
      }}
      onPointerOut={onOut}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <torusGeometry args={[1.45, 0.4, 28, 80, Math.max(length - GAP, 0.02)]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={raised ? 0.85 : 0.4}
        metalness={0.4}
        roughness={0.25}
      />
    </mesh>
  );
}

interface RingProps {
  slices: Slice3D[];
  colorOf: (key: string) => string;
  onSelect: (key: string) => void;
}

function Ring({ slices, colorOf, onSelect }: RingProps) {
  const group = useRef<Group>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.z -= delta * 0.1;
  });

  const TWO_PI = Math.PI * 2;
  return (
    <group ref={group} rotation={[-0.95, 0, 0]}>
      {slices.map((s, i) => {
        // Cumulative start angle from the top (no render-time mutation).
        const startPct = slices.slice(0, i).reduce((sum, x) => sum + x.percent, 0);
        const start = Math.PI / 2 + (startPct / 100) * TWO_PI;
        const length = (s.percent / 100) * TWO_PI;
        return (
          <Segment
            key={s.key}
            start={start}
            length={length}
            color={colorOf(s.key)}
            raised={hovered === s.key}
            onOver={() => {
              setHovered(s.key);
              document.body.style.cursor = "pointer";
            }}
            onOut={() => {
              setHovered(null);
              document.body.style.cursor = "";
            }}
            onSelect={() => onSelect(s.key)}
          />
        );
      })}
    </group>
  );
}

interface SceneProps {
  slices: Slice3D[];
  colorOf: (key: string) => string;
  onSelect: (key: string) => void;
  centerLabel: string;
  centerValue: string;
}

export default function AllocationScene3D({
  slices,
  colorOf,
  onSelect,
  centerLabel,
  centerValue,
}: SceneProps) {
  return (
    <div className="relative h-[240px] w-full">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 4.4], fov: 46 }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.85} />
        <pointLight position={[4, 5, 5]} intensity={2.2} color="#ffffff" />
        <pointLight position={[-4, -2, 3]} intensity={1.3} color="#9d90ff" />
        <Suspense fallback={null}>
          <Ring slices={slices} colorOf={colorOf} onSelect={onSelect} />
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {centerLabel}
        </span>
        <span className="text-lg font-bold tracking-tight text-gray-100 tnum">
          {centerValue}
        </span>
      </div>
    </div>
  );
}
