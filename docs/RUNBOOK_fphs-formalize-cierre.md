# Runbook — fphs-formalize: cierre del endpoint + reescritura al ledger (T3)

Qué cambia y **en qué orden** desplegarlo. El orden importa: si la EF empieza a
exigir el header antes de que el proxy exista, el navegador se rompe.

## Qué hace este PR

1. **§3.1 — cierra el endpoint público.** La EF `fphs-formalize` deja de ser
   invocable por cualquiera con la URL. Ahora exige el header
   `x-formalize-secret == FPHS_FORMALIZE_SECRET`; sin él responde `401`
   (y `503` si el secreto no está configurado — falla **cerrado**, nunca abierto).
   - El navegador (`ProcessingPipeline`) ya **no** llama la EF directo: llama al
     proxy server `POST /api/formalize`, que adjunta el secreto server-side.
   - `reprocessPending` (loop server, de confianza) llama la EF vía el cliente
     compartido `callFormalizeEF()` — con el secreto, pero **sin** pasar por el
     rate-limit del proxy ("impide al desconocido, no al bucle propio").
   - `verify_jwt` sigue en `false` (convención de todo el proyecto); la auth la
     hace la propia EF con el secreto.

2. **§3.2 — reescribe el logging al ledger.** `logTokensBatch` apuntaba a
   `ops_token_sessions` (renombrada a `ops_token_sessions_retired` en T1 → ya no
   existía). Ahora llama la RPC `ops_log_generation` en `ops_generation_ledger`:
   `brand_id='ForumPHs'`, `lab='document-factory'`, `model_id='claude-sonnet-5'`,
   `source_app='fphs-document-factory'`, `provider='anthropic'`,
   `unit_type='tokens_in'`, `input_units`/`output_units`, `duration_ms`, `status`,
   `job_id` si viene en el request. **La tarifa la resuelve el ledger** vía
   `ops_lab_rates` (la EF manda rates NULL). `billable` no es parámetro → toma el
   default `'refacturable'`.

3. **§3.3 — mata el fail-silent.** El `.catch(()=>{})` desaparece: cualquier
   fallo del insert se loguea con **status + cuerpo** de la respuesta. Sigue sin
   bloquear la respuesta al usuario, pero ya no desaparece sin rastro. Además el
   insert se hace `await` antes de responder, para garantizar que la fila quede
   escrita (la razón por la que la tabla estuvo vacía meses).

## Secreto

- **Nuevo, no reciclado.** No reutilizar `forumphs_document_factory` ni ninguna
  clave existente. Generar: `openssl rand -hex 32`.
- Mismo valor en **dos** lados:
  - Vercel (app) — env `FPHS_FORMALIZE_SECRET` (Prod + Preview).
  - Supabase — `supabase secrets set FPHS_FORMALIZE_SECRET=<valor>`.

## Orden de despliegue (cada paso verificado antes del siguiente)

1. **Setear el secreto** en Vercel **y** Supabase (aún nadie lo exige).
2. **Desplegar la app** (proxy `/api/formalize` + `ProcessingPipeline` y
   `reprocessPending` apuntando al cliente compartido). Verificar que una corrida
   normal sigue funcionando — la EF **todavía no** exige el header, así que el
   secreto viaja pero no se valida aún.
3. **Recién entonces desplegar la EF** que rechaza sin header:
   `supabase functions deploy fphs-formalize`
   (sigue `--no-verify-jwt` / verify_jwt:false; la auth es el secreto).
   Verificar: una corrida real formaliza y **aparece un asiento** en el ledger;
   un `curl` directo sin el header devuelve `401`.

## Verificación de cierre (§3.4)

- **Puerta de merge** (esta rama): asiento real en `ops_generation_ledger` creado
  vía `ops_log_generation` con datos realistas (`source_app='fphs-document-factory-test'`),
  visible en el Dashboard (bloque MARCA / fila ForumPHs), y **borrado** tras
  capturar la evidencia. Prueba el camino del ledger: columnas, tarifa de
  `claude-sonnet-5`, `billable`, render. La evidencia va en el PR.
- **Puerta de despliegue** (post-merge, la hace Sam): mergear **no** despliega
  EFs en este ecosistema. Sam despliega (paso 3 de arriba) y corre un chunk real;
  ese asiento (`source_app='fphs-document-factory'`, sin `-test`) es el cierre
  verdadero. Si algo falla, se corrige sobre `main`.

## Rate limiting (pendiente, seam dejado)

`/api/formalize` es el punto de enganche para rate limiting por IP/sesión. No se
implementa en T3; hay un bloque comentado marcado en `app/api/formalize/route.ts`.
Cerrar la auth frena al desconocido; el rate limit frena el abuso de quien sí
tiene el secreto.

## Sin doble conteo

En `main` no existe una fila de costo consolidada del formalize: esta EF es el
**único** escritor del costo de formalización. (`lib/processors/costLedger.ts`
—la fila consolidada de `/api/generate` que apuntaba a `ops_token_sessions`—
vive solo en la rama sprint no mergeada; si esa rama llega a `main`, hay que
reconciliarla con este asiento para no contar dos veces. Fuera de alcance de T3.)
