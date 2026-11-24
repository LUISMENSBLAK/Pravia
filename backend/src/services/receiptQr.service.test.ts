import { describe,it,expect } from 'vitest';
import { Document,Paragraph,Packer } from 'docx';
import PizZip from 'pizzip';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { placeReceiptQr, receiptQrPng, RECEIPT_QR_MARKER } from './receiptQr.service';
import { DOCX_MIME } from './functionalDocumentRenderer.service';
describe('Receipt QR: actual barcode in the configured slot',()=>{
  it('decodes back to the exact protected verification reference',async()=>{const value='https://qa.example.test/api/expedientes/comprobantes-pravia/verificar/QA-synthetic-token';const png=PNG.sync.read(await receiptQrPng(value));expect(jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data).toBe(value);});
  it('embeds a real PNG without replacing unrelated Word text or styles',async()=>{const source=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('RECIBO SINTÉTICO SIN VALIDEZ FISCAL'),new Paragraph(RECEIPT_QR_MARKER),new Paragraph('No es CFDI')]}]}));const result=await placeReceiptQr(source,DOCX_MIME,'PRAVIA-QA-synthetic');const zip=new PizZip(result);expect(zip.file('word/media/pravia-receipt-qr.png')?.asNodeBuffer().subarray(1,4).toString()).toBe('PNG');expect(zip.file('word/document.xml')?.asText()).toContain('No es CFDI');expect(zip.file('word/styles.xml')?.asText()).toBe(new PizZip(source).file('word/styles.xml')?.asText());expect(zip.file('word/document.xml')?.asText()).not.toContain(RECEIPT_QR_MARKER);});
  it('does not add or overprint a QR when the configured format lacks a slot',async()=>{const source=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Formato sin QR')]}]}));await expect(placeReceiptQr(source,DOCX_MIME,'qa')).rejects.toMatchObject({code:'RECEIPT_QR_SLOT_REQUIRED'});});
});
