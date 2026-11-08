import { QRCodeSVG } from 'qrcode.react'

// Dark-on-white with a quiet zone: scans reliably from a dark UI and a TV.
export default function Qr({ value, size = 200 }: { value: string; size?: number }) {
  return (
    <div className="inline-block shrink-0 rounded-xl bg-white p-2 leading-none">
      <QRCodeSVG value={value} size={size} level="M" />
    </div>
  )
}
