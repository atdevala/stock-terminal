"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

// ── Shared context ─────────────────────────────────────────────────────────────
// Lets TooltipTrigger read and set the controlled open state without prop-drilling.
interface TooltipCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
}
const TooltipStateContext = React.createContext<TooltipCtx | null>(null);

// ── Tooltip root ───────────────────────────────────────────────────────────────
// Wraps Radix root with controlled open state.
//
// Desktop hover behaviour is UNCHANGED: Radix still fires onOpenChange on
// pointerenter / pointerleave and those changes flow through handleOpenChange
// into the controlled state — exactly as if Radix owned the state itself.
//
// The controlled state is also exposed via context so TooltipTrigger can
// toggle it on tap (mobile) without breaking hover (desktop).
const Tooltip = ({
  open: controlledOpen,
  onOpenChange,
  children,
  ...props
}: TooltipPrimitive.TooltipProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen! : uncontrolledOpen;

  function handleOpenChange(v: boolean) {
    if (!isControlled) setUncontrolledOpen(v);
    onOpenChange?.(v);
  }

  return (
    <TooltipStateContext.Provider value={{ open, setOpen: handleOpenChange }}>
      <TooltipPrimitive.Root
        {...props}
        open={open}
        onOpenChange={handleOpenChange}
      >
        {children}
      </TooltipPrimitive.Root>
    </TooltipStateContext.Provider>
  );
};
Tooltip.displayName = "Tooltip";

// ── TooltipTrigger ─────────────────────────────────────────────────────────────
// Desktop: hover is handled entirely by Radix (pointerenter/leave → onOpenChange).
//          The two extra handlers below are effectively invisible on desktop since
//          users hover rather than click tooltip triggers.
//
// Mobile:  touch fires pointerdown → (Radix opens) → pointerleave → click.
//          We snapshot the open state at pointerdown so the click handler knows
//          whether the tooltip was already open before the touch sequence began,
//          then toggles correctly regardless of what Radix did in between.
const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onClick, onPointerDown, ...props }, ref) => {
  const ctx = React.useContext(TooltipStateContext);
  const wasOpenRef = React.useRef(false);

  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onPointerDown={(e) => {
        // Capture state before Radix or anything else processes the press.
        wasOpenRef.current = ctx?.open ?? false;
        onPointerDown?.(e);
      }}
      onClick={(e) => {
        // Toggle based on the state at pointer-down time — not the current state —
        // so the mobile touch sequence (which may have flipped open via pointerleave)
        // always results in the correct final toggle.
        ctx?.setOpen(!wasOpenRef.current);
        onClick?.(e);
      }}
      {...props}
    />
  );
});
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

// ── TooltipContent ─────────────────────────────────────────────────────────────
// Unchanged from the original — purely presentational.
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
