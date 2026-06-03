/**
 * voteMatcher.ts — Maps a votation to its agenda section.
 *
 * Single source of truth shared by /api/generate (DOCX) and actaBuilder (QA
 * text). Previously each had its own heuristic: the route did keyword overlap
 * (orphans → item[0]); actaBuilder did crude positional (i === number-2).
 * Both lost votes whose topic shared no vocabulary with any agenda title
 * ("¿cuál opción?", "a quién se escoge", "tiempo para el pago", procedural
 * "alteración del orden del día").
 *
 * Strategy: keyword overlap + domain synonym families, then a sequential
 * fallback by order of appearance (never dump every orphan into item[0]).
 * Callers are responsible for an orphan-catch so a vote mapped to a missing
 * section number is still rendered.
 */

export interface AgendaLike {
  number: number
  title: string
}

const VOTE_SYNONYMS: Record<string, string[]> = {
  reglamento: ['reglamento', 'uso', 'bozal', 'mascota', 'mascotas', 'sancion', 'sanciones'],
  cuota: ['cuota', 'cuotas', 'aumento', 'ajuste', 'ordinaria', 'extraordinaria', 'metro', 'mantenimiento'],
  presupuesto: ['presupuesto', 'gastos', 'partida', 'partidas'],
  junta: ['junta', 'directiva', 'cargo', 'cargos', 'puesto', 'puestos', 'postulacion', 'eleccion', 'vicepresidente', 'secretario', 'tesorero', 'vocal', 'presidente'],
  orden: ['orden', 'alteracion', 'modificacion'],
}

function normWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4)
  )
}

function expandSynonyms(words: Set<string>): Set<string> {
  const out = new Set(words)
  for (const syns of Object.values(VOTE_SYNONYMS)) {
    if (syns.some(w => out.has(w))) syns.forEach(w => out.add(w))
  }
  return out
}

export function matchVoteToSection(
  voteTopic: string,
  agendaItems: AgendaLike[],
  voteIndex = 0,
): number {
  if (agendaItems.length === 0) return 2
  const voteWords = expandSynonyms(normWords(voteTopic))

  let best = -1
  let bestScore = 0
  for (const item of agendaItems) {
    const titleWords = expandSynonyms(normWords(item.title))
    let hits = 0
    for (const tw of titleWords) { if (voteWords.has(tw)) hits++ }
    const score = titleWords.size > 0 ? hits / titleWords.size : 0
    if (score > bestScore) { bestScore = score; best = item.number }
  }
  if (best !== -1 && bestScore > 0) return best

  // Sequential fallback: Nth orphan → Nth agenda item, clamped to last.
  const clampedIdx = Math.min(voteIndex, agendaItems.length - 1)
  return agendaItems[clampedIdx].number
}
