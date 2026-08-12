const { PDFParse } = require('pdf-parse');
const { prisma } = require('../dist/config/prisma');
const { downloadFile } = require('../dist/services/supabase.service');

async function run() {
  const p = new PDFParse({ data: Buffer.from('test') });
  console.log('PDFParse instance prototype:', Object.getOwnPropertyNames(Object.getPrototypeOf(p)));
}

run();
