import { useState, useRef } from 'react';
import { Upload, X, ImageIcon } from 'lucide-react';
import { API_URL, getImageUrl } from '../utils/api';
import { bearerHeader } from '../utils/authHeaders';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  className?: string;
}

export function ImageUpload({ value, onChange, className = '' }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Veuillez sélectionner un fichier image valide');
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      setError('La taille du fichier ne doit pas dépasser 5MB');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${API_URL}/api/upload/single`, {
        method: 'POST',
        headers: bearerHeader(),
        body: formData,
        credentials: 'include', // Include auth cookies
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Échec du téléchargement');
      }

      const data = await response.json();
      
      // Resolve relative URLs to full backend URLs
      const finalUrl = getImageUrl(data.url);
      
      onChange(finalUrl);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Échec du téléchargement');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    onChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="text-sm font-medium text-gray-700">
        Image du produit
      </label>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Upload area */}
      <div
        onClick={handleClick}
        className={`
          relative border-2 border-dashed rounded-lg p-4 cursor-pointer
          transition-colors hover:border-[#C5A065]/50
          ${uploading ? 'border-gray-300 bg-gray-50' : 'border-gray-300 hover:border-[#C5A065]'}
          ${error ? 'border-red-300' : ''}
        `}
      >
        {value ? (
          // Show uploaded image
          <div className="relative">
            <img
              src={value}
              alt="Product"
              className="w-full h-32 object-cover rounded-lg"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          // Show upload placeholder
          <div className="text-center">
            {uploading ? (
              <div className="flex flex-col items-center space-y-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C5A065]"></div>
                <p className="text-sm text-gray-600">Téléchargement en cours...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-2">
                <Upload className="h-8 w-8 text-gray-400" />
                <p className="text-sm text-gray-600">
                  Cliquez pour télécharger une image
                </p>
                <p className="text-xs text-gray-500">
                  PNG, JPG, WEBP jusqu'à 5MB
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {/* Alternative: URL input */}
      <div className="space-y-2">
        <label className="text-xs text-gray-500">
          Ou entrez une URL d'image directement
        </label>
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full p-2 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-[#C5A065]/50 outline-none"
          placeholder="https://exemple.com/image.jpg"
        />
      </div>
    </div>
  );
}
