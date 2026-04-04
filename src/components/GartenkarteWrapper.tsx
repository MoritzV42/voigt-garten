import { useState, useCallback } from 'react';
import GardenMap from './GardenMap';
import AreaGallery from './AreaGallery';
import { MAP_AREAS } from './mapAreas';

export default function GartenkarteWrapper() {
  const [activeArea, setActiveArea] = useState<string | undefined>();
  const [previousArea, setPreviousArea] = useState<string | undefined>();

  const handleAreaClick = useCallback((areaId: string) => {
    setPreviousArea(activeArea);
    setActiveArea(prev => prev === areaId ? undefined : areaId);
  }, [activeArea]);

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
