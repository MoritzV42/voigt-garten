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
  scrollHeight = '250vh',
  children,
  overlayOpacity = 0.4,
}: ScrollVideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heroOverlayRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const currentFrameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const getFrameSrc = useCallback(
    (index: number) => {
      const num = String(index + 1).padStart(4, '0');
      return `${framePath}${num}.${format}`;
    },
    [framePath, format]
  );

  // Load all images with bounded concurrency + retry on transient failures
  useEffect(() => {
    let cancelled = false;
    const images: (HTMLImageElement | null)[] = new Array(frameCount).fill(null);
    imagesRef.current = images;

    const CONCURRENCY = 4;
    const MAX_RETRIES = 2;

    const loadImage = (index: number, attempt = 0): Promise<void> => {
      return new Promise((resolve) => {
        if (cancelled) return resolve();
        const img = new Image();
        img.onload = () => {
          if (cancelled) return resolve();
          images[index] = img;
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
        img.onerror = () => {
          if (cancelled || attempt >= MAX_RETRIES) return resolve();
          // Exponential backoff: 400ms, 1200ms
          const delay = 400 * Math.pow(3, attempt);
          setTimeout(() => loadImage(index, attempt + 1).then(resolve), delay);
        };
        img.src = getFrameSrc(index);
      });
    };

    const loadAll = async () => {
      // Worker-pool pattern: bounded concurrency, in-order start
      let next = 0;
      const worker = async () => {
        while (!cancelled) {
          const i = next++;
          if (i >= frameCount) return;
          await loadImage(i);
        }
      };
      const workers = Array.from({ length: Math.min(CONCURRENCY, frameCount) }, worker);
      await Promise.all(workers);
    };

    loadAll();

    return () => {
      cancelled = true;
      imagesRef.current = [];
    };
  }, [frameCount, getFrameSrc]);

  // Scroll handler — uses direct DOM manipulation to avoid React re-renders
  useEffect(() => {
    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const containerHeight = container.offsetHeight;
        const viewportHeight = window.innerHeight;

        // How far we've scrolled through the container (0 to 1)
        const scrolled = Math.max(
          0,
          Math.min(1, -rect.top / (containerHeight - viewportHeight))
        );

        // Map scroll to frame index
        const frameIndex = Math.min(
          Math.floor(scrolled * (frameCount - 1)),
          frameCount - 1
        );

        // Staggered scroll reveal + fade out — direct DOM updates
        const overlay = heroOverlayRef.current;
        if (overlay) {
          // Elements with data-scroll-reveal="0" are always visible (title)
          // Elements with data-scroll-reveal="1" fade in at 3-10% scroll
          // Elements with data-scroll-reveal="2" fade in at 6-13% scroll
          // Elements with data-scroll-reveal="3" fade in at 9-16% scroll
          // Everything fades out together after 50% scroll
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

          // Hide scroll indicator when scrolled
          const indicator = overlay.nextElementSibling as HTMLElement | null;
          if (indicator) {
            indicator.style.opacity = scrolled < 0.02 ? '1' : '0';
          }
        }

        // Draw frame if changed — find nearest loaded frame as fallback
        if (frameIndex !== currentFrameRef.current) {
          currentFrameRef.current = frameIndex;
          const ctx = ctxRef.current;
          if (ctx) {
            let img = imagesRef.current[frameIndex];
            if (!img) {
              // Find nearest loaded frame
              for (let offset = 1; offset < 10; offset++) {
                img = imagesRef.current[frameIndex - offset] ?? imagesRef.current[frameIndex + offset] ?? null;
                if (img) break;
              }
            }
            if (img) ctx.drawImage(img, 0, 0);
          }
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial call

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
