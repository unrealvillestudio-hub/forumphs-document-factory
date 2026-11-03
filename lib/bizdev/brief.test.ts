import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBrief, type BriefProspect } from './brief'

const base: BriefProspect = {
  code: 'FPHS-P-0001', short_name: 'Plaza 77', full_name: 'P.H. Plaza 77', etapa: 'cotizado',
  unidades: 60, m2_privados: 7065.19, es_casas: false, proxima_accion: 'Llamar a la Junta', proxima_fecha: '2026-11-01', notas: null,
  quotes: [
    { honorario: 1200, margen: null, estado: 'enviada', origen: 'manual', created_at: '2026-09-19T21:00:00Z', enviada_el: '2026-09-19', params_version: null },
    { honorario: 1400, margen: null, estado: 'enviada', origen: 'manual', created_at: '2026-09-21T21:00:00Z', enviada_el: '2026-09-21', params_version: null },
  ],
  comms: [
    { fecha: '2026-09-21T21:00:00Z', canal: 'documento', sentido: 'enviado', resumen: 'Carta de cotización: $1,400', origen: 'manual' },
    { fecha: '2026-09-20T15:00:00Z', canal: 'correo', sentido: 'recibido', resumen: 'La Junta pide la tarifa', origen: 'manual' },
    { fecha: '2026-10-24T15:00:00Z', canal: 'documento', sentido: 'interno', resumen: 'Brief para Ivette', origen: 'manual' },
  ],
}

test('brief: separa entradas, respuestas e internas y resume lo clave', () => {
  const b = buildBrief(base, '2026-11-03')
  assert.equal(b.entradas.length, 1)
  assert.equal(b.respuestas.length, 1)
  assert.equal(b.internas.length, 1)
  assert.match(b.texto, /Última cotización enviada: \$1,400\.00 al mes más ITBMS \(carta previa al modelo\), el 2026-09-21/)
  assert.match(b.texto, /Historial de cotizaciones: \$1,200\.00 \(2026-09-19\) → \$1,400\.00 \(2026-09-21\)/)
  assert.match(b.texto, /Último contacto: 2026-10-24 \(Documento\), hace 10 día\(s\)/)
  assert.match(b.texto, /Próxima acción: Llamar a la Junta \(2026-11-01, VENCIDA\)/)
  assert.match(b.texto, /ENTRADAS \(mensajes del prospecto\)\n- 2026-09-20 · Correo: La Junta pide la tarifa/)
})

test('brief: sin mensajes del prospecto lo dice en vez de inventarlos', () => {
  const b = buildBrief({ ...base, comms: base.comms.filter(c => c.sentido !== 'recibido'), quotes: [] }, '2026-11-03')
  assert.match(b.texto, /No hay mensajes del prospecto registrados/)
  assert.match(b.texto, /Todavía no se le ha enviado ninguna cotización/)
  assert.match(b.texto, /ENTRADAS \(mensajes del prospecto\)\n- Ninguna registrada\./)
})

test('brief: suma la lectura de correos y las acciones por decidir, sin cambiar el resto', () => {
  const b = buildBrief({
    ...base,
    insights: [{ id: 'i1', prospect_id: 'p', comm_id: null, origen: 'communications_service', interpretacion: 'Interés real; la objeción es de alcance.',
      temperatura: 'tibio', objeciones: ['alcance del personal'], generado_por: null, created_at: '2026-11-02T15:00:00Z' }],
    actions: [
      { id: 'a1', prospect_id: 'p', insight_id: 'i1', accion: 'Proponer reunión', fecha_sugerida: null, prioridad: 'media', estado: 'pendiente', decidida_el: null, created_at: '2026-11-02T15:00:00Z' },
      { id: 'a2', prospect_id: 'p', insight_id: 'i1', accion: 'Enviar desglose de personal', fecha_sugerida: '2026-11-05', prioridad: 'alta', estado: 'pendiente', decidida_el: null, created_at: '2026-11-02T15:00:00Z' },
      { id: 'a3', prospect_id: 'p', insight_id: 'i1', accion: 'Ya decidida', fecha_sugerida: null, prioridad: 'alta', estado: 'descartada', decidida_el: '2026-11-02T16:00:00Z', created_at: '2026-11-02T15:00:00Z' },
    ],
  }, '2026-11-03')
  assert.match(b.texto, /Lectura más reciente \(2026-11-02, tibio\): Interés real; la objeción es de alcance\./)
  assert.match(b.texto, /Objeciones: alcance del personal\./)
  assert.match(b.texto, /Acciones propuestas por decidir: 2 \(la más urgente: Enviar desglose de personal\)\./)
  assert.match(b.texto, /ACCIONES PROPUESTAS POR DECIDIR\n- \[alta\] Enviar desglose de personal \(sugerida para 2026-11-05\)\n- \[media\] Proponer reunión/)
  assert.equal(b.porDecidir.length, 2)
  assert.doesNotMatch(buildBrief(base, '2026-11-03').texto, /ACCIONES PROPUESTAS|Lectura más reciente/)
})
