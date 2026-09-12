const CLOUDINARY_IMAGE_MARKER = '/image/upload/';
const CLOUDINARY_VIDEO_MARKER = '/video/upload/';

/**
 * Builds a small Cloudinary preview for gallery cards. The original URL is
 * deliberately preserved for the lightbox and downloads.
 */
export function mediaThumbnailUrl(source: string, type?: 'IMAGEN' | 'VIDEO', size = 640) {
  if (!/^https:\/\//i.test(source)) return source;
  const marker = source.includes(CLOUDINARY_VIDEO_MARKER)
    ? CLOUDINARY_VIDEO_MARKER
    : source.includes(CLOUDINARY_IMAGE_MARKER)
      ? CLOUDINARY_IMAGE_MARKER
      : null;
  if (!marker) return source;

  const suffix = source.slice(source.indexOf(marker) + marker.length);
  // A signed Cloudinary delivery URL cannot be transformed without signing it again.
  if (suffix.startsWith('s--')) return source;

  const pixels = Math.min(960, Math.max(320, Math.round(size)));
  const transform = (type === 'VIDEO' || marker === CLOUDINARY_VIDEO_MARKER)
    ? `so_0,f_jpg,q_auto:eco,c_fill,g_auto,w_${pixels},h_${pixels}`
    : `f_auto,q_auto:eco,c_fill,g_auto,w_${pixels},h_${pixels}`;
  return source.replace(marker, `${marker}${transform}/`);
}

export function mediaUrlsForOfflineCache(source: string) {
  const type = source.includes(CLOUDINARY_VIDEO_MARKER) ? 'VIDEO' : 'IMAGEN';
  const thumbnail = mediaThumbnailUrl(source, type, 640);
  return thumbnail === source ? [source] : [source, thumbnail];
}
