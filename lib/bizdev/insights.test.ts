import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarContacto, esDominioPersonal, pendientes, ultimaLectura, type Accion, type Insight } from './insights'

test('contacto: normaliza a minúsculas, quita espacios y la arroba inicial del dominio', () => {
  assert.deepEqual(normalizarContacto('email', '  Junta@Plaza77.Test '), { tipo: 'email', valor: 'junta@plaza77.test' })
  assert.deepEqual(normalizarContacto('dominio', '@Plaza77.test'), { tipo: 'dominio', valor: 'plaza77.test' })
})

test('contacto: rechaza lo que la base rechazaría', () => {
  assert.throws(() => normalizarContacto('email', 'sin-arroba.test'), /correo inválido/)
  assert.throws(() => normalizarContacto('dominio', 'x@plaza77.test'), /dominio inválido/)
  assert.throws(() => normalizarContacto('dominio', 'plaza77'), /dominio inválido/)
  assert.throws(() => normalizarContacto('telefono', '123'), /tipo de contacto inválido/)
  assert.throws(() => normalizarContacto('email', '   '), /vacío/)
})

test('contacto: avisa de dominios de correo personal', () => {
  assert.equal(esDominioPersonal('@Gmail.com'), true)
  assert.equal(esDominioPersonal('plaza77.test'), false)
})

const acc = (o: Partial<Accion>): Accion => ({
  id: o.id ?? 'x', prospect_id: 'p', insight_id: null, accion: o.accion ?? 'a', fecha_sugerida: o.fecha_sugerida ?? null,
  prioridad: o.prioridad ?? 'media', estado: o.estado ?? 'pendiente', decidida_el: null, created_at: o.created_at ?? '2026-11-03T10:00:00Z',
})

test('acciones: solo pendientes, por prioridad y luego por fecha sugerida', () => {
  const xs = [
    acc({ id: '1', prioridad: 'baja' }),
    acc({ id: '2', prioridad: 'alta', fecha_sugerida: '2026-11-10' }),
    acc({ id: '3', prioridad: 'alta', fecha_sugerida: '2026-11-05' }),
    acc({ id: '4', prioridad: 'alta', estado: 'aprobada' }),
    acc({ id: '5', prioridad: 'media' }),
  ]
  assert.deepEqual(pendientes(xs).map(a => a.id), ['3', '2', '5', '1'])
})

test('lectura: devuelve la más reciente o null', () => {
  const i = (id: string, created_at: string): Insight => ({ id, prospect_id: 'p', comm_id: null, origen: 'communications_service', interpretacion: id, temperatura: null, objeciones: [], generado_por: null, created_at })
  assert.equal(ultimaLectura([]), null)
  assert.equal(ultimaLectura([i('a', '2026-11-01T00:00:00Z'), i('b', '2026-11-03T00:00:00Z')])?.id, 'b')
})
