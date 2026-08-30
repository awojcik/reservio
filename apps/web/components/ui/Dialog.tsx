"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** Centered panel on desktop, bottom sheet below `sm`. */
export function DialogContent({
  title,
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/35" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border border-line bg-surface",
          "inset-x-0 bottom-0 max-h-[86dvh] rounded-t-[18px]",
          "sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-[min(30rem,calc(100vw-2rem))]",
          "sm:max-h-[80dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[16px]",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <DialogPrimitive.Title className="text-[19px] font-bold tracking-tight">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Zamknij"
            className="flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X size={18} strokeWidth={2.4} />
          </DialogPrimitive.Close>
        </div>

        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
