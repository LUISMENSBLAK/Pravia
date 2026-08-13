import { FileClock, ShieldAlert } from 'lucide-react';
import styles from '../Finance.module.css';

export function InvoicesView(){return <section className={styles.integrationState}><span><FileClock/></span><small>Facturación</small><h2>Integración pendiente de configuración</h2><p>PRAVIA no tiene actualmente un PAC, credenciales SAT ni timbrado CFDI configurado. Los PDF o XML adjuntos existentes son evidencia externa y no acreditan emisión fiscal desde esta plataforma.</p><div><ShieldAlert size={18}/><span><b>No se simulará el timbrado.</b><small>La arquitectura queda preparada para integrar un proveedor confirmado.</small></span></div></section>}
