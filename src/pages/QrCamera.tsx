// Камера телефона → текст QR (2b.4).
//
// Спершу вбудований BarcodeDetector (Chrome на Android — швидко, без
// бібліотек). Якщо його немає (Safari на iPhone, Firefox), кожні ~200 мс
// беремо кадр відео в canvas і розпізнаємо бібліотекою jsQR. Працює без
// інтернету: усе відбувається на телефоні.

import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'

/** Мінімальний опис BarcodeDetector — у стандартних типах TypeScript його ще немає. */
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
type DetectorCtor = new (options: { formats: string[] }) => Detector

function nativeDetector(): Detector | null {
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  if (!ctor) return null
  try {
    return new ctor({ formats: ['qr_code'] })
  } catch {
    return null // браузер знає API, але не QR
  }
}

/** Кадр відео → текст QR через jsQR (зменшуємо до 640 px: швидше на слабких телефонах). */
function decodeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
  const w = Math.round(video.videoWidth * scale)
  const h = Math.round(video.videoHeight * scale)
  if (!w || !h) return null
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, w, h)
  return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
}

type Status = 'starting' | 'on' | 'denied' | 'unsupported'

const MESSAGE: Record<Exclude<Status, 'on'>, string> = {
  starting: 'Avvio della fotocamera…',
  denied: 'Accesso alla fotocamera negato. Consentilo nelle impostazioni del browser oppure inserisci il codice a mano.',
  unsupported: 'Questo browser non può usare la fotocamera. Inserisci il codice a mano.',
}

export default function QrCamera({ onCode }: { onCode: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('starting')
  // Остання версія колбека — без перезапуску камери на кожен рендер.
  const onCodeRef = useRef(onCode)
  useEffect(() => {
    onCodeRef.current = onCode
  }, [onCode])

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let stopped = false
    let busy = false
    // Той самий QR перед камерою не спрацьовує знову протягом 2 с.
    let last = { text: '', at: 0 }
    const canvas = document.createElement('canvas')

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return setStatus('unsupported')
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch {
        return setStatus('denied')
      }
      const video = videoRef.current
      if (stopped || !video) return stream.getTracks().forEach((t) => t.stop())
      video.srcObject = stream
      await video.play().catch(() => undefined)
      setStatus('on')
      const detector = nativeDetector()
      timer = setInterval(async () => {
        if (busy || video.readyState < 2) return
        busy = true
        try {
          const text = detector ? (await detector.detect(video))[0]?.rawValue ?? null : decodeFrame(video, canvas)
          const now = Date.now()
          if (text && (text !== last.text || now - last.at > 2000)) {
            last = { text, at: now }
            onCodeRef.current(text)
          }
        } catch {
          // Кадр не вдалося прочитати — спробуємо наступний.
        } finally {
          busy = false
        }
      }, 200)
    }
    void start()
    return () => {
      stopped = true
      clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="scan-camera">
      <video ref={videoRef} muted playsInline aria-label="Inquadratura della fotocamera" />
      {status !== 'on' && <div className="scan-camera-msg" role="status">{MESSAGE[status]}</div>}
      {status === 'on' && <div className="scan-frame" aria-hidden="true" />}
    </div>
  )
}
