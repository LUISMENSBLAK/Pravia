import QRCode from 'qrcode';
import PizZip from 'pizzip';
import { PDFDocument } from 'pdf-lib';
import { FunctionalDocumentRenderError, DOCX_MIME, PDF_MIME } from './functionalDocumentRenderer.service';
export const RECEIPT_QR_MARKER = 'PRAVIA_RECEIPT_QR_IMAGE_SLOT';
export const receiptQrPng = (value:string) => QRCode.toBuffer(value,{type:'png',errorCorrectionLevel:'M',margin:4,width:320});
/** Place only in the configured QR slot, never over customer text or an arbitrary corner. */
export async function placeReceiptQr(buffer:Buffer,mimeType:string,value:string) {
  const png=await receiptQrPng(value);
  if(mimeType===DOCX_MIME) {
    const zip=new PizZip(buffer),path='word/document.xml';let xml=zip.file(path)?.asText()||'';
    const slot=new RegExp(`<w:t\\b[^>]*>${RECEIPT_QR_MARKER}</w:t>`);
    if(!slot.test(xml))throw new FunctionalDocumentRenderError('RECEIPT_QR_SLOT_REQUIRED','Configura {{comprobante.qr}} como campo independiente del formato de recibo. No se alteró su estructura.');
    const relPath='word/_rels/document.xml.rels',typesPath='[Content_Types].xml';
    let rels=zip.file(relPath)?.asText()||'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const rel='rIdPraviaReceiptQr';
    if(rels.includes(`Id="${rel}"`))throw new FunctionalDocumentRenderError('RECEIPT_QR_SLOT_INVALID','El formato contiene un identificador de QR reservado.');
    zip.file('word/media/pravia-receipt-qr.png',png);
    rels=rels.replace('</Relationships>',`<Relationship Id="${rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pravia-receipt-qr.png"/></Relationships>`);zip.file(relPath,rels);
    let types=zip.file(typesPath)?.asText()||'';
    if(!/Extension="png"/i.test(types))types=types.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');zip.file(typesPath,types);
    const drawing=`<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1143000" cy="1143000"/><wp:docPr id="2147483000" name="QR de comprobación PRAVIA"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="QR de comprobación PRAVIA"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1143000" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    xml=xml.replace(slot,drawing);zip.file(path,xml);return zip.generate({type:'nodebuffer',compression:'DEFLATE'}) as Buffer;
  }
  if(mimeType===PDF_MIME) {
    const pdf=await PDFDocument.load(buffer),form=pdf.getForm();const field=form.getFields().find(item=>item.getName()==='comprobante.qr');
    const widget=field?.acroField.getWidgets()[0],rectangle=widget?.getRectangle(),pageRef=widget?.P();
    const page=pdf.getPages().find(item=>pageRef&&item.ref.toString()===pageRef.toString());
    if(!field||!rectangle||!page)throw new FunctionalDocumentRenderError('RECEIPT_QR_SLOT_REQUIRED','El PDF necesita un campo comprobante.qr vinculado a una página para colocar su QR.');
    const side=Math.min(rectangle.width,rectangle.height);if(side<64)throw new FunctionalDocumentRenderError('RECEIPT_QR_SLOT_SMALL','El espacio QR del formato debe medir al menos 64 puntos por lado.');
    form.removeField(field);const image=await pdf.embedPng(png);page.drawImage(image,{x:rectangle.x+(rectangle.width-side)/2,y:rectangle.y+(rectangle.height-side)/2,width:side,height:side});return Buffer.from(await pdf.save());
  }
  throw new FunctionalDocumentRenderError('RECEIPT_QR_TYPE_INVALID','El recibo debe usar un formato Word o PDF compatible.');
}
