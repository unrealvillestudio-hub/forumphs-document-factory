/**
 * sectionAssigner.ts
 * Assigns each DebateBlock to an agenda section number.
 *
 * Strategy (in order of reliability):
 * 1. Transition triggers — phrases that announce a new agenda point
 * 2. Keyword matching — words from the agenda item title appear in the block
 * 3. Sequential fallback — blocks flow forward through sections in time order
 */

import type { DebateBlock, AgendaItem } from '../types'

// Phrases that indicate a new agenda point is starting
const TRANSITION_TRIGGERS = [
  /pasamos?\s+al\s+(?:siguiente\s+)?punto/i,
  /(?:siguiente|próximo|próxima)\s+punto/i,
  /punto\s+(?:número|no\.?|#)?\s*(\d+)/i,
  /orden\s+del\s+día[,:]?\s+punto/i,
  /procedemos?\s+(?:a\s+)?(?:tratar|ver|discutir)/i,
  /vamos\s+(?:a\s+)?(?:al\s+)?punto/i,
  /en\s+cuanto\s+al\s+(?:tema|punto|asunto)/i,
  /(?:ahora|a continuación)\s+(?:trataremos|discutiremos|veremos)/i,
]

// Keywords to normalize for matching
function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4) // only meaningful words
}

// Build keyword sets for each agenda item
function buildKeywordSets(items: AgendaItem[]): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>()
  for (const item of items) {
    map.set(item.number, new Set(normalize(item.title)))
  }
  return map
}

// Score how well a block matches an agenda item (0-1)
function matchScore(blockText: string, keywords: Set<string>): number {
  if (keywords.size === 0) return 0
  const blockWords = new Set(normalize(blockText))
  let hits = 0
  for (const kw of keywords) {
    if (blockWords.has(kw)) hits++
  }
  return hits / keywords.size
}

// Detect if a block contains a transition to a specific section number
function detectTransitionToSection(text: string): number | null {
  for (const trigger of TRANSITION_TRIGGERS) {
    const m = text.match(trigger)
    if (m) {
      // Try to extract a number
      const numMatch = text.match(/punto\s+(?:número|no\.?|#)?\s*(\d+)/i)
      if (numMatch) return parseInt(numMatch[1])
      return -1 // transition detected but no specific number
    }
  }
  return null
}

export function assignBlocksToSections(
  blocks: DebateBlock[],
  agendaItems: AgendaItem[]
): DebateBlock[] {
  if (agendaItems.length === 0) {
    // No agenda items — assign all to section 2 (first real section after quorum)
    return blocks.map(b => ({ ...b, agenda_section: 2 }))
  }

  const keywordSets = buildKeywordSets(agendaItems)
  const sectionNumbers = agendaItems.map(i => i.number)
  const minSection = Math.min(...sectionNumbers)
  const maxSection = Math.max(...sectionNumbers)

  let currentSection = minSection
  const result: DebateBlock[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const text = (block.text_cleaned || block.text_raw || '').toLowerCase()

    // 1. Check for explicit transition trigger
    const transitionSection = detectTransitionToSection(text)
    if (transitionSection !== null) {
      if (transitionSection > 0 && transitionSection <= maxSection) {
        currentSection = transitionSection
      } else if (transitionSection === -1) {
        // Generic transition — advance to next section
        const currentIdx = sectionNumbers.indexOf(currentSection)
        if (currentIdx < sectionNumbers.length - 1) {
          currentSection = sectionNumbers[currentIdx + 1]
        }
      }
    }

    // 2. Keyword matching — only if score is high enough (>40%)
    let bestMatch = currentSection
    let bestScore = 0
    for (const [sectionNum, keywords] of keywordSets) {
      const score = matchScore(text, keywords)
      if (score > bestScore && score > 0.4) {
        bestScore = score
        bestMatch = sectionNum
      }
    }
    if (bestScore > 0.4 && bestMatch !== currentSection) {
      // Only switch section if the match is significantly better
      currentSection = bestMatch
    }

    result.push({ ...block, agenda_section: currentSection })
  }

  return result
}
