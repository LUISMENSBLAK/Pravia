# PRAVIA OS — Entrega de Fase 3: PRAVIA IA

## Arquitectura

PRAVIA IA es una capacidad transversal de todas las rutas privadas. `AssistantProvider` mantiene un único estado global y `AssistantLayer` se monta una vez dentro del application shell. No existe ruta `/inteligencia`, página de chat ni entrada nueva en el sidebar.

La implementación se divide en:

- `AssistantProvider`: apertura, conversación, sugerencias, estados y confirmaciones.
- `assistantContext`: resolución de ruta/módulo/entidad y acciones rápidas contextuales.
- `assistant.service`: único adapter de red; ningún componente visual ejecuta `fetch`.
- `AssistantLayer`: launcher, sugerencia y drawer responsive.
- Componentes separados para búho, fuentes y confirmación.

La tarjeta y la recomendación de Mi Día llaman al mismo `AssistantProvider`; no existe una segunda implementación de IA.

## Context system

El resolver identifica únicamente contexto de navegación:

```ts
type AssistantContext = {
  route: string;
  module: AssistantModule;
  label: string;
  entityType?: 'expediente' | 'compareciente' | 'notaria' | 'prospecto' | 'cotizacion';
  entityId?: string;
  subview?: string;
};
```

Ejemplo: `/expedientes/abc` produce `module: expedientes`, `entityType: expediente` y `entityId: abc`. Esta información nunca se usa como autorización; el backend seguirá siendo la autoridad.

Las acciones rápidas están configuradas por contexto para Mi Día, Expedientes, Comparecientes, Agenda y Finanzas. En módulos todavía no construidos solo precargan una consulta; no implementan lógica operativa.

## Contratos API esperados

No se asignan rutas productivas por defecto. El backend debe confirmar y configurar:

- `VITE_ASSISTANT_MESSAGE_PATH`
- `VITE_ASSISTANT_SUGGESTIONS_PATH`
- `VITE_ASSISTANT_CONFIRM_PATH`
- `VITE_ASSISTANT_DISMISS_PATH`
- `VITE_ASSISTANT_SNOOZE_PATH`

El contrato conceptual es:

```ts
assistantService.getSuggestions(context)
assistantService.sendMessage({ message, context, suggestionId? })
assistantService.confirmAction(confirmationId, context)
assistantService.dismissSuggestion(suggestionId, context)
assistantService.snoozeSuggestion(suggestionId, context)
```

`sendMessage` devuelve `status`, texto opcional, `processLabel`, fuentes y/o una confirmación. Las fuentes solo se renderizan cuando el backend entrega `label`, documento, página o referencia; la UI no inventa provenance.

```ts
type AssistantReply = {
  status: 'idle' | 'thinking' | 'processing' | 'success' | 'error' | 'confirmation-required';
  message?: string;
  processLabel?: string;
  sources?: AssistantSource[];
  confirmation?: AssistantConfirmation;
};
```

Si los endpoints no están configurados, no se hacen solicitudes silenciosas: no aparecen sugerencias y un envío muestra un error humano recuperable.

## Estados implementados

- Closed
- Contextual suggestion
- Open drawer
- Thinking
- Processing
- Success
- Error
- Confirmation required

Dismiss y Snooze se comunican al adapter cuando existe endpoint. Además, la sesión suprime localmente una sugerencia descartada para evitar repetición mientras llega la persistencia definitiva del backend.

## Mascota y rendimiento

- `owl-idle` está precargado desde `index.html`.
- Greeting, thinking, processing, success y blink solo aparecen/cargan cuando el estado los requiere.
- Respiración, blink e inclinación son sutiles y se eliminan completamente con `prefers-reduced-motion`.
- Se usan exclusivamente los assets oficiales de `public/brand/pravia-ai/`.

## Accesibilidad y responsive

- Drawer `role="dialog"`, `aria-modal`, foco contenido y retorno al activador.
- `Esc` cierra el panel.
- Composer etiquetado; Enter envía y Shift+Enter crea una nueva línea.
- Estados dinámicos usan regiones vivas y los errores no exponen información técnica.
- Desktop: drawer overlay de 440 px bajo la topbar.
- Tablet: overlay lateral sin recomponer el contenido.
- Móvil: sheet completa con header y composer persistentes, `100dvh` y safe-area.

## QA visual

Los fixtures usados para capturas viven fuera del repositorio. Las capturas de esta fase se encuentran en `frontend/screenshots/` y cubren los tamaños y estados solicitados.

- `pravia-ai-closed-1440x900.jpg`
- `pravia-ai-suggestion-1440x900.jpg`
- `pravia-ai-open-1440x900.jpg`
- `pravia-ai-thinking-1440x900.jpg`
- `pravia-ai-confirmation-1440x900.jpg`
- `pravia-ai-open-768x1024.jpg`
- `pravia-ai-closed-390x844.jpg`
- `pravia-ai-suggestion-390x844.jpg`
- `pravia-ai-open-390x844.jpg`
