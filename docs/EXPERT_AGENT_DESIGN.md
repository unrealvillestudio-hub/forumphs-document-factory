# ForumPHs Expert Agent — Diseño de implementación (Fase 3)

> Reemplaza la "capa Claude open" de `/api/icr` por un Agente Experto permanente
> con dos manos de criterio. Regla maestra del sprint:
> **dato exacto que existe → determinístico/SQL (nunca agente);
> criterio / interpretación / visión → Agente.**

---

## Mano A — Auditoría legal Ley 284

Evoluciona el `/api/icr` actual. Cambios vs. hoy:

1. **Cobertura completa, no 60%.** Hoy trunca a 15k chars (~60% del acta). El
   acta completa entra en contexto de sobra. Auditar el 100%.
2. **Conocimiento Ley 284 embebido como REGLAS VERIFICABLES**, no como una frase.
   Mínimo:
   - Quórum primer llamado: > 50% (mitad más uno). Art. 67.
   - Segundo llamado: el que asista (con aviso correcto). Art. 67.
   - Mayorías especiales por tipo de decisión (Art. 83 y relacionados).
   - Convocatoria: plazo y forma (Art. 62, 64).
   El agente CONTRASTA el acta contra estas reglas y marca incumplimientos.
3. **Lista de personal administrativo como DATOS, no hardcode.** Hoy
   "Ivette Flores, Irja, Daniel Puentes…" está en el prompt. Mover a config por
   marca/edificio (tabla o JSON de marca). Principio de ecosistema.
4. **Cruce con datos verificados** (lo que ya hace): votaciones del XLSX,
   asistentes, fincas pendientes (las que Fase 2 marcó [FINCA PENDIENTE]).
5. **Registrado en AgentLab** como agente permanente, invocado en cada corrida.
   Alimenta los banners de color del DOCX (que ya funcionan).

**Determinístico vs. agente en Mano A:** los conteos (votos, quórum numérico,
% calculado) ya los hace el generador con `numeroALetras` — el agente NO
recalcula, sólo verifica coherencia y cumplimiento legal interpretativo.

---

## Mano B — Curaduría visual de imágenes (resuelve Gap 4)

Nueva capacidad. Hoy `/api/generate` vuelca `parsed.images` COMPLETO al anexo
(incluye screenshots de Zoom, avatares, etc.). El filtro por nombre de archivo
es frágil. Solución: visión.

**Input:** `parsed.images` (base64) + contexto del acta (qué votaciones hubo).
**Proceso:** el agente con visión clasifica cada imagen:
- `INCLUDE` — gráfico de votación, resultado de encuesta, tabla de resultados.
- `EXCLUDE` — screenshot de Zoom, galería de participantes, avatar, logo Hypal.
- `MAYBE` — convocatoria del ascensor, documento de respaldo (decide por contexto).
**Output por imagen:** `{ decision, order, caption_legal, reason }`.
- `caption_legal`: pie de imagen formal para el acta ("Resultado de la votación
  sobre la aprobación del presupuesto 2025").
- `order`: secuencia en el anexo.

**Determinístico vs. agente en Mano B:** la decisión de QUÉ imagen pertenece es
criterio visual → agente. El recorte/inserción en el DOCX sigue siendo código.

---

## Flujo integrado

```
/api/generate (DOCX + QA, ya con finca lookup Fase 2)
   │
   ├─ Mano B (visión) sobre parsed.images → set curado + captions
   │     → /api/generate usa SOLO las INCLUDE, en orden, con caption
   │
   └─ /api/icr → Mano A (auditoría Ley 284 full-doc + config admin + fincas pend.)
         → findings → banners de color (existente) + Anexo ICR (existente)
```

**Orden de construcción:**
1. Config de Ley 284 + personal admin como datos (saca el hardcode del prompt).
2. Mano A: ampliar `/api/icr` a full-doc + reglas Ley 284 + leer config.
3. Mano B: nuevo `/api/curate-images` (o módulo) con visión.
4. Cablear Mano B en `/api/generate` (reemplaza el volcado completo de imágenes).
5. Registrar en AgentLab.

**No-fatal siempre:** ambas manos degradan con gracia (como el ICR hoy: fallback
que nunca tira 500). Si la visión falla, se cae al comportamiento actual
(incluir con filtro por nombre) en vez de romper la generación.
