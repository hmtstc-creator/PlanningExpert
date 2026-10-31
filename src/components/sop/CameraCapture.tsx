import { useEffect, useRef, useState } from 'react'

import { CAMERA_CONSTRAINTS, canvasToJpeg, captureGeometry, drawCapture } from '../../lib/sop/photoCapture'

/**
 * Kamera çekimi. Önce açıklama penceresi gösterilir; kamera ancak "Open camera"
 * ile açılır. Kamera ayarını kullanıcı değiştirmez: 4:3 yatay istek kodda.
 */
export function CameraCapture({ onCapture, onClose }: { onCapture: (blob: Blob) => Promise<void>; onClose: () => void }) {
  const [phase, setPhase] = useState<'intro' | 'live' | 'working' | 'error'>('intro')
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)

  const stopStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }
  useEffect(() => stopStream, [])
  useEffect(() => {
    if (phase === 'live' && video.current && stream.current) {
      video.current.srcObject = stream.current
      void video.current.play().catch(() => undefined)
    }
  }, [phase])

  const open = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera.')
      stream.current = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS, audio: false })
      setPhase('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The camera could not be opened.')
      setPhase('error')
    }
  }

  const capture = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    setPhase('working')
    try {
      const g = captureGeometry(v.videoWidth, v.videoHeight)
      const blob = await canvasToJpeg(drawCapture(v, v.videoWidth, v.videoHeight, g))
      stopStream()
      await onCapture(blob)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be saved.')
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:hidden" role="dialog" aria-modal="true" aria-labelledby="camera-title">
      <div className="w-full max-w-lg rounded-xl bg-card p-5 text-sm shadow-xl">
        <h2 id="camera-title" className="text-lg font-bold text-foreground">
          Take a photo
        </h2>
        {phase === 'intro' && (
          <>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Hold the phone sideways (landscape). The photo is taken as 4:3 landscape.</li>
              <li>If you hold the phone upright, the photo is turned and cropped to 4:3 automatically.</li>
              <li>Keep the operation in the middle of the frame.</li>
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-border px-3 py-2 hover:bg-muted" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground" onClick={() => void open()}>
                Open camera
              </button>
            </div>
          </>
        )}
        {(phase === 'live' || phase === 'working') && (
          <>
            <video ref={video} playsInline muted className="mt-3 w-full rounded-md bg-black" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-border px-3 py-2 hover:bg-muted" onClick={() => (stopStream(), onClose())}>
                Cancel
              </button>
              <button type="button" disabled={phase === 'working'} className="rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void capture()}>
                {phase === 'working' ? 'Saving…' : 'Take photo'}
              </button>
            </div>
          </>
        )}
        {phase === 'error' && (
          <>
            <p className="mt-3 text-red-700">{error}</p>
            <div className="mt-5 flex justify-end">
              <button type="button" className="rounded-md border border-border px-3 py-2 hover:bg-muted" onClick={() => (stopStream(), onClose())}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
