# PRAVIA OS — Entrega de Fase 2: Mi Día

## Alcance construido

- Dashboard responsive en `/mi-dia` con saludo y fecha dinámicos.
- Cuatro KPI operativos; el KPI financiero cambia por uno operativo cuando el usuario no tiene permiso.
- Agenda del día, firmas urgentes, recomendación, tareas urgentes, expedientes recientes y recordatorios.
- Tarjeta inicial de PRAVIA IA con el búho oficial, estado en línea y accesos rápidos honestos.
- Resumen financiero exclusivo para usuarios autorizados.
- Estados de carga, vacío y error independiente por widget, con reintento en errores recuperables.
- Enlaces internos a agenda, expedientes y anclas del dashboard; las funciones de IA todavía no disponibles se muestran deshabilitadas.

## Contrato de integración

El frontend consume `GET ${VITE_MY_DAY_PATH}`; el valor por defecto es `/dashboard/mi-dia`. Se admite que el contenido llegue directamente o dentro de `data`.

```ts
type MyDayData = {
  date?: string;
  permissions: { canViewFinance: boolean };
  kpis: {
    activeFiles?: KpiMetric;
    signaturesToday?: KpiMetric;
    urgentPending?: KpiMetric;
    financial?: KpiMetric;
    operationalFallback?: KpiMetric;
  };
  agenda: AgendaItem[];
  urgentSignatures: UrgentSignature[];
  recentFiles: RecentFile[];
  recommendation?: Recommendation | null;
  reminders: Reminder[];
  urgentTasks: UrgentTask[];
  finance?: { metrics: FinancialMetric[]; months?: FinancialMonth[] } | null;
  errors: Partial<Record<WidgetSection, string>>;
};
```

`permissions.canViewFinance` debe ser una decisión explícita del backend. El cliente exige el booleano `true`; no infiere acceso financiero a partir del rol, de la existencia del bloque `finance` ni de datos locales.

Los arrays faltantes se normalizan como vacíos y un mensaje en `errors.<section>` solo afecta a ese widget. El backend real no forma parte de este repositorio, por lo que el nombre definitivo del endpoint y el contrato deberán confirmarse al integrarlo.

## Datos y QA

El código de producción no contiene datos demo. La revisión visual se hizo con un servidor mock temporal fuera del repositorio y se validaron cuatro escenarios: datos, vacío, carga y error aislado de agenda.

Capturas incluidas:

- `screenshots/mi-dia-1440x900.jpg`
- `screenshots/mi-dia-1280x800.jpg`
- `screenshots/mi-dia-768x1024.jpg`
- `screenshots/mi-dia-390x844.jpg`
- `screenshots/mi-dia-empty-1440x900.jpg`
- `screenshots/mi-dia-loading-1440x900.jpg`
- `screenshots/mi-dia-error-1440x900.jpg`

## Límites de esta fase

- No se construyó el drawer conversacional de PRAVIA IA.
- No se implementaron pantallas funcionales para los demás módulos.
- No se añadió backend ni persistencia local de datos operativos.
