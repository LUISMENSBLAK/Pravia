export const humanStatus=(value?:string)=>({BORRADOR:'Borrador',PENDIENTE_REVISION:'Pendiente',REQUIERE_AJUSTES:'Con observaciones',CONFIRMADO:'Confirmado'}[value||'']||'Sin estado');
export const humanResult=(value?:string)=>({INCOMPLETO:'Requiere información',REQUIERE_AVISO:'Requiere acción UIF',SIN_AVISO_POR_UMBRAL:'Sin aviso por umbral',INSUMOS_INCOMPLETOS:'ISR incompleto',LISTO_PARA_REVISION_FISCAL:'Listo para revisión fiscal'}[value||'']||'Sin evaluar');
export const shortDate=(value?:string)=>value?new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)):'—';
export const money=(value:any)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:2}).format(Number(value||0));
