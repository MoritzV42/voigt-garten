import { useState, useEffect } from 'react';

interface VideoBackgroundProps {
  page: string;
  children: React.ReactNode;
  className?: string;
  overlayOpacity?: number;
}

export default function VideoBackground({ page, children, className = '', overlayOpacity = 0.5 }: VideoBackgroundProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchVideo = async () => {
      try {
        const response = await fetch(`/api/background-video?page=${encodeURIComponent(page)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.video_url) {
            setVideoUrl(data.video_url);
          }
        }
      } catch (error) {
        console.error('Error fetching background video:', error);
      }
    };

    fetchVideo();
  }, [page]);

  if (!videoUrl) {
    // No video assigned - render children with original background (gradient fallback)
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Video Background */}
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src={videoUrl} type="video/mp4" />
      </video>

      {/* Dark Overlay for text readability */}
      <div
        className="absolute inset-0 bg-black"
        style={{ opacity: overlayOpacity }}
      />

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
