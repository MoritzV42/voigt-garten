import { useEffect, useRef, useState, useCallback } from 'react';

interface ScrollVideoPlayerProps {
  framePath: string;
  frameCount: number;
  format?: 'webp' | 'jpg';
  scrollHeight?: string;
  children?: React.ReactNode;
  overlayOpacity?: number;
}

export default function ScrollVideoPlayer({
  framePath,
  frameCount,
  format = 'webp',
  scrollHeight = '300vh',
  children,
  overlayOpacity = 0.35,
}: ScrollVideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heroOverlayRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const loadedCountRef = useRef(0);
  const currentFrameRef = useRef(0);
  const targetFrameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lerpRafRef = useRef<number>(0);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);

  const getFrameSrc = useCallback(
    (index: number) => {
      const num = String(index + 1).padStart(4, '0');
      return `${framePath}${num}.${format}`;
    },
    [framePath, format]
  );

  const drawFrame = useCallback((frameIndex: number) => {
    const img = imagesRef.current[frameIndex];
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!img || !ctx || !canvas) return;

    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    ctx.drawImage(img, 0, 0);
  }, []);

  useEffect(() => {
    const images: (HTMLImageElement | null)[] = new Array(frameCount).fill(null);
    imagesRef.current = images;
    loadedCountRef.current = 0;

    const loadImage = (index: number): Promise<void> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          images[index] = img;
          loadedCountRef.current++;
          const progress = loadedCountRef.current / frameCount;
          setLoadProgress(progress);

          if (index === 0) {
            setIsLoading(false);
            const canvas = canvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctxRef.current = ctx;
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                ctx.drawImage(img, 0, 0);
              }
            }
          }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = getFrameSrc(index);
      });
    };

    const loadInitialBatch = async () => {
      const initialCount = Math.min(15, frameCount);
      const promises = [];
      for (let i = 0; i < initialCount; i++) {
        promises.push(loadImage(i));
      }
      await Promise.all(promises);

      for (let batch = initialCount; batch < frameCount; batch += 30) {
        const batchEnd = Math.min(batch + 30, frameCount);
        const batchPromises = [];
        for (let i = batch; i < batchEnd; i++) {
          batchPromises.push(loadImage(i));
        }
        await Promise.all(batchPromises);
      }
    };

    loadInitialBatch();

    return () => {
      imagesRef.current = [];
    };
  }, [frameCount, getFrameSrc]);

  useEffect(() => {
    const lerpSpeed = 0.12;

    const animateFrame = () => {
      const target = targetFrameRef.current;
      const current = currentFrameRef.current;

      if (Math.abs(target - current) > 0.5) {
        const next = current + (target - current) * lerpSpeed;
        currentFrameRef.current = next;
        const roundedFrame = Math.round(next);
        const clampedFrame = Math.max(0, Math.min(roundedFrame, frameCount - 1));

        if (imagesRef.current[clampedFrame]) {
          drawFrame(clampedFrame);
        }
      }

      lerpRafRef.current = requestAnimationFrame(animateFrame);
    };

    lerpRafRef.current = requestAnimationFrame(animateFrame);

    return () => {
      if (lerpRafRef.current) cancelAnimationFrame(lerpRafRef.current);
    };
  }, [frameCount, drawFrame]);

  useEffect(() => {
    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const containerHeight = container.offsetHeight;
        const viewportHeight = window.innerHeight;

        const scrolled = Math.max(
          0,
          Math.min(1, -rect.top / (containerHeight - viewportHeight))
        );

        targetFrameRef.current = Math.min(
          scrolled * (frameCount - 1),
          frameCount - 1
        );

        const overlay = heroOverlayRef.current;
        if (overlay) {
          const fadeOut = scrolled > 0.5 ? 1 - Math.min(1, (scrolled - 0.5) / 0.2) : 1;

          const reveals = overlay.querySelectorAll<HTMLElement>('[data-scroll-reveal]');
          reveals.forEach((el) => {
            const step = parseInt(el.dataset.scrollReveal || '0', 10);
            let revealOpacity: number;
            if (step === 0) {
              revealOpacity = 1;
            } else {
              const start = step * 0.03;
              const end = start + 0.07;
              revealOpacity = Math.max(0, Math.min(1, (scrolled - start) / (end - start)));
            }
            el.style.opacity = String(revealOpacity * fadeOut);
            el.style.transform = revealOpacity < 1 && step > 0
              ? `translateY(${(1 - revealOpacity) * 15}px)`
              : 'translateY(0)';
          });

          const indicator = overlay.nextElementSibling as HTMLElement | null;
          if (indicator) {
            indicator.style.opacity = scrolled < 0.02 ? '1' : '0';
          }
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [frameCount]);

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ height: scrollHeight }}
    >
      {/* Sticky canvas container */}
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        {/* First frame as background for instant visibility */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url(${getFrameSrc(0)})`,
            display: isLoading ? 'block' : 'none',
          }}
        />

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: isLoading ? 0 : 1 }}
        />

        {/* Vignette effect */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
          }}
        />

        {/* Dark overlay */}
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgba(0,0,0,${overlayOpacity})` }}
        />

        {/* Loading progress */}
        {loadProgress < 1 && (
          <div className="absolute bottom-0 left-0 right-0 z-30 h-0.5">
            <div
              className="h-full bg-white/40 transition-[width] duration-300 ease-out"
              style={{ width: `${loadProgress * 100}%` }}
            />
          </div>
        )}

        {/* Content overlay with fade — controlled via ref, no re-renders */}
        <div
          ref={heroOverlayRef}
          className="absolute inset-0 flex items-center justify-center z-10"
        >
          {children}
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 animate-bounce text-white/70 flex flex-col items-center gap-1 transition-opacity duration-300">
          <span className="text-xs tracking-widest uppercase">Scroll</span>
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
