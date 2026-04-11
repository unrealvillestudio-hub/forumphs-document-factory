# Document Factory — ForumPHs

Generador automático de Actas de Asamblea de Propiedad Horizontal.  
Convierte el ZIP de Hypal en `.docx` formal con QA 100% integrado.

---

## Stack

- **Next.js 14** (App Router) — Vercel deploy
- **Anthropic Claude Sonnet 4** — Paso 0.5 formalization
- **jszip** — ZIP extraction
- **mammoth** — DOCX → text
- **xlsx (SheetJS)** — XLSX parsing  
- **docx** — DOCX generation
- **Skill v1.4** — ForumPHs Document Factory ICR spec

---

## Setup

```bash
# 1. Clone
git clone https://github.com/unrealvillestudio-hub/document-factory
cd document-factory

# 2. Install
npm install

# 3. Environment
cp .env.example .env.local
# Edit .env.local — add ANTHROPIC_API_KEY

# 4. Dev
npm run dev
# → http://localhost:3000

# 5. Deploy to Vercel
vercel deploy
```

---

## Flow

```
1. Upload ZIP (Hypal format)
      ↓
2. Parse 6 files → JSON (skeleton, attendance, votations, debates, chats)
      ↓
3. Pre-flight check → ask Ivette for missing info (Finca, Código, convocatoria, etc.)
      ↓
4. Paso 0.5 — Claude API formalizes each debate block (3rd person, legal tone)
      ↓
5. Build DOCX — assemble all sections with format rules from Skill v1.4
      ↓
6. QA Scan — 100% document analysis (8 error types)
      ↓
7. Download ACTA_X-AAAA_PH_SLUG_df_v1.docx
```

---

## ZIP Structure (Hypal)

```
asamblea_zip/
├── Resumen_de_la_Asamblea.docx        → skeleton metadata
├── Lista_de_Asistencia.xlsx           → attendance table
├── Resultados_de_las_votaciones.xlsx  → votation results  
├── Transcripcion_de_la_asamblea.docx  → full transcript
├── Chats_de_Zoom_de_la_asamblea.docx  → zoom chat log
└── Reporte_de_Quorum.docx             → quorum report (skip)
```

---

## QA Verdict Scale

| Errors | Verdict | Action |
|--------|---------|--------|
| 0–10 | ✅ PASS | Ready for Ivette review |
| 11–50 | ⚠️ WARN | Review section by section |
| 51–100 | ❌ FAIL | Regenerate failing sections |
| 101+ | 🛑 STOP | Full Claude API pass required |

---

## Filename Convention

```
ACTA_{N}-{YEAR}_{PH_SLUG}_df_v{VERSION}.docx
Example: ACTA_1-2026_TORRES_CASTILLA_df_v1.docx
```

---

## Skill Reference

Specification: `unrlvl-context/brands/ForumPHs/document_factory_skill.md` v1.4  
Examples: `temp_ACTA_PHAS_GOAL_example_01.docx` + `_02.docx`

---

*ForumPHs · Document Factory · Designed & Developed by Unreal>ille Studio*
