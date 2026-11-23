type Client = { id?: string; nombre_busqueda: string };
export function expedienteClientName(expediente: {
  cliente_compareciente?: Client | null; cotizacion?: { solicitante_formal?: Client | null } | null;
  cliente_alias?: string | null; comparecientes?: Array<{ compareciente: { nombre_busqueda?: string; personaFisica?: { nombre_completo_calculado?: string | null } | null; personaMoral?: { razon_social?: string | null } | null } }>;
}) {
  const historical = expediente.comparecientes?.[0]?.compareciente;
  return expediente.cliente_compareciente?.nombre_busqueda || expediente.cotizacion?.solicitante_formal?.nombre_busqueda
    || expediente.cliente_alias || historical?.personaFisica?.nombre_completo_calculado || historical?.personaMoral?.razon_social || historical?.nombre_busqueda || 'Sin cliente';
}
