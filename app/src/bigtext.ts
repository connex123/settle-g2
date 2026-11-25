// Renders a large amount ("0.05") plus a small "TON" tag to PNG bytes for an image container.
export async function amountImage(text: string, w: number, h: number): Promise<number[]> {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'
  let size = 84
  const font = (px: number) => `700 ${px}px "DejaVu Sans", Arial, sans-serif`
  g.font = font(size)
  while (g.measureText(text).width > w - 86 && size > 30) { size -= 4; g.font = font(size) }
  const tw = g.measureText(text).width
  g.fillText(text, 6, h - 16)
  // TON tag with a simple diamond mark, drawn with thick strokes so it survives 4-bit downsampling.
  const x = 6 + tw + 12
  g.font = font(26); g.fillText('TON', x, h - 16)
  g.strokeStyle = '#fff'; g.lineWidth = 3
  g.beginPath(); g.moveTo(x, h - 72); g.lineTo(x + 44, h - 72); g.lineTo(x + 22, h - 50); g.closePath(); g.stroke()
  g.beginPath(); g.moveTo(x + 22, h - 72); g.lineTo(x + 22, h - 50); g.stroke()
  const blob: Blob = await new Promise(ok => c.toBlob(b => ok(b!), 'image/png'))
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}
