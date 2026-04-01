import { useEffect, useRef } from 'react';

interface PanoramaViewerProps {
  imageUrl: string;
  onClose?: () => void;
}

declare global {
  interface Window {
    pannellum: any;
  }
}

export default function PanoramaViewer({ imageUrl, onClose }: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !window.pannellum) return;

    viewerRef.current = window.pannellum.viewer(containerRef.current, {
      type: 'equirectangular',
      panorama: imageUrl,
      autoLoad: true,
      autoRotate: -2,
      compass: true,
      showZoomCtrl: true,
      showFullscreenCtrl: true,
      mouseZoom: true,
    });

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
      }
    };
  }, [imageUrl]);

  if (onClose) {
    // Standalone fullscreen mode
    return (
      <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
        <div className="flex justify-between items-center p-4">
          <span className="text-white/70 text-sm">Bewege die Maus zum Umsehen</span>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-3xl"
          >
            &times;
          </button>
        </div>
        <div ref={containerRef} className="flex-1 w-full" />
      </div>
    );
  }

  // Inline mode (for lightbox)
  return <div ref={containerRef} className="w-full h-full min-h-[400px]" />;
}
