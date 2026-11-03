# Brief — unrlvl-communications-services ↔ BizDev de ForumPHs

**Fecha:** 2026-11-03 · **Redacta:** CC, sesión «FPHs - BizDev tab (Document Factory)» (`session_017nBVYtpcmW6T5JyZiFTMkz`)
**Para:** la sesión de CC que construye `unrlvl-communications-services` · **Lo entrega:** Sam

● PARA CC — Integrar el seguimiento de correos de prospectos con el BizDev de ForumPHs

## 0. Qué se pide, en una línea

Que el servicio, al leer el buzón de ForumPHs, haga **dos cosas y solo dos**:

- **Correo de un prospecto ya registrado:** registrarlo en BizDev con su lectura y sus acciones propuestas, llamando a `fphs_bizdev_ingest()`.
- **Correo de un remitente que no es de ningún prospecto, pero parece un prospecto:** avisar a Sam por Telegram con un texto fijo. No se escribe nada en ninguna tabla.

## 1. Decisiones de Sam que gobiernan esto (2026-11-03, en el chat de la sesión BizDev)

1. **Los dos flujos** de arriba: «sí, los dos flujos».
2. **Destino:** los datos del cliente van a la base del cliente (BizDev). Nunca van a context files, a Professor, a `AGENDA.md` ni a un `session_log`.
   - Frase de Sam: «al final estás entregando análisis de correos de un cliente para el mismo cliente, yo no veo excepción».
   - **Pendiente formal:** queda por escribirse como aclaración en `protocols/MAIL_PRIVACY_RULE.md` (v1.2) en el próximo `Actualiza`. Hasta entonces, **esta sesión no escribe nada del correo en el repo de contexto**, ni la mención de que leyó algo.
3. **Autorización del buzón:** `reportado` por Sam el 2026-11-03 («ya tenemos autorización»). Esta sesión no vio el documento firmado.
4. **Alerta de Telegram:** texto fijo **con la marca** y sin nada del correo. Ver §4.

## 2. El contrato: dos funciones en `unrlvl-db` (`amlvyycfepwhiindxgzw`)

Las crea `forumphs-document-factory/supabase/migrations/08_bizdev_analisis_de_correos.sql`. El servicio **no escribe en las tablas `fphs_` directamente**: llama a estas dos funciones con `service_role` (`POST /rest/v1/rpc/<nombre>`).

### 2.1 `fphs_bizdev_match(p_direccion text)` → ¿de qué prospecto es?

- **Entrada:** la dirección del remitente (o del destinatario, en los correos enviados). Admite mayúsculas y espacios: los normaliza.
- **Regla:** primero busca el correo exacto. Si no lo encuentra, busca el dominio. Los contactos los carga Sam en la ficha del prospecto.
- **Salida:** 0 o 1 fila `{prospect_id, code, short_name, etapa, via: 'email' | 'dominio'}`.
- **Sin fila** = no es de ningún prospecto registrado. Ahí aplica §4.

### 2.2 `fphs_bizdev_ingest(p jsonb)` → registrar correo, lectura y acciones

```json
{
  "prospect_id": "<uuid de fphs_bizdev_match>",
  "ext_ref": "<id estable del mensaje en el proveedor>",
  "sentido": "recibido | enviado",
  "fecha": "2026-11-03T10:00:00-05:00",
  "resumen": "≤ 500 caracteres, en palabras del servicio; nunca el cuerpo del correo",
  "interpretacion": "≤ 2000 caracteres: cómo se lee el correo (opcional)",
  "temperatura": "frio | tibio | caliente (opcional)",
  "objeciones": ["texto corto", "..."],
  "generado_por": "lab o modelo que hizo la lectura (opcional)",
  "acciones": [
    { "accion": "≤ 300 caracteres", "fecha_sugerida": "YYYY-MM-DD (opcional)", "prioridad": "alta | media | baja" }
  ]
}
```

- **Idempotente por `ext_ref`.** Con un `ext_ref` ya registrado no duplica nada y devuelve `{"duplicado": true, "comm_id": …}`. El servicio puede reintentar sin miedo.
- **Falla en voz alta** (excepción) en estos casos, y el servicio debe registrar el fallo, no ocultarlo:
  - `prospect_id` inexistente;
  - falta `ext_ref` o `resumen`;
  - `sentido` distinto de `recibido` o `enviado`;
  - un resumen de más de 500 caracteres;
  - `acciones` que no sean una lista.
- **Respuesta normal:** `{"duplicado": false, "comm_id", "insight_id", "acciones": n}`.
- **Qué hace BizDev con eso:** la comunicación entra a la línea de tiempo con `origen = 'communications_service'` y `canal = 'correo'`. La lectura aparece en la ficha. Las acciones quedan **pendientes** hasta que Sam las aprueba o descarta, y al aprobar una pasa a ser la próxima acción del prospecto. **El servicio no decide acciones ni envía nada.**

**Medido (2026-11-03)** con el ensayo `ENSAYO_OK` de la migración 08, sin dejar cambios en la base:
- el match por correo y por dominio, y 0 filas para un desconocido;
- un ingest correcto con 2 acciones;
- un reingest marcado como duplicado, que no creó un segundo registro;
- el rechazo de cada entrada inválida de la lista anterior;
- ningún privilegio para `anon` ni `authenticated`.

## 3. Qué tiene que construir el servicio

