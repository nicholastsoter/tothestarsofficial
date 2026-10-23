export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)

/** Black or white, whichever is easier to read on top of the given background colour. */
export function readableTextColor(hex: string): '#000000' | '#ffffff' {
  if (!isHexColor(hex)) return '#000000'
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  // pick whichever of black/white gives the higher contrast ratio
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}
