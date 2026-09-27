import { formatDate, formatMeters, formatRaceTime, formatSplit } from './format.js'

const NAVY = [11, 42, 61]
const PRIMARY = [14, 92, 115]
const POLICY = { ignore: 'no cuenta', proportional: 'suma sus metros', tiebreak_only: 'solo desempata' }

const slug = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-').toLowerCase()
const fileBase = (event) => `resultados-${slug(event.name)}-${event.event_date}`
const provisional = (event) => event.status !== 'finished'

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Una fila por pasada válida: sirve para auditoría externa o reclamos.
export function exportResultsCsv(event, results) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = [
    ['Posición', 'Carril', 'Equipo', 'Metros equipo', 'Pasada', 'Nadador', 'Tiempo de carrera', 'Parcial (s)', 'Metros acumulados', 'Agregada por el juez'],
    ...results.flatMap((r) =>
      r.laps.map((l) => [
        r.standing?.position ?? '',
        r.team.lane_number,
        r.team.name,
        Number(r.standing?.total_meters ?? 0),
        l.number,
        l.swimmerName,
        formatRaceTime(l.occurredAt, event.started_at),
        l.split.toFixed(2),
        l.cumulativeMeters,
        l.manual ? 'sí' : '',
      ])
    ),
  ]
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${fileBase(event)}.csv`)
}

export async function exportResultsPdf(event, results) {
  const doc = await buildResultsPdf(event, results)
  doc.save(`${fileBase(event)}.pdf`)
}

export async function buildResultsPdf(event, results) {
  // Carga diferida: jspdf pesa y solo lo usa quien descarga.
  const [pdfMod, tableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  // El navegador (Vite) y Node exponen los módulos distinto.
  const jsPDF = pdfMod.jsPDF ?? pdfMod.default
  const autoTable = tableMod.autoTable ?? tableMod.default
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40

  doc.setFillColor(...NAVY)
  doc.rect(0, 0, pageWidth, 78, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(event.name, margin, 34)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(
    [formatDate(event.event_date), event.venue, `Postas americanas · ${event.duration_seconds / 60} min · pileta ${event.pool_length_m} m`]
      .filter(Boolean)
      .join(' · '),
    margin,
    54
  )
  if (provisional(event)) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 140, 110)
    doc.text('RESULTADOS PROVISORIOS — el evento no finalizó', margin, 68)
  }

  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(provisional(event) ? 'Posiciones' : 'Clasificación final', margin, 108)

  autoTable(doc, {
    startY: 116,
    margin: { left: margin, right: margin },
    head: [['Pos.', 'Carril', 'Equipo', 'Pasadas', 'Penal./ajustes', 'Metros']],
    body: results.map((r) => {
      const adj = Number(r.standing?.penalty_meters ?? 0) + Number(r.standing?.manual_meters ?? 0)
      return [
        r.standing?.position ? `${r.standing.position}°` : '—',
        r.team.lane_number,
        r.team.name,
        r.standing?.laps ?? 0,
        adj ? formatMeters(adj) : '',
        formatMeters(r.standing?.total_meters),
      ]
    }),
    headStyles: { fillColor: PRIMARY },
    columnStyles: { 0: { fontStyle: 'bold' }, 5: { halign: 'right', fontStyle: 'bold' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  })

  for (const r of results) {
    let y = doc.lastAutoTable.finalY + 28
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage()
      y = 50
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...NAVY)
    doc.text(
      `${r.standing?.position ? `${r.standing.position}° · ` : ''}Carril ${r.team.lane_number} · ${r.team.name} — ${formatMeters(r.standing?.total_meters)}`,
      margin,
      y
    )

    autoTable(doc, {
      startY: y + 8,
      margin: { left: margin, right: margin },
      head: [['Nadador', 'Pasadas', 'Metros', 'Mejor parcial', 'Promedio']],
      body: r.swimmers.map((s) => [
        `${s.name}${s.is_active ? '' : ' (baja)'}${s.added_after_lock ? ' (alta tardía)' : ''}`,
        s.laps,
        formatMeters(s.meters),
        formatSplit(s.bestSplit),
        formatSplit(s.avgSplit),
      ]),
      headStyles: { fillColor: [77, 100, 112] },
      styles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    })

    if (r.laps.length > 0) {
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
        margin: { left: margin, right: margin },
        head: [['#', 'Nadador', 'Tiempo de carrera', 'Parcial', 'Acumulado']],
        body: r.laps.map((l) => [
          `${l.number}${l.manual ? ' (M)' : ''}`,
          l.swimmerName,
          formatRaceTime(l.occurredAt, event.started_at),
          formatSplit(l.split),
          formatMeters(l.cumulativeMeters),
        ]),
        headStyles: { fillColor: [199, 208, 212], textColor: NAVY },
        styles: { fontSize: 8, cellPadding: 3 },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      })
    }
  }

  const pages = doc.getNumberOfPages()
  const generated = new Date().toLocaleString('es-AR')
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(130, 150, 160)
    const h = doc.internal.pageSize.getHeight()
    doc.text(
      `Generado ${generated} · (M) pasada agregada por el juez · Pasada incompleta: ${POLICY[event.partial_lap_policy]}`,
      margin,
      h - 20
    )
    doc.text(`${i} / ${pages}`, pageWidth - margin, h - 20, { align: 'right' })
  }

  return doc
}
