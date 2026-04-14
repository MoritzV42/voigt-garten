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
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const currentFrameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [heroOpacity, setHeroOpacity] = useState(1);

  const getFrameSrc = useCallback(
    (index: number) => {
      const num = String(index + 1).padStart(4, '0');
      return `${framePath}${num}.${format}`;
    },
    [framePath, format]
  );

  // Load images progressively
  useEffect(() => {
    const images: (HTMLImageElement | null)[] = new Array(frameCount).fill(null);
    imagesRef.current = images;

    const loadImage = (index: number): Promise<void> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          images[index] = img;
          if (index === 0) {
            setIsLoading(false);
            // Draw first frame immediately
            const canvas = canvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
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

    // Load first 10 frames immediately
    const loadInitialBatch = async () => {
      const initialCount = Math.min(10, frameCount);
      const promises = [];
      for (let i = 0; i < initialCount; i++) {
        promises.push(loadImage(i));
      }
      await Promise.all(promises);

      // Load rest in batches of 20
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
  }, [frameCount, getFrameSrc]);

  // Scroll handler
  useEffect(() => {
    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

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

        // Hero text fades out in first 30% of scroll
        const fadeProgress = Math.min(1, scrolled / 0.3);
        setHeroOpacity(1 - fadeProgress);

        // Draw frame if changed
        if (frameIndex !== currentFrameRef.current) {
          currentFrameRef.current = frameIndex;
          const img = imagesRef.current[frameIndex];
          if (img) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
            }
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

        {/* Content overlay with fade */}
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ opacity: heroOpacity }}
        >
          {children}
        </div>

        {/* Scroll indicator */}
        {heroOpacity > 0.8 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 animate-bounce text-white/70 flex flex-col items-center gap-1">
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
        )}

        {/* Test label */}
        <div className="absolute top-4 right-4 z-20 bg-yellow-500/90 text-black text-xs font-bold px-3 py-1 rounded-full">
          TEST — Drohnenvideo Scroll-Animation
        </div>
      </div>
    </div>
  );
}