1. **Configuración por marca, como dato** (`MULTIBRAND_RULE`). El servicio es capa compartida: no lleva `fphs_`, ForumPHs ni el dominio de la marca en el código. Por cada marca guarda, en su tabla de configuración:
   - el buzón;
   - el nombre de la función de match;
   - el nombre de la función de ingest;
   - el chat de Telegram;
   - el texto de la alerta.
   
   ForumPHs es la primera fila.
2. **La lectura la hace un lab del ecosistema, llamado por su `api_endpoint`**, no un motor de LLM propio dentro del servicio (`ecosystem.json` → `labs._note`). Cuál lab: **a decidir con Sam**.
3. **Qué correos lee:** los del buzón autorizado de la marca. Para cada uno llama a `fphs_bizdev_match` con el remitente o, si es un correo enviado, con el destinatario.
   - Con match: llama a `fphs_bizdev_ingest`.
   - Sin match: aplica §4.
   - **Lo que no es de un prospecto ni parece un prospecto no se toca.**
4. **Qué no guarda:** el cuerpo del correo, adjuntos, ni nombres o direcciones en tablas de BizDev, más allá de lo que Sam cargó como contacto. El `resumen` y la `interpretacion` se escriben en palabras del servicio.
5. **Dónde no escribe nunca:** context files, Professor, `AGENDA.md` ni `session_log`. Tampoco la mención de qué se leyó. Ese registro de gobernanza va en el cuerpo del PR, sin contenido de correos.

## 4. La alerta de Telegram (remitente nuevo que parece prospecto)

- **Texto fijo**, con la marca tomada de la configuración: **«ForumPHs: ha llegado un nuevo contacto de un aparente prospecto.»**
- **Sin remitente, sin asunto, sin extracto y sin enlace.** Sam sabe dónde mirar (Gmail) y, si es un prospecto, lo registra en BizDev con su contacto.
- **Una sola alerta por remitente nuevo**, no una por cada correo del hilo. Para no repetirla, el servicio guarda una huella (hash) de la dirección en su propia base. **No guarda la dirección en BizDev.**
- **Habrá falsos positivos** («aparente»), y es aceptable. La detección de «parece un prospecto» es criterio del lab, no una lista de palabras en el código.

## 5. Gobernanza

| | |
|---|---|
| Repo | `unrealvillestudio-hub/unrlvl-communications-services` (lo confirma la sesión que lo construye) |
| Rama | la que use esa sesión; CC la publica y abre el PR contra `main`, listo para merge |
| Quién mergea y borra | Sam, por GitHub Web UI, en squash |
| Dependencia | **el PR de la migración 08 en `forumphs-document-factory` mergeado y la migración aplicada**. Sin eso, las dos funciones no existen y el servicio debe fallar en voz alta, no omitir |
| Datos de prueba | solo contra prospectos y correos de prueba, borrados al terminar. Nunca contra Plaza 77 ni contra el buzón real hasta que Sam lo pida |

## 6. Test de la marca N+1 (lado del servicio)

1. **¿Sobrevive a otra marca, de otro rubro y otro país?** Sí, si las funciones, el buzón, el chat y el texto de la alerta son filas de configuración. Una marca sin CRM simplemente no tiene función de match.
2. **¿El nombre describe la función o el caso?** El servicio habla de «seguimiento de contactos» y de «destino de registro», no de «prospectos de ForumPHs».
3. **¿Eje o instancia?** El eje es leer, clasificar, registrar por RPC configurada y avisar. Las funciones `fphs_` son la instancia.
4. **¿Cuántas marcas hay hoy en la enumeración?** Una (ForumPHs). Por eso el nombre de la tabla de configuración no puede ser de marca.

## 7. QA

```
QA:
- QA-ENCARGO: confirmado por Sam el 2026-11-03 («construye las tres piezas, pero necesito que me des un pequeño brief…»)
- QA-OBJETIVO: validado con Sam el 2026-11-03 (los dos flujos; la alerta con la marca)
- QA-INFO: plan de obtención: falta el diseño actual del servicio (lo tiene esa sesión) y qué lab hace la lectura (decide Sam)
- QA-PROP: respondida abajo
```

**QA-PROP**
1. **Supuestos:**
   - la migración 08 está aplicada (**hoy no**: se aplica después del merge);
   - el servicio tiene `service_role` de `unrlvl-db`;
   - el buzón de ForumPHs está autorizado (**reportado** por Sam).
2. **Medido y deducido:**
   - el contrato de §2 está **medido** con el ensayo;
   - el comportamiento del servicio es **deducido**, porque no se ha construido.
3. **Qué se rompe:** nada de lo existente. Las tablas son nuevas y `fphs_prospect_comms` solo gana la columna `ext_ref` y un tope de longitud que se aplica únicamente a `origen = 'communications_service'`.
4. **Reversión:** desactivar la fila de ForumPHs en la configuración del servicio. Del lado de BizDev, borrar las filas con `origen = 'communications_service'` y sus lecturas y acciones.
5. **Efecto observable:**
   - un correo de prueba de un contacto de prueba aparece en la ficha de un prospecto de prueba, con su lectura y sus acciones pendientes;
   - un correo de un remitente desconocido produce exactamente una alerta de Telegram con el texto fijo;
   - en ningún archivo del repo de contexto aparece nada de esos correos.
