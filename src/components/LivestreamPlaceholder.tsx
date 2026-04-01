import { useState, useEffect } from 'react';

export default function LivestreamPlaceholder() {
  const [cameraCount, setCameraCount] = useState(0);
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    const fetchCameras = async () => {
      try {
        const response = await fetch('/api/livestream/cameras');
        if (response.ok) {
          const data = await response.json();
          setCameraCount(data.cameras.length);
          setIsAvailable(data.available);
        }
      } catch (error) {
        // Silently fail - placeholder shows "coming soon" anyway
      }
    };

    fetchCameras();
  }, []);

  if (isAvailable) {
    // Future: render actual livestream player
    // RTSP -> ffmpeg -> HLS segments
    // Privacy mode: cameras off during active bookings
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 text-center">
      <div className="max-w-md mx-auto">
        <div className="text-5xl mb-4">📹</div>
        <h3 className="font-display text-xl font-bold text-white mb-2">
          Livestream kommt bald
        </h3>
        <p className="text-gray-400 text-sm">
          Bald kannst du hier live den Garten beobachten.
          Wetterkameras und Gartenansichten in Echtzeit.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 bg-gray-700/50 px-4 py-2 rounded-full text-gray-300 text-xs">
          <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
          In Vorbereitung
        </div>
      </div>
    </div>
  );
}
