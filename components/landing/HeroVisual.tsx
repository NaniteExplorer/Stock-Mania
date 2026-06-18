"use client";

import dynamic from "next/dynamic";

const Hero3D = dynamic(() => import("@/components/landing/Hero3D"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 animate-pulse">
      <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-500/30 blur-3xl" />
    </div>
  ),
});

const HeroVisual = () => {
  return (
    <div className="relative aspect-square w-full max-w-[560px]">
      {/* glow halo behind the canvas */}
      <div className="absolute inset-8 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.28),transparent_70%)] blur-2xl" />
      <Hero3D />
    </div>
  );
};

export default HeroVisual;
