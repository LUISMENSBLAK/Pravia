"""Synthetic projection QA only. No authentic notarial/fiscal document."""
import hashlib
import json
import sys
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt

root = Path(sys.argv[1]).resolve()
assert str(root).startswith('/private/tmp/pravia-client-qa-20261121.') or str(root).startswith('/tmp/pravia-client-qa-20261121.')
root = root / 'projection'
root.mkdir(exist_ok=True)

def base():
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    section.top_margin, section.bottom_margin = Inches(.8), Inches(.8)
    section.left_margin, section.right_margin = Inches(.9), Inches(.9)
    normal = doc.styles['Normal']
    normal.font.name, normal.font.size = 'Times New Roman', Pt(11)
    normal.paragraph_format.space_after = Pt(7)
    section.header.paragraphs[0].text = 'NOTARÍA SINTÉTICA QA — SIN VALIDEZ JURÍDICA'
    section.footer.paragraphs[0].text = 'DOCUMENTO EXCLUSIVO DE ENSAYO — NO ES INSTRUMENTO PÚBLICO'
    return doc

doc = base()
p = doc.add_paragraph(); p.add_run('PROYECTO SINTÉTICO DE COMPRAVENTA').bold = True
doc.add_paragraph('INSTRUMENTO: ********. FECHA: ********.')
doc.add_paragraph('COMPARECENCIA')
p = doc.add_paragraph(); p.add_run('VENDEDOR: ').bold = True; p.add_run('PERSONA ANTERIOR DEL EJEMPLO'); p.add_run('. COMPRADOR: ').bold = True; p.add_run('COMPRADOR ANTERIOR DEL EJEMPLO.');
doc.add_paragraph('ANTECEDENTE PRIMERO. El vendedor es titular del inmueble FOLIO REAL: FOLIO-ANTERIOR-QA, con superficie de 900.00 m2, ubicado en DOMICILIO ANTERIOR DEL EJEMPLO.')
doc.add_paragraph('ANTECEDENTE SEGUNDO. La cuenta predial del inmueble es CUENTA-ANTERIOR-QA.')
doc.add_paragraph('CLÁUSULA PRIMERA. Las partes celebran la compraventa descrita en este instrumento de ensayo.')
p = doc.add_paragraph(); p.add_run('CLÁUSULA SEGUNDA. ').bold = True; p.add_run('El precio es $9,999,999.00 MXN.'); p.add_run(' La forma de pago debe acreditarse.').italic = True
doc.add_paragraph('CLÁUSULA TERCERA. FUNDAMENTO QA NO ACREDITADO: se menciona una disposición del machote sin fuente jurídica adjunta. Este texto requiere revisión del abogado; no es una ley real.')
doc.add_paragraph('GENERALES. Identificación del comprador: ********. RFC: ********.')
doc.add_paragraph('CIERRE. Este documento sintético no autoriza firma, inscripción ni acto jurídico alguno.')
template = root / 'Machote-sintetico-proyeccion.docx'
doc.save(template)

source = base()
source.add_heading('FUENTE DOCUMENTAL SINTÉTICA — SIN VALIDEZ JURÍDICA', 0)
for value in [
    'CASO QA: compraventa de inmueble. Vendedor: ROBERTO SINTÉTICO VENDEDOR QA. Comprador: MARIANA SINTÉTICA QA.',
    'Antecedente jurídico sintético QA: ROBERTO es el titular en este ensayo. Folio real: REAL-QA-921. Superficie de terreno documentada: 347.50 m2.',
    'Ubicación del inmueble: calle ENSAYO DOCUMENTAL número 42, Tepic, Nayarit, México. Cuenta predial: PRED-QA-841. Clave catastral: CAT-QA-371.',
    'Precio total acordado para el ensayo: 2,500,000.50 MXN. No se acredita forma de pago. No se aporta identificación, RFC ni fecha de firma.',
    'Existe una discrepancia deliberada: el maestro inmobiliario QA contiene superficie 350.25 m2; el antecedente de este documento contiene 347.50 m2. No existe documento que resuelva la discrepancia.',
    'No se aporta fundamento jurídico oficial vigente para el texto FUNDAMENTO QA NO ACREDITADO. Debe conservarse señalado para revisión, sin inventar artículos ni eliminarlo silenciosamente.',
]: source.add_paragraph(value)
source.save(root / 'Fuente-sintetica-compraventa.docx')

evidence = {'template': str(template), 'sha256': hashlib.sha256(template.read_bytes()).hexdigest(),
            'section_count': 1, 'page_geometry': 'Letter portrait; top/bottom .8 in; left/right .9 in',
            'typography': 'Normal Times New Roman 11 pt, after 7 pt; local bold/italic runs preserve-only',
            'slots': 'Body variable examples/masks only. Fixed header/footer, section, styles and relationships preserve-only.',
            'fidelity': 'Package-part hashes, fixed text/run styles, original unchanged, all-page rendering before PASS.'}
(root / 'artifact.md').write_text('# QA template execution contract\n\n'+json.dumps(evidence, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
print(json.dumps(evidence))
