"use client";

import dynamic from "next/dynamic";

const MiniMap = dynamic(() => import("@/components/map/MiniMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 animate-pulse bg-[#EDE7DA]" aria-hidden="true" />
  ),
});

export function PropertyLocation({
  latitude,
  longitude,
  label,
}: {
  latitude: number;
  longitude: number;
  label: string;
}) {
  return (
    <div className="relative h-[280px] overflow-hidden rounded-[14px] border border-line sm:h-[320px]">
      <MiniMap latitude={latitude} longitude={longitude} label={label} />
    </div>
  );
}
