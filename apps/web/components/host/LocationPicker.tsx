"use client";

import dynamic from "next/dynamic";

const PickerMap = dynamic(() => import("@/components/map/PickerMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 animate-pulse bg-placeholder" aria-hidden="true" />
  ),
});

export function LocationPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
}) {
  return (
    <div className="relative h-[300px] overflow-hidden rounded-[14px] border border-line">
      <PickerMap latitude={latitude} longitude={longitude} onChange={onChange} />
    </div>
  );
}
