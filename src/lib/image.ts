export const MAX_LOGO_DIMENSION = 512
export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const MAX_LOGO_INPUT_BYTES = 10 * 1024 * 1024
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Scales (w, h) down so the longer side is at most `max`. Never scales up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export const extensionFor = (type: string) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg')

export class LogoError extends Error {}

/**
 * Validates a chosen logo, redraws it at no more than 512px on the long side (which also strips
 * any extra data hidden in the file), and returns something ready to upload. Throws LogoError
 * with a message that's safe to show the user.
 */
export async function prepareLogo(file: File): Promise<{ blob: Blob; type: string; ext: string }> {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new LogoError('Please choose a PNG, JPG or WebP image.')
  if (file.size > MAX_LOGO_INPUT_BYTES) throw new LogoError('That image is too large. Please choose one under 10 MB.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new LogoError("We couldn't read that image. Try a different file.")
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_LOGO_DIMENSION)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new LogoError("Your browser couldn't process that image.")
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const toBlob = (q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, q))
  // PNG ignores quality; for JPEG/WebP step the quality down if the file is still too big
  for (const quality of [0.92, 0.8, 0.65, 0.5]) {
    const blob = await toBlob(quality)
    if (blob && blob.size <= MAX_LOGO_BYTES) return { blob, type: file.type, ext: extensionFor(file.type) }
    if (file.type === 'image/png') break
  }
  throw new LogoError('That image is still over 2 MB after resizing. Try a simpler image.')
}
