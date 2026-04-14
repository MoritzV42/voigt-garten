import { useEffect, useRef, useState } from "react";

interface TutorialOverlayProps {
  isActive: boolean;
  currentStep: number;
  steps: { target: string; title: string; body: string; page: string }[];
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

export default function TutorialOverlay({
  isActive,
  currentStep,
  steps,
  onNext,
  onPrev,
  onSkip,
}: TutorialOverlayProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = steps[currentStep];

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Lock/unlock scroll on body
  useEffect(() => {
    if (scrollLocked) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [scrollLocked]);

  // Unlock scroll when tutorial ends
  useEffect(() => {
    if (!isActive) setScrollLocked(false);
  }, [isActive]);

  // Find and scroll to target element, then lock scroll
  useEffect(() => {
    if (!isActive || !step?.target) {
      setTargetRect(null);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30;
    const selector = `[data-tutorial="${step.target}"]`;

    // Temporarily unlock scroll so scrollIntoView works
    setScrollLocked(false);

    function findTarget() {
      if (cancelled) return;
      const el = document.querySelector(selector);
      if (el) {
        // Scroll to top of page for hero-section (so sticky canvas is visible)
        if (step.target === "hero-section") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        setTimeout(() => {
          if (cancelled) return;
          requestAnimationFrame(() => {
            if (cancelled) return;
            let rect = el.getBoundingClientRect();
            // For very tall elements (like scroll-video containers),
            // clamp the highlight to the visible viewport portion
            if (rect.height > window.innerHeight) {
              rect = new DOMRect(
                rect.left,
                Math.max(rect.top, 0),
                rect.width,
                Math.min(rect.height, window.innerHeight)
              );
            }
            if (rect.width > 0 && rect.height > 0) {
              setTargetRect(rect);
              // Lock scroll after positioning
              setScrollLocked(true);
            } else if (attempts < maxAttempts) {
              attempts++;
              setTimeout(findTarget, 100);
            }
          });
        }, 400);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(findTarget, 100);
      }
    }

    findTarget();

    return () => {
      cancelled = true;
    };
  }, [isActive, step?.target, currentStep]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onSkip();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "ArrowLeft") onPrev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActive, onNext, onPrev, onSkip]);

  // Block scroll events on the backdrop (wheel, touch)
  useEffect(() => {
    if (!isActive || !scrollLocked) return;
    const prevent = (e: Event) => e.preventDefault();
    window.addEventListener("wheel", prevent, { passive: false });
    window.addEventListener("touchmove", prevent, { passive: false });
    return () => {
      window.removeEventListener("wheel", prevent);
      window.removeEventListener("touchmove", prevent);
    };
  }, [isActive, scrollLocked]);

  if (!isActive || !step || !targetRect) return null;

  const padding = 8;
  const spotlightStyle: React.CSSProperties = {
    position: "fixed",
    top: targetRect.top - padding,
    left: targetRect.left - padding,
    width: targetRect.width + padding * 2,
    height: targetRect.height + padding * 2,
    borderRadius: 16,
    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
    pointerEvents: "none",
    zIndex: 60,
  };

  const tooltipWidth = isMobile ? window.innerWidth - 32 : 340;
  let tooltipTop: number;
  let tooltipLeft: number;

  if (isMobile) {
    tooltipTop = window.innerHeight - 240;
    tooltipLeft = 16;
  } else {
    const spaceBelow = window.innerHeight - targetRect.bottom;
    tooltipTop = spaceBelow > 200
      ? targetRect.bottom + padding + 12
      : targetRect.top - padding - 200;
    tooltipLeft = Math.max(
      16,
      Math.min(
        targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
        window.innerWidth - tooltipWidth - 16
      )
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60]"
        style={{ pointerEvents: "auto" }}
        onClick={onSkip}
      />

      {/* Spotlight */}
      <div style={spotlightStyle} />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-[61]"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          width: tooltipWidth,
          animation: "fadeSlideUp 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl border border-garden-200 bg-white p-5 shadow-xl">
          <h3 className="font-display text-lg text-gray-900">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            {step.body}
          </p>

          {/* Step dots */}
          <div className="mt-4 flex items-center gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep
                    ? "w-4 bg-garden-600"
                    : "w-1.5 bg-garden-200"
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={onSkip}
              className="text-sm text-gray-500 transition hover:text-gray-800"
            >
              Überspringen
            </button>
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={onPrev}
                  className="rounded-xl border border-garden-200 px-4 py-2 text-sm font-medium text-gray-800 transition hover:border-garden-400"
                >
                  Zurück
                </button>
              )}
              <button
                onClick={onNext}
                className="rounded-xl bg-garden-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-garden-700"
              >
                {currentStep === steps.length - 1 ? "Fertig" : "Weiter"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
