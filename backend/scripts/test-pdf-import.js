const pdfLib = require('pdf-parse');
console.log('Keys of require("pdf-parse"):', Object.keys(pdfLib));
console.log('Type of default:', typeof pdfLib.default);
console.log('Type of pdfParse:', typeof pdfLib.pdfParse);
console.log('Type of PDFParse:', typeof pdfLib.PDFParse);
