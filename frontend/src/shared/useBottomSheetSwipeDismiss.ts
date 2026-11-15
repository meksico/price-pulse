import { useEffect, useRef, type RefObject } from "react";

const MOBILE_BREAKPOINT_PX = 640;
const DRAG_ACTIVATION_PX = 6;
const DISMISS_DISTANCE_PX = 72;
const FLICK_MIN_DISTANCE_PX = 36;
const FLICK_VELOCITY_PX_PER_MS = 0.5;
const ANIMATION_MS = 180;

interface UseBottomSheetSwipeDismissOptions {
  sheetRef: RefObject<HTMLElement | null>;
  handleRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
  disabled?: boolean;
  onClose: () => void;
}

interface DragSession {
  mode: "touch" | "pointer";
  pointerId: number | null;
  startX: number;
  startY: number;
  startTime: number;
  lastY: number;
  dragging: boolean;
}

export function useBottomSheetSwipeDismiss({
  sheetRef,
  handleRef,
  isOpen,
  disabled = false,
  onClose,
}: UseBottomSheetSwipeDismissOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleEl = handleRef.current;
    const sheetEl = sheetRef.current;
    if (!isOpen || disabled || !handleEl || !sheetEl) return;

    let session: DragSession | null = null;
    let animationTimer: number | null = null;
    let clickGuardTimer: number | null = null;
    let disposed = false;

    const clearSheetStyles = () => {
      sheetEl.style.transform = "";
      sheetEl.style.transition = "";
      sheetEl.style.opacity = "";
      sheetEl.style.willChange = "";
    };

    const clearTimers = () => {
      if (animationTimer !== null) {
        window.clearTimeout(animationTimer);
        animationTimer = null;
      }
      if (clickGuardTimer !== null) {
        window.clearTimeout(clickGuardTimer);
        clickGuardTimer = null;
      }
    };

    const suppressNextClick = () => {
      const blockClick = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener("click", blockClick, { capture: true, once: true });
      clickGuardTimer = window.setTimeout(() => {
        window.removeEventListener("click", blockClick, { capture: true });
        clickGuardTimer = null;
      }, 120);
    };

    const isEligibleViewport = () => window.innerWidth < MOBILE_BREAKPOINT_PX;

    const startDrag = (
      mode: "touch" | "pointer",
      pointerId: number | null,
      clientX: number,
      clientY: number,
    ) => {
      if (disposed || !isEligibleViewport()) return;
      if (sheetEl.scrollTop > 0) return;
      clearTimers();
      session = {
        mode,
        pointerId,
        startX: clientX,
        startY: clientY,
        startTime: performance.now(),
        lastY: clientY,
        dragging: false,
      };
    };

    const moveDrag = (clientX: number, clientY: number, event?: Event) => {
      if (!session || disposed) return;
      const deltaX = clientX - session.startX;
      const deltaY = clientY - session.startY;
      session.lastY = clientY;

      if (!session.dragging) {
        if (Math.abs(deltaX) > DRAG_ACTIVATION_PX && Math.abs(deltaX) >= deltaY) {
          session = null;
          return;
        }
        if (deltaY > DRAG_ACTIVATION_PX && deltaY > Math.abs(deltaX)) {
          session.dragging = true;
          sheetEl.style.willChange = "transform, opacity";
          sheetEl.style.transition = "none";
        } else {
          return;
        }
      }

      if (event?.cancelable) {
        event.preventDefault();
      }
      const clampedY = Math.max(0, deltaY);
      sheetEl.style.transform = `translate3d(0, ${clampedY}px, 0)`;
    };

    const endDrag = (cancelled = false) => {
      if (!session) return;
      const activeSession = session;
      session = null;
      if (!activeSession.dragging) return;

      suppressNextClick();

      const deltaY = Math.max(0, activeSession.lastY - activeSession.startY);
      const elapsedMs = Math.max(1, performance.now() - activeSession.startTime);
      const velocity = deltaY / elapsedMs;
      const shouldDismiss =
        !cancelled &&
        (deltaY >= DISMISS_DISTANCE_PX ||
          (deltaY >= FLICK_MIN_DISTANCE_PX &&
            velocity >= FLICK_VELOCITY_PX_PER_MS));

      sheetEl.style.transition =
        `transform ${ANIMATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${ANIMATION_MS}ms ease-out`;

      if (shouldDismiss) {
        sheetEl.style.transform = "translate3d(0, 100%, 0)";
        sheetEl.style.opacity = "0";
        animationTimer = window.setTimeout(() => {
          animationTimer = null;
          if (disposed) return;
          clearSheetStyles();
          onCloseRef.current();
        }, ANIMATION_MS);
      } else {
        sheetEl.style.transform = "translate3d(0, 0px, 0)";
        sheetEl.style.opacity = "";
        animationTimer = window.setTimeout(() => {
          animationTimer = null;
          if (!disposed) clearSheetStyles();
        }, ANIMATION_MS);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        session = null;
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      startDrag("touch", null, touch.clientX, touch.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!session || session.mode !== "touch") return;
      const touch = e.touches[0];
      if (!touch) return;
      moveDrag(touch.clientX, touch.clientY, e);
    };

    const onTouchEnd = () => {
      if (!session || session.mode !== "touch") return;
      endDrag(false);
    };

    const onTouchCancel = () => {
      if (!session || session.mode !== "touch") return;
      endDrag(true);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      startDrag("pointer", e.pointerId, e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (
        !session ||
        session.mode !== "pointer" ||
        session.pointerId !== e.pointerId
      ) {
        return;
      }
      moveDrag(e.clientX, e.clientY, e);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (
        !session ||
        session.mode !== "pointer" ||
        session.pointerId !== e.pointerId
      ) {
        return;
      }
      endDrag(false);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (
        !session ||
        session.mode !== "pointer" ||
        session.pointerId !== e.pointerId
      ) {
        return;
      }
      endDrag(true);
    };

    handleEl.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    handleEl.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);

    return () => {
      disposed = true;
      session = null;
      clearTimers();
      clearSheetStyles();
      handleEl.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);

      handleEl.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [sheetRef, handleRef, isOpen, disabled]);
}
