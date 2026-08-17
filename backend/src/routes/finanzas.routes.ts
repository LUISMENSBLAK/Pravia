import { Router } from 'express';
import { FinanceLedgerController } from '../controllers/financeLedger.controller';
import { FinanzasController } from '../controllers/finanzas.controller';
import { requirePermission } from '../middleware/auth.middleware';
import { requireDocumentoObjectAccess } from '../middleware/objectAccess.middleware';

const router = Router();

// Lecturas canónicas. El router padre ya exige finanzas.read.
router.get('/resumen', FinanceLedgerController.summary);
router.get('/movimientos', FinanceLedgerController.movements);
router.get('/comprobantes', FinanceLedgerController.receipts);
router.get('/cuentas', FinanceLedgerController.accounts);
router.get('/conciliacion', FinanceLedgerController.reconciliation);
router.get('/cartera', FinanceLedgerController.receivables);
router.get('/facturacion/estado', FinanceLedgerController.invoiceStatus);
router.get('/catalogos', FinanceLedgerController.catalogs);

// Mutaciones separadas por capacidad; finanzas.read nunca autoriza escritura.
router.post('/movimientos', requirePermission('finanzas.write'), FinanceLedgerController.createMovement);
router.patch('/movimientos/:id/distribucion', requirePermission('finanzas.write'), FinanceLedgerController.replaceDistribution);
router.post('/movimientos/:id/comprobante', requirePermission('finanzas.write'), FinanceLedgerController.generateReceipt);
router.post('/movimientos/:id/aplicar', requirePermission('finanzas.validate'), FinanceLedgerController.applyMovement);
router.delete('/movimientos/:id/comprobantes/:documentId', requirePermission('finanzas.write'), requirePermission('documentos.unlink'), requireDocumentoObjectAccess, FinanceLedgerController.retireEvidence);
router.post('/movimientos/:id/cancelar', requirePermission('finanzas.validate'), FinanceLedgerController.cancelMovement);
router.post('/movimientos/:id/revertir', requirePermission('finanzas.validate'), FinanceLedgerController.reverseMovement);
router.post('/cuentas', requirePermission('finanzas.write'), FinanceLedgerController.createAccount);
router.post('/conciliacion/transacciones', requirePermission('finanzas.write'), FinanceLedgerController.registerBankTransaction);
router.post('/conciliacion', requirePermission('finanzas.validate'), FinanceLedgerController.reconcile);

// Consultas legacy conservadas durante la transición; nunca se suman al ledger nuevo.
router.get('/cobranza-legacy', FinanzasController.getCobranza);
router.get('/egresos-legacy', FinanzasController.getEgresosGlobales);
router.get('/honorarios-legacy', FinanzasController.getHonorariosPravia);

export default router;
