import { QRCodeSVG } from 'qrcode.react'

// SVG generado en el cliente (no una API externa) — no depende de wifi del
// colegio para renderizarse, solo para que alguien lo escanee después.
export default function QrCode({ value, size = 84 }) {
  return (
    <QRCodeSVG
      value={value}
      size={size}
      bgColor="#FFFFFF"
      fgColor="#0B2A3D"
      level="M"
      marginSize={0}
    />
  )
}
