# Cotizaciones — ajuste de página

Esta página hereda íntegramente `MASTER.md` y usa como referencia directa la composición oficial de Cotizaciones.

- Cinco KPIs compactos en desktop y carrusel horizontal accesible en mobile.
- Cuerpo desktop en proporción aproximada 65/35: tabla operativa a la izquierda y conversión mensual a la derecha.
- Los colores semánticos se limitan a iconos, línea de KPI, badges y datos de la gráfica.
- La tabla tiene búsqueda y filtros server-side; en mobile se sustituye por cards, nunca se comprime.
- La gráfica solo representa cohortes reales por `fecha_enviada_cliente`; si no existe histórico se muestra un estado vacío.
- Alta en drawer ancho con cinco pasos, resumen persistente y validación antes de avanzar.
- Detalle en workspace dedicado, con resumen, conceptos, versiones, actividad y documentos reales.
- Editar crea una nueva versión; no modifica silenciosamente una versión histórica.
- “Registrar envío manual” comunica expresamente que no existe confirmación de entrega del proveedor.
- El launcher de PRAVIA IA conserva el área inferior segura definida por el shell.
