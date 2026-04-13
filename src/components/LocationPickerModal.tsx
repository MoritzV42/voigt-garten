import { useState } from 'react';
import GardenMap from './GardenMap';

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (x: number, y: number) => void;
  imageUrl?: string;
  imageName?: string;
}

export default function LocationPickerModal({
  isOpen,
  onClose,
  onSave,
  imageUrl,
  imageName,
}: LocationPickerModalProps) {
  const [pickedLocation, setPickedLocation] = useState<{ x: number; y: number } | null>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    if (pickedLocation) {
      onSave(pickedLocation.x, pickedLocation.y);
      setPickedLocation(null);
    }
  };

  const handleClose = () => {
    setPickedLocation(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 p-4 border-b bg-gray-50">
          {imageUrl && (
            <img
              src={imageUrl}
              alt={imageName || 'Bild'}
              className="w-14 h-14 object-cover rounded-lg shadow"
            />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {imageName || 'Standort setzen'}
            </h3>
            <p className="text-sm text-gray-500">
              Klicke auf die Stelle im Garten, wo dieses Foto aufgenommen wurde
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Map */}
        <div className="flex-1 overflow-auto p-4">
          <GardenMap
            mode="alle"
            showModeSwitch={false}
            pickMode={true}
            onLocationPick={(x, y) => setPickedLocation({ x, y })}
            pickedLocation={pickedLocation}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <div className="text-sm text-gray-500">
            {pickedLocation
              ? `Position: ${pickedLocation.x}, ${pickedLocation.y}`
              : 'Noch kein Standort gewählt'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={!pickedLocation}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition ${
                pickedLocation
                  ? 'bg-garden-600 text-white hover:bg-garden-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Standort speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
