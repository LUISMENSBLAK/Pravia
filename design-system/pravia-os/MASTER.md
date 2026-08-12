# PRAVIA OS — Sistema visual maestro

## Dirección

Software operacional notarial moderno, premium, sobrio y denso. El shell combina navegación navy continua con un workspace claro y fluido. El dorado se reserva para marca, CTA primario, selección e indicadores importantes.

## Tokens principales

- Navy 950: `#06172F`
- Navy 900: `#071B38`
- Navy 800: `#0A2346`
- Gold 500: `#D3A33D`
- Workspace: `#F7F9FC`
- Surface: `#FFFFFF`
- Border: `#E2E7EF`
- Text primary: `#0B1B35`
- Text secondary: `#5D6D86`

## Tipografía

Sans-serif operacional: Inter o equivalente del sistema. No usar titulares serif ni tipografía editorial sobredimensionada.

- Page title: 28–32 px
- Navigation/body: 14–16 px
- Labels/table: 12–14 px
- Line-height de lectura: 1.5–1.65

## Geometría

- Sidebar desktop: 236 px; colapsado: 76 px
- Topbar: 72 px
- Cards: 13 px
- Inputs/botones: 9 px
- Workspace desktop: 24–32 px
- Bordes tenues y sombras mínimas

## Movimiento

Transiciones de 160–190 ms. Respetar `prefers-reduced-motion`. No usar rebotes, glows ni animación decorativa.

## Responsive

- `>1024`: sidebar expandible
- `768–1024`: rail colapsado
- `<768`: drawer móvil
- Controles táctiles mínimos de 44 px
- No ocultar overflow global para disimular fallos

## Reglas invariables

- Lucide como único sistema de iconos
- Estados visibles de focus y contraste WCAG AA
- PRAVIA IA no aparece en el menú de Fase 1
- Sin datos demo en componentes de producción
- Los módulos operativos permanecen como placeholders hasta su fase correspondiente
