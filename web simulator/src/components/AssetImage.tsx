import React, { useState } from 'react';

interface AssetImageProps {
  filename: string;
  fallbackLabel: string;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
}

/**
 * Renders `<img src="/assets/<filename>" />`.
 * Real artwork lives in `public/assets/` (see tools/fetch_assets.py). The labeled
 * fallback is shown ONLY if the image fails to load (onError).
 */
export const AssetImage: React.FC<AssetImageProps> = ({
  filename,
  fallbackLabel,
  alt,
  className = 'w-full h-full object-contain pointer-events-none select-none',
  fallbackClassName = '',
}) => {
  const [imgAvailable, setImgAvailable] = useState<boolean>(true);
  const src = `/assets/${filename}`;

  if (imgAvailable) {
    return (
      <img
        src={src}
        alt={alt ?? fallbackLabel}
        draggable={false}
        onError={() => setImgAvailable(false)}
        className={className}
      />
    );
  }

  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center pointer-events-none select-none border border-slate-700/80 bg-slate-900/80 text-slate-200 font-mono text-center px-1 ${fallbackClassName}`}
    >
      <span className="text-[11px] font-bold leading-tight truncate max-w-full">
        {fallbackLabel}
      </span>
      <span className="text-[8px] text-slate-500 leading-none truncate max-w-full mt-0.5">
        {filename}
      </span>
    </div>
  );
};
