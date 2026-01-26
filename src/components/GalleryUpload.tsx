import { useState, useRef, useCallback } from 'react';

interface UploadFile {
  id: string;
  file: File;
  preview: string;
  category: string;
  name: string;
  description: string;
  type: 'image' | 'video';
}

const CATEGORIES = [
  { id: 'haus', name: 'Gartenhaus', emoji: '🏡' },
  { id: 'terrasse', name: 'Terrasse', emoji: '🪴' },
  { id: 'luftaufnahmen', name: 'Luftaufnahmen', emoji: '🚁' },
  { id: 'beete', name: 'Beete', emoji: '🌻' },
  { id: 'wiese', name: 'Wiese/Rasen', emoji: '🌿' },
  { id: 'baeume', name: 'Bäume/Hecken', emoji: '🌳' },
  { id: 'sonstiges', name: 'Sonstiges', emoji: '📷' },
];

interface Props {
  onUploadComplete?: () => void;
}

export default function GalleryUpload({ onUploadComplete }: Props) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = (fileList: FileList | File[]) => {
    const newFiles: UploadFile[] = [];

    Array.from(fileList).forEach(file => {
      // Check if it's an image or video
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isImage && !isVideo) {
        alert(`"${file.name}" wird nicht unterstützt. Nur Bilder und Videos erlaubt.`);
        return;
      }

      // Create preview URL
      const preview = URL.createObjectURL(file);

      newFiles.push({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        preview,
        category: 'sonstiges', // Default category
        name: '',
        description: '',
        type: isImage ? 'image' : 'video',
      });
    });

    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const updateFile = (id: string, updates: Partial<UploadFile>) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, ...updates } : f
    ));
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      for (let i = 0; i < files.length; i++) {
        const uploadFile = files[i];

        const formData = new FormData();
        formData.append('file', uploadFile.file);
        formData.append('category', uploadFile.category);
        formData.append('name', uploadFile.name || uploadFile.file.name);
        formData.append('description', uploadFile.description);
        formData.append('type', uploadFile.type);

        const response = await fetch('/api/gallery/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Upload failed for ${uploadFile.file.name}`);
        }

        setUploadProgress(((i + 1) / files.length) * 100);
      }

      // Clear files after successful upload
      files.forEach(f => URL.revokeObjectURL(f.preview));
      setFiles([]);

      alert('✅ Alle Dateien erfolgreich hochgeladen!');
      onUploadComplete?.();
    } catch (error) {
      console.error('Upload error:', error);
      alert('❌ Fehler beim Hochladen. Bitte versuche es erneut.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-garden-600 text-white p-4">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <span>📤</span> Fotos & Videos hochladen
        </h3>
        <p className="text-garden-100 text-sm mt-1">
          Drag & Drop oder klicken zum Auswählen. Alle gängigen Formate werden unterstützt.
        </p>
      </div>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          p-8 border-2 border-dashed cursor-pointer transition-all
          ${isDragging
            ? 'border-garden-500 bg-garden-50'
            : 'border-gray-300 hover:border-garden-400 hover:bg-gray-50'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="text-center">
          <div className="text-5xl mb-3">
            {isDragging ? '📥' : '📁'}
          </div>
          <p className="text-gray-700 font-medium">
            {isDragging ? 'Dateien hier ablegen...' : 'Dateien hierher ziehen'}
          </p>
          <p className="text-gray-500 text-sm mt-1">
            oder <span className="text-garden-600 underline">hier klicken</span> zum Auswählen
          </p>
          <p className="text-gray-400 text-xs mt-2">
            JPG, PNG, GIF, HEIC, MP4, MOV, WebM und mehr
          </p>
        </div>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="border-t border-gray-200">
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-700">
                {files.length} {files.length === 1 ? 'Datei' : 'Dateien'} ausgewählt
              </span>
              <button
                onClick={() => {
                  files.forEach(f => URL.revokeObjectURL(f.preview));
                  setFiles([]);
                }}
                className="text-red-600 hover:text-red-700 text-sm"
              >
                Alle entfernen
              </button>
            </div>
          </div>

          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {files.map(file => (
              <div key={file.id} className="p-4 hover:bg-gray-50">
                <div className="flex gap-4">
                  {/* Preview */}
                  <div className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                    {file.type === 'image' ? (
                      <img
                        src={file.preview}
                        alt={file.name || file.file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <video
                        src={file.preview}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 space-y-2">
                    {/* File name display */}
                    <div className="text-sm text-gray-500 truncate">
                      📄 {file.file.name} ({(file.file.size / 1024 / 1024).toFixed(1)} MB)
                    </div>

                    {/* Category Dropdown */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Kategorie</label>
                      <select
                        value={file.category}
                        onChange={(e) => updateFile(file.id, { category: e.target.value })}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-transparent"
                      >
                        {CATEGORIES.map(cat => (
                          <option key={cat.id} value={cat.id}>
                            {cat.emoji} {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Name & Description */}
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Name (optional)"
                        value={file.name}
                        onChange={(e) => updateFile(file.id, { name: e.target.value })}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-transparent"
                      />
                      <input
                        type="text"
                        placeholder="Beschreibung (optional)"
                        value={file.description}
                        onChange={(e) => updateFile(file.id, { description: e.target.value })}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* Remove Button */}
                  <button
                    onClick={() => removeFile(file.id)}
                    className="text-gray-400 hover:text-red-500 transition"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Upload Button */}
          <div className="p-4 bg-gray-50 border-t border-gray-200">
            {isUploading ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Wird hochgeladen...</span>
                  <span className="text-sm font-medium text-garden-600">{Math.round(uploadProgress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-garden-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={handleUpload}
                className="w-full bg-garden-600 hover:bg-garden-700 text-white py-3 rounded-lg font-semibold transition"
              >
                📤 {files.length} {files.length === 1 ? 'Datei' : 'Dateien'} hochladen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
