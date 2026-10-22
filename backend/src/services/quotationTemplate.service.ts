export type QuotationTemplateContext = {
  folio: string;
  cliente: string;
  acto: string;
  descripcion: string;
  responsable: string;
  fecha: Date;
  honorarios: string | null;
  impuestos_derechos: string | null;
  otros_gastos?: string | null;
  iva_otros_gastos?: string | null;
  total: string | null;
};

export type QuotationTemplate = {
  id: 'PRAVIA_GENERIC_QUOTE_V1';
  variables: Record<keyof QuotationTemplateContext, string>;
  subject: string;
  body: string;
};

const money = (value: string | null) => value == null
  ? 'Por definir'
  : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value));

/** Replaceable quotation-template boundary. CFG-002 remains the future configured provider. */
export function getQuotationTemplate(context: QuotationTemplateContext): QuotationTemplate {
  const variables: QuotationTemplate['variables'] = {
    folio: context.folio,
    cliente: context.cliente,
    acto: context.acto,
    descripcion: context.descripcion,
    responsable: context.responsable,
    fecha: new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' }).format(context.fecha),
    honorarios: money(context.honorarios),
    impuestos_derechos: money(context.impuestos_derechos),
    otros_gastos: money(context.otros_gastos ?? '0.00'),
    iva_otros_gastos: money(context.iva_otros_gastos ?? '0.00'),
    total: money(context.total),
  };
  return {
    id: 'PRAVIA_GENERIC_QUOTE_V1',
    variables,
    subject: `Cotización ${variables.folio} — ${variables.acto}`,
    body: [
      `Cliente: ${variables.cliente}`,
      `Acto: ${variables.acto}`,
      `Descripción: ${variables.descripcion}`,
      `Responsable: ${variables.responsable}`,
      `Fecha: ${variables.fecha}`,
      `Honorarios: ${variables.honorarios}`,
      `Impuestos y derechos: ${variables.impuestos_derechos}`,
      ...(Number(context.otros_gastos || 0) > 0 ? [`Otros gastos: ${variables.otros_gastos}`] : []),
      ...(Number(context.iva_otros_gastos || 0) > 0 ? [`IVA de otros gastos configurados: ${variables.iva_otros_gastos}`] : []),
      `Total: ${variables.total}`,
    ].join('\n'),
  };
}
