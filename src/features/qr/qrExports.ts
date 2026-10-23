import QRCode from 'qrcode'
import { readableTextColor } from '../../lib/color'

const QR_OPTIONS = { margin: 2, errorCorrectionLevel: 'M' as const }

export const qrPng = (url: string) => QRCode.toDataURL(url, { ...QR_OPTIONS, width: 1024 })
export const qrSvg = (url: string) => QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob()

/** Re-encodes the logo as PNG (the PDF library can't embed WebP). Returns null if it can't be loaded. */
async function logoAsPng(url: string): Promise<{ data: string; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(await (await fetch(url, { mode: 'cors' })).blob())
    const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** A US-Letter counter sign: brand-coloured header with the business name, logo, big QR code
 *  and "Scan to leave a review". The QR encodes the review PAGE link, not the Google link. */
export async function buildSignPdf(opts: { name: string; link: string; color: string; logoUrl: string | null }): Promise<Blob> {
  const { jsPDF } = await import('jspdf') // loaded only when someone asks for the PDF
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true })
  const W = doc.internal.pageSize.getWidth()
  const textColor = readableTextColor(opts.color) === '#ffffff' ? [255, 255, 255] : [0, 0, 0]

  doc.setFillColor(...rgb(opts.color))
  doc.rect(0, 0, W, 130, 'F')
  doc.setTextColor(textColor[0], textColor[1], textColor[2])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(34)
  const lines = (doc.splitTextToSize(opts.name, W - 100) as string[]).slice(0, 2)
  doc.text(lines, W / 2, lines.length > 1 ? 62 : 76, { align: 'center' })

  let y = 150
  const logo = opts.logoUrl ? await logoAsPng(opts.logoUrl) : null
  if (logo) {
    const scale = Math.min(200 / logo.width, 90 / logo.height)
    const w = logo.width * scale
    const h = logo.height * scale
    doc.addImage(logo.data, 'PNG', (W - w) / 2, y, w, h)
    y += 90
  }

  const qrSize = 330
  doc.addImage(await qrPng(opts.link), 'PNG', (W - qrSize) / 2, Math.max(y + 20, 250), qrSize, qrSize)

  doc.setTextColor(30, 41, 59)
  doc.setFontSize(30)
  doc.text('Scan to leave a review', W / 2, 650, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(100, 116, 139)
  doc.text(opts.link, W / 2, 690, { align: 'center' })

  return doc.output('blob')
}
