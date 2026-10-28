import { Router } from 'express';
import { FinanceLedgerController } from '../controllers/financeLedger.controller';
import { FinanzasController } from '../controllers/finanzas.controller';
import { FinanceFiscalController } from '../controllers/financeFiscal.controller';
import { requirePermission } from '../middleware/auth.middleware';
import { requireDocumentoObjectAccess } from '../middleware/objectAccess.middleware';
import multer from 'multer';
import { FISCAL_UPLOAD_MAX_BYTES } from '../config/uploadLimits';
import { boundedDocumentBatchStorage } from '../config/documentBatchUpload';

const router = Router();
const fiscalUpload = multer({ storage: boundedDocumentBatchStorage, limits: { fileSize: FISCAL_UPLOAD_MAX_BYTES, files: 2, fields: 10 } });

// Lecturas canónicas. El router padre ya exige finanzas.read.
router.get('/resumen', FinanceLedgerController.summary);
router.get('/movimientos', FinanceLedgerController.movements);
router.get('/comprobantes', FinanceLedgerController.receipts);
router.get('/cuentas', FinanceLedgerController.accounts);
router.get('/conciliacion', FinanceLedgerController.reconciliation);
router.get('/cartera', FinanceLedgerController.receivables);
router.get('/facturacion/estado', FinanceFiscalController.status);
router.get('/facturacion/expedientes', FinanceLedgerController.expedienteInvoices);
router.get('/facturacion/entidades', FinanceFiscalController.entities);
router.get('/facturacion/conceptos', FinanceFiscalController.fiscalConcepts);
router.get('/facturacion/conceptos/actos', FinanceFiscalController.fiscalActOptions);
router.get('/facturacion/proveedores', FinanceFiscalController.suppliers);
router.get('/facturacion/proveedores/:id/csf', requirePermission('documentos.read'), FinanceFiscalController.supplierCsfUrl);
router.get('/facturacion/documentos', FinanceFiscalController.documents);
router.get('/facturacion/ingresos/:incomeId/contexto', FinanceFiscalController.incomeContext);
router.get('/facturacion/cuentas', FinanceFiscalController.accounts);
router.get('/facturacion/documentos/:id/archivos/:kind', requirePermission('documentos.read'), FinanceFiscalController.fileUrl);
router.get('/facturacion/borradores/:id/prefacturas', requirePermission('documentos.read'), FinanceFiscalController.prefacturaVersions);
router.get('/facturacion/borradores/:id/prefacturas/:version', requirePermission('documentos.read'), FinanceFiscalController.prefacturaVersionUrl);
router.get('/facturacion/exportar.xlsx', FinanceFiscalController.exportXlsx);
router.get('/catalogos', FinanceLedgerController.catalogs);
router.get('/gastos-recurrentes', FinanceLedgerController.recurringExpenses);
router.post('/analisis', requirePermission('ai.finanzas.read'), FinanceLedgerController.analyze);

// Mutaciones separadas por capacidad; finanzas.read nunca autoriza escritura.
router.post('/movimientos', requirePermission('finanzas.write'), FinanceLedgerController.createMovement);
router.patch('/movimientos/:id/distribucion', requirePermission('finanzas.write'), FinanceLedgerController.replaceDistribution);
router.post('/movimientos/:id/comprobante', requirePermission('finanzas.write'), FinanceLedgerController.generateReceipt);
router.post('/movimientos/:id/aplicar', requirePermission('finanzas.validate'), FinanceLedgerController.applyMovement);
router.delete('/movimientos/:id/comprobantes/:documentId', requirePermission('finanzas.write'), requirePermission('documentos.unlink'), requireDocumentoObjectAccess, FinanceLedgerController.retireEvidence);
router.post('/movimientos/:id/cancelar', requirePermission('finanzas.validate'), FinanceLedgerController.cancelMovement);
router.post('/movimientos/:id/revertir', requirePermission('finanzas.validate'), FinanceLedgerController.reverseMovement);
router.post('/cuentas', requirePermission('finanzas.write'), FinanceLedgerController.createAccount);
router.post('/facturacion/entidades', requirePermission('finanzas.validate'), FinanceFiscalController.createEntity);
router.post('/facturacion/conceptos', requirePermission('finanzas.validate'), FinanceFiscalController.createFiscalConcept);
router.patch('/facturacion/entidades/:id', requirePermission('finanzas.validate'), FinanceFiscalController.updateEntity);
router.post('/facturacion/proveedores', requirePermission('finanzas.write'), fiscalUpload.single('csf'), FinanceFiscalController.createSupplier);
router.patch('/facturacion/proveedores/:id', requirePermission('finanzas.write'), FinanceFiscalController.updateSupplier);
router.post('/facturacion/proveedores/csf/extraer', requirePermission('finanzas.write'), fiscalUpload.single('file'), FinanceFiscalController.extractCsf);
router.put('/facturacion/ingresos/:incomeId/receptores/:comparecienteId/perfil', requirePermission('finanzas.write'), FinanceFiscalController.confirmIncomeReceiver);
router.post('/facturacion/borradores', requirePermission('finanzas.write'), FinanceFiscalController.createDraft);
router.patch('/facturacion/borradores/:id', requirePermission('finanzas.write'), FinanceFiscalController.updateDraft);
router.delete('/facturacion/borradores/:id', requirePermission('finanzas.write'), FinanceFiscalController.deleteDraft);
router.post('/facturacion/borradores/:id/prefacturas', requirePermission('finanzas.write'), requirePermission('documentos.write'), FinanceFiscalController.generatePrefactura);
router.post('/facturacion/manual', requirePermission('finanzas.write'), requirePermission('documentos.write'), fiscalUpload.fields([{ name: 'xml', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), FinanceFiscalController.uploadManual);
router.post('/facturacion/documentos/:id/aplicaciones', requirePermission('finanzas.validate'), FinanceFiscalController.applyPayment);
router.post('/facturacion/documentos/:id/rep/preparar', requirePermission('finanzas.validate'), FinanceFiscalController.prepareRep);
router.post('/facturacion/documentos/:id/timbrar', requirePermission('finanzas.validate'), FinanceFiscalController.stamp);
router.post('/facturacion/transferencias', requirePermission('finanzas.validate'), FinanceFiscalController.transfer);
router.post('/gastos-recurrentes', requirePermission('finanzas.write'), FinanceLedgerController.createRecurringExpense);
router.patch('/gastos-recurrentes/:id', requirePermission('finanzas.write'), FinanceLedgerController.updateRecurringExpense);
router.post('/conciliacion/transacciones', requirePermission('finanzas.write'), FinanceLedgerController.registerBankTransaction);
router.post('/conciliacion', requirePermission('finanzas.validate'), FinanceLedgerController.reconcile);

// Consultas legacy conservadas durante la transición; nunca se suman al ledger nuevo.
router.get('/cobranza-legacy', FinanzasController.getCobranza);
router.get('/egresos-legacy', FinanzasController.getEgresosGlobales);
router.get('/honorarios-legacy', FinanzasController.getHonorariosPravia);

export default router;
