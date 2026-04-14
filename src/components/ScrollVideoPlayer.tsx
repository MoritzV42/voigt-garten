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
  const currentFrameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const getFrameSrc = useCallback(
    (index: number) => {
      const num = String(index + 1).padStart(4, '0');
      return `${framePath}${num}.${format}`;
    },
    [framePath, format]
  );

  const drawFrame = useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    const scale = Math.max(cw / iw, ch / ih);
    const sw = iw * scale;
    const sh = ih * scale;
    const sx = (cw - sw) / 2;
    const sy = (ch - sh) / 2;

    ctx.drawImage(img, sx, sy, sw, sh);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const img = imagesRef.current[currentFrameRef.current];
      if (img) drawFrame(img);
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [drawFrame]);

  useEffect(() => {
    const images: (HTMLImageElement | null)[] = new Array(frameCount).fill(null);
    imagesRef.current = images;
    let loadedCount = 0;

    const loadImage = (index: number): Promise<void> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          images[index] = img;
          loadedCount++;
          setLoadProgress(Math.round((loadedCount / frameCount) * 100));
          if (index === 0) {
            setIsLoading(false);
            drawFrame(img);
          }
          resolve();
        };
        img.onerror = () => {
          loadedCount++;
          resolve();
        };
        img.src = getFrameSrc(index);
      });
    };

    const loadInitialBatch = async () => {
      const initialCount = Math.min(10, frameCount);
      const promises = [];
      for (let i = 0; i < initialCount; i++) {
        promises.push(loadImage(i));
      }
      await Promise.all(promises);

      for (let batch = initialCount; batch < frameCount; batch += 20) {
        const batchEnd = Math.min(batch + 20, frameCount);
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
  }, [frameCount, getFrameSrc, drawFrame]);

  useEffect(() => {
    if (prefersReducedMotion) return;

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

        const frameIndex = Math.min(
          Math.floor(scrolled * (frameCount - 1)),
          frameCount - 1
        );

        const heroOpacity = 1 - Math.min(1, scrolled / 0.25);
        const overlay = heroOverlayRef.current;
        if (overlay) {
          overlay.style.opacity = String(heroOpacity);
          overlay.style.transform = `translateY(${scrolled * -60}px)`;
          const indicator = overlay.nextElementSibling as HTMLElement | null;
          if (indicator) {
            indicator.style.opacity = heroOpacity > 0.8 ? '1' : '0';
          }
        }

        if (frameIndex !== currentFrameRef.current) {
          currentFrameRef.current = frameIndex;
          const img = imagesRef.current[frameIndex];
          if (img) {
            drawFrame(img);
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
  }, [frameCount, prefersReducedMotion, drawFrame]);

  if (prefersReducedMotion) {
    return (
      <div className="relative h-screen w-full overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${getFrameSrc(0)})` }}
        />
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgba(0,0,0,${overlayOpacity})` }}
        />
        <div className="absolute inset-0 flex items-center justify-center z-10">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ height: scrollHeight }}
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-500"
          style={{
            backgroundImage: `url(${getFrameSrc(0)})`,
            opacity: isLoading ? 1 : 0,
          }}
        />

        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ opacity: isLoading ? 0 : 1, transition: 'opacity 0.5s' }}
        />

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)',
          }}
        />

        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgba(0,0,0,${overlayOpacity})` }}
        />

        <div
          ref={heroOverlayRef}
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ willChange: 'opacity, transform' }}
        >
          {children}
        </div>

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

        {isLoading && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
            <div className="w-32 h-1 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white/70 rounded-full transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
