const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PROYECTOS_DIR = path.join(__dirname, '../uploads/proyectos');
const REPORTES_DIR = path.join(__dirname, '../uploads/reportes_ia');

async function main() {
  console.log('=== SEEDING PROYECTOS Y REPORTES IA DE MUESTRA ===');

  if (!fs.existsSync(PROYECTOS_DIR)) fs.mkdirSync(PROYECTOS_DIR, { recursive: true });
  if (!fs.existsSync(REPORTES_DIR)) fs.mkdirSync(REPORTES_DIR, { recursive: true });

  // 1. Create a sample .docx file for Proyecto V1
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "PROYECTO DE ESCRITURA PÚBLICA DE COMPRAVENTA INMOBILIARIA",
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "ESCRITURA NÚMERO: ", bold: true }),
            new TextRun({ text: "45,892. VOLUMEN: 890." }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "EN LA CIUDAD DE TEPIC, NAYARIT, a 28 de Julio de 2026, ante mí, Licenciado NOTARIO PÚBLICO NÚMERO 1, comparecen por una parte como VENDEDOR el Sr. Javier Concordia y por otra parte como COMPRADOR la Sra. María Elena Ramos.", font: "Calibri" })
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "OBJETO: Compraventa de inmueble ubicado en Fracc. Flamboyanes Tepic, con una superficie de 250.00 metros cuadrados.", font: "Calibri" })
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "PRECIO Y FORMA DE PAGO: El precio pactado es de $1,250,000.00 M.N.", font: "Calibri" })
          ]
        })
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const sampleProyectoPath = path.join(PROYECTOS_DIR, 'proyecto_v1_exp2026_001.docx');
  fs.writeFileSync(sampleProyectoPath, buffer);
  console.log('Proyecto V1 creado en:', sampleProyectoPath);

  // 2. Create sample IA Report Word document
  const reportDoc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "REPORTE DE REVISIÓN IA - PRAVIA OS",
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Expediente: ", bold: true }),
            new TextRun({ text: "EXP-2026-001 (Folio 01-2026)" }),
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Versión del Proyecto Analizada: ", bold: true }),
            new TextRun({ text: "V1 — Proyecto inicial Compraventa.docx" }),
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "RESUMEN EJECUTIVO: ", bold: true, color: "115E59" }),
            new TextRun({ text: "Se analizaron 4 documentos fuente activos. Se detectaron 2 observaciones de riesgo (1 Alto, 1 Medio)." })
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "OBSERVACIÓN 01 — Riesgo Alto: ", bold: true, color: "DC2626" }),
            new TextRun({ text: "Discrepancia en la superficie del inmueble. Proyecto señala 250.00 m², mientras el Avalúo especifica 247.35 m²." })
          ]
        })
      ]
    }]
  });

  const reportBuffer = await Packer.toBuffer(reportDoc);
  const sampleReportPath = path.join(REPORTES_DIR, 'Observaciones_IA_Expediente_001_2026_V1.docx');
  fs.writeFileSync(sampleReportPath, reportBuffer);
  console.log('Reporte IA .docx creado en:', sampleReportPath);
}

main().catch(console.error).finally(() => prisma.$disconnect());
