import { Star } from "lucide-react";

import { cn } from "@/lib/cn";
import { formatRating } from "@/lib/format";

export function Rating({
  rating,
  className,
  size = 14,
}: {
  rating: number;
  className?: string;
  size?: number;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-bold", className)}>
      <Star size={size} strokeWidth={2.2} className="fill-brand text-brand" />
      <span className="tabular-nums">{formatRating(rating)}</span>
      <span className="sr-only">na 10</span>
    </span>
  );
}
