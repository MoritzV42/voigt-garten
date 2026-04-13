import { useState, useCallback, useEffect } from 'react';
import GardenMap, { type PhotoPoint } from './GardenMap';
import AreaGallery from './AreaGallery';
import { MAP_AREAS } from './mapAreas';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5055' : '';

export default function GartenkarteWrapper() {
  const [activeArea, setActiveArea] = useState<string | undefined>();
  const [previousArea, setPreviousArea] = useState<string | undefined>();
  const [photoPoints, setPhotoPoints] = useState<PhotoPoint[]>([]);

  const handleAreaClick = useCallback((areaId: string) => {
    setPreviousArea(activeArea);
    setActiveArea(prev => prev === areaId ? undefined : areaId);
  }, [activeArea]);

  // Fetch photo points for map display
  useEffect(() => {
    fetch(`${API_BASE}/api/map/photo-points`)
      .then(r => r.json())
      .then(data => setPhotoPoints(data.points || []))
      .catch(() => {});
  }, []);

  // Area order by approximate X coordinate on the map (left to right)
  const areaOrder = MAP_AREAS.map(a => a.id);

  return (
    <div className="space-y-8">
      <div id="gartenkarte-fullscreen" className="relative">
        <GardenMap
          mode="alle"
          showModeSwitch={true}
          onAreaClick={handleAreaClick}
          activeArea={activeArea}
          photoPoints={photoPoints}
          showPhotoPoints={true}
          onPhotoPointClick={(id) => {
            window.location.href = `/galerie#photo-${id}`;
          }}
        />
      </div>

      {/* Area Gallery below the map */}
      <AreaGallery
        activeArea={activeArea}
        previousArea={previousArea}
        areaOrder={areaOrder}
      />
    </div>
  );
}
