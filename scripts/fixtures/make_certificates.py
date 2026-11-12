"""Generates the extraction test set: realistic, synthetic compliance documents
with known correct values (truth.json). Every company, insurer and policy is
invented, and each page carries a "Test specimen" footer.

Run:  python3 scripts/fixtures/make_certificates.py
Real, anonymised certificates can be added next to these with their own entry
in truth.json; the evaluator treats them the same way.
"""
import json, os, random
from reportlab.lib.pagesizes import letter, A4
from reportlab.pdfgen import canvas
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
import subprocess

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'fixtures', 'certificates')
os.makedirs(OUT, exist_ok=True)
random.seed(7)
truth = []

def footer(c, w):
    c.setFont('Helvetica', 7); c.setFillGray(0.4)
    c.drawString(36, 22, 'Test specimen generated for SubCleared extraction testing. Not a real policy or certificate.')
    c.setFillGray(0)

def box(c, x, y, w, h, title=None):
    c.rect(x, y, w, h)
    if title:
        c.setFont('Helvetica-Bold', 6.5); c.drawString(x + 3, y + h - 8, title)

def acord(path, insured, insurer, policies, holder, issued='2026-03-02', ai=True, waiver=True, addr='212 Market St, Springfield, IL 62701'):
    """ACORD 25-style certificate: one row per policy."""
    W, H = letter
    c = canvas.Canvas(path, pagesize=letter)
    c.setFont('Helvetica-Bold', 13); c.drawString(36, H - 50, 'CERTIFICATE OF LIABILITY INSURANCE')
    c.setFont('Helvetica', 8); c.drawRightString(W - 36, H - 50, f'DATE (MM/DD/YYYY)  {issued[5:7]}/{issued[8:10]}/{issued[:4]}')
    c.setFont('Helvetica', 6.5)
    c.drawString(36, H - 64, 'THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER.')
    box(c, 36, H - 150, 270, 76, 'PRODUCER'); c.setFont('Helvetica', 8)
    for i, l in enumerate(['Brightway Insurance Brokers', '40 Commerce Plaza, Suite 300', 'Springfield, IL 62704']): c.drawString(42, H - 98 - i * 11, l)
    box(c, 306, H - 150, W - 342, 76, 'INSURER(S) AFFORDING COVERAGE')
    c.setFont('Helvetica', 8); c.drawString(312, H - 98, f'INSURER A :  {insurer}'); c.drawString(312, H - 110, 'INSURER B :')
    box(c, 36, H - 226, 270, 76, 'INSURED'); c.setFont('Helvetica-Bold', 9); c.drawString(42, H - 174, insured)
    c.setFont('Helvetica', 8); c.drawString(42, H - 186, addr)
    box(c, 306, H - 226, W - 342, 76, 'COVERAGES')
    c.setFont('Helvetica', 6.5); c.drawString(312, H - 174, 'THE POLICIES LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE')
    y = H - 250
    c.setFont('Helvetica-Bold', 6.5)
    for x, t in [(40, 'TYPE OF INSURANCE'), (190, 'ADDL INSD'), (232, 'SUBR WVD'), (272, 'POLICY NUMBER'), (360, 'POLICY EFF'), (412, 'POLICY EXP'), (456, 'LIMITS')]: c.drawString(x, y, t)
    c.line(36, y - 4, W - 36, y - 4)
    y -= 20
    for p in policies:
        c.setFont('Helvetica-Bold', 7.5); c.drawString(40, y, p['type'])
        c.setFont('Helvetica', 7.5)
        if p.get('ai') is not None: c.drawString(198, y, 'Y' if p['ai'] else 'N')
        if p.get('waiver') is not None: c.drawString(240, y, 'Y' if p['waiver'] else 'N')
        c.drawString(272, y, p['number']); c.drawString(360, y, p['eff']); c.drawString(412, y, p['exp'])
        for i, (k, v) in enumerate(p['limits']):
            c.setFont('Helvetica', 6.2); c.drawString(456, y - i * 10, k)
            c.setFont('Helvetica', 7.5); c.drawRightString(W - 40, y - i * 10, f'$ {v:,}')
        y -= max(16, 10 * len(p['limits']) + 8)
        c.line(36, y + 6, W - 36, y + 6)
    box(c, 36, y - 60, W - 72, 52, 'DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES')
    c.setFont('Helvetica', 7.5); c.drawString(42, y - 30, 'Certificate holder is included as additional insured where required by written contract.' if ai else 'Re: general subcontract work.')
    box(c, 36, y - 140, 300, 72, 'CERTIFICATE HOLDER'); c.setFont('Helvetica', 9)
    for i, l in enumerate(holder.split('\n')): c.drawString(42, y - 92 - i * 11, l)
    box(c, 336, y - 140, W - 372, 72, 'CANCELLATION'); c.setFont('Helvetica', 6.5)
    c.drawString(342, y - 92, 'SHOULD ANY OF THE ABOVE POLICIES BE CANCELLED BEFORE THE'); c.drawString(342, y - 100, 'EXPIRATION DATE, NOTICE WILL BE DELIVERED PER POLICY PROVISIONS.')
    c.drawString(342, y - 124, 'AUTHORIZED REPRESENTATIVE   J. Whitfield')
    footer(c, W); c.save()

def mdY(iso): return f'{iso[5:7]}/{iso[8:10]}/{iso[:4]}'

def add(file, kind, fields, note, low=None, pages=1):
    truth.append({'file': file, 'kind': kind, 'fields': fields, 'note': note, 'expectLowConfidence': low or []})

# 1. Clean US certificate
gl = {'type': 'COMMERCIAL GENERAL LIABILITY', 'ai': True, 'waiver': True, 'number': 'GL-4471-22', 'eff': mdY('2026-03-01'), 'exp': mdY('2027-03-01'), 'limits': [('EACH OCCURRENCE', 1000000), ('GENERAL AGGREGATE', 2000000)]}
auto = {'type': 'AUTOMOBILE LIABILITY', 'ai': True, 'waiver': True, 'number': 'CA-4471-22', 'eff': mdY('2026-03-01'), 'exp': mdY('2027-03-01'), 'limits': [('COMBINED SINGLE LIMIT', 1000000)]}
umb = {'type': 'UMBRELLA LIAB', 'ai': None, 'waiver': None, 'number': 'UM-4471-22', 'eff': mdY('2026-03-01'), 'exp': mdY('2027-03-01'), 'limits': [('EACH OCCURRENCE', 5000000)]}
wc = {'type': "WORKERS COMPENSATION AND EMPLOYERS' LIABILITY", 'ai': None, 'waiver': True, 'number': 'WC-4471-22', 'eff': mdY('2026-03-01'), 'exp': mdY('2027-03-01'), 'limits': [('E.L. EACH ACCIDENT', 1000000)]}
acord(f'{OUT}/us-acord-clean.pdf', 'Keystone Plumbing LLC', 'Granite Mutual Insurance Company', [gl, auto, umb, wc], 'Harbourline Construction\n18 Dock Road\nSpringfield, IL 62702')
add('us-acord-clean.pdf', 'insurance_certificate', {'namedInsured': 'Keystone Plumbing LLC', 'issuer': 'Granite Mutual Insurance Company', 'referenceNumber': 'GL-4471-22', 'issueDate': '2026-03-01', 'expiryDate': '2027-03-01', 'glEachOccurrence': 1000000, 'glAggregate': 2000000, 'autoCombinedSingleLimit': 1000000, 'umbrellaLimit': 5000000, 'wcCoverage': True, 'additionalInsured': True, 'waiverOfSubrogation': True, 'certificateHolder': 'Harbourline Construction'}, 'Clean ACORD-style certificate, four policies, same dates')

# 2. Several policies with different expiry dates
gl2 = {**gl, 'number': 'GL-9032-10', 'eff': mdY('2026-01-15'), 'exp': mdY('2027-01-15')}
auto2 = {**auto, 'number': 'CA-9032-10', 'eff': mdY('2025-12-01'), 'exp': mdY('2026-12-01')}
wc2 = {**wc, 'number': 'WC-9032-10', 'eff': mdY('2025-09-30'), 'exp': mdY('2026-09-30')}
acord(f'{OUT}/us-multi-policy.pdf', 'Ridgeline Mechanical Inc', 'Granite Mutual Insurance Company', [gl2, auto2, wc2], 'Harbourline Construction\n18 Dock Road\nSpringfield, IL 62702', issued='2026-02-01')
add('us-multi-policy.pdf', 'insurance_certificate', {'namedInsured': 'Ridgeline Mechanical Inc', 'issuer': 'Granite Mutual Insurance Company', 'glEachOccurrence': 1000000, 'glAggregate': 2000000, 'autoCombinedSingleLimit': 1000000, 'wcCoverage': True, 'expiryDate': '2026-09-30'}, 'Policies expire on different dates; the earliest (workers comp, 30 Sep 2026) must be reported, with an issue raised')

# 3. Wrong company (submitted by Pennine Roofing)
acord(f'{OUT}/wrong-company.pdf', 'Northgate Roofing Ltd', 'Granite Mutual Insurance Company', [{**gl, 'number': 'GL-7710-03'}], 'Harbourline Construction\n18 Dock Road\nSpringfield, IL 62702')
add('wrong-company.pdf', 'insurance_certificate', {'namedInsured': 'Northgate Roofing Ltd', 'expiryDate': '2027-03-01', 'glEachOccurrence': 1000000, 'referenceNumber': 'GL-7710-03'}, 'Certificate names a different company than the subcontractor who sent it')

# 4. Expired
acord(f'{OUT}/expired.pdf', 'Keystone Plumbing LLC', 'Granite Mutual Insurance Company', [{**gl, 'number': 'GL-3120-19', 'eff': mdY('2024-11-01'), 'exp': mdY('2025-10-31')}], 'Harbourline Construction\n18 Dock Road\nSpringfield, IL 62702', issued='2024-11-03')
add('expired.pdf', 'insurance_certificate', {'namedInsured': 'Keystone Plumbing LLC', 'expiryDate': '2025-10-31', 'issueDate': '2024-11-01', 'referenceNumber': 'GL-3120-19'}, 'Expired policy')

# 5. Limit too low
acord(f'{OUT}/low-limit.pdf', 'Brookside Painting Co', 'Granite Mutual Insurance Company', [{**gl, 'number': 'GL-5580-41', 'limits': [('EACH OCCURRENCE', 500000), ('GENERAL AGGREGATE', 1000000)]}], 'Harbourline Construction\n18 Dock Road\nSpringfield, IL 62702')
add('low-limit.pdf', 'insurance_certificate', {'namedInsured': 'Brookside Painting Co', 'glEachOccurrence': 500000, 'glAggregate': 1000000, 'expiryDate': '2027-03-01'}, 'Each-occurrence limit below a typical $1m requirement')

# 6. UK insurance schedule (DD/MM/YYYY, GBP)
def uk_schedule(path, insured='Thameside Electrical Services Ltd', start='01/04/2026', end='31/03/2027'):
    W, H = A4; c = canvas.Canvas(path, pagesize=A4)
    c.setFont('Helvetica-Bold', 16); c.drawString(50, H - 70, 'Albion General plc')
    c.setFont('Helvetica', 9); c.drawString(50, H - 84, 'Registered in England and Wales. Authorised and regulated insurer (specimen).')
    c.setFont('Helvetica-Bold', 13); c.drawString(50, H - 120, 'Contractors Combined Insurance  Policy Schedule')
    rows = [('Policy number', 'AG/CCI/88213'), ('Policyholder', insured), ('Business description', 'Electrical contractors'), ('Period of insurance', f'From {start} to {end} (both days inclusive)'), ('Date of issue', '24/03/2026')]
    y = H - 150
    for k, v in rows:
        c.setFont('Helvetica-Bold', 10); c.drawString(50, y, k); c.setFont('Helvetica', 10); c.drawString(210, y, v); y -= 18
    y -= 10; c.setFont('Helvetica-Bold', 11); c.drawString(50, y, 'Sections in force'); y -= 18
    for k, v in [('Section 1  Public Liability', 'Limit of indemnity  £5,000,000 any one occurrence'), ("Section 2  Employers' Liability", 'Limit of indemnity  £10,000,000 any one occurrence'), ('Section 3  Contract Works', 'Not insured')]:
        c.setFont('Helvetica', 10); c.drawString(50, y, k); c.drawString(250, y, v); y -= 16
    y -= 14; c.setFont('Helvetica', 9); c.drawString(50, y, 'Indemnity to principals: included where required by contract (Section 1 extension 4).')
    footer(c, W); c.save()
uk_schedule(f'{OUT}/uk-schedule.pdf')
uk_truth = {'namedInsured': 'Thameside Electrical Services Ltd', 'issuer': 'Albion General plc', 'referenceNumber': 'AG/CCI/88213', 'issueDate': '2026-04-01', 'expiryDate': '2027-03-31', 'glEachOccurrence': 5000000, 'elLimit': 10000000, 'wcCoverage': True, 'currency': 'GBP'}
add('uk-schedule.pdf', 'insurance_certificate', uk_truth, 'UK schedule: DD/MM/YYYY dates, pounds, public and employers liability')

def raster(pdf, png, dpi):
    subprocess.run(['pdftoppm', '-r', str(dpi), '-singlefile', '-png', pdf, png[:-4]], check=True)

# 7. Poor scan of the UK schedule: low resolution, slight rotation, blur, noise, grey
raster(f'{OUT}/uk-schedule.pdf', '/tmp/uk.png', 110)
im = Image.open('/tmp/uk.png').convert('L').rotate(1.6, expand=True, fillcolor=235).filter(ImageFilter.GaussianBlur(0.8))
im = ImageEnhance.Contrast(im).enhance(0.7)
px = im.load()
for _ in range(int(im.size[0] * im.size[1] * 0.02)):
    x, y = random.randrange(im.size[0]), random.randrange(im.size[1]); px[x, y] = random.choice([60, 200])
im.save(f'{OUT}/uk-schedule-poor-scan.jpg', quality=55)
add('uk-schedule-poor-scan.jpg', 'insurance_certificate', uk_truth, 'Same schedule as a low-quality greyscale scan: 110 dpi, rotated, blurred, noisy, JPEG quality 55')

# 8. Phone photo of the clean US certificate: perspective, uneven light, background
raster(f'{OUT}/us-acord-clean.pdf', '/tmp/acord.png', 150)
doc = Image.open('/tmp/acord.png').convert('RGB')
w, h = doc.size
bg = Image.new('RGB', (int(w * 1.25), int(h * 1.18)), (92, 84, 74))
coeffs_src = [(0, 0), (w, 0), (w, h), (0, h)]
dst = [(90, 60), (w + 160, 110), (w + 120, h + 120), (40, h + 70)]
import numpy as np
def find_coeffs(pa, pb):
    m = []
    for p1, p2 in zip(pa, pb):
        m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    A = np.matrix(m, dtype=float); B = np.array(pb).reshape(8)
    return np.array(np.dot(np.linalg.inv(A.T * A) * A.T, B)).reshape(8)
coeffs = find_coeffs(dst, coeffs_src)
warped = doc.transform(bg.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(92, 84, 74))
shade = Image.new('L', bg.size, 0); d = ImageDraw.Draw(shade)
for i in range(bg.size[0]): d.line([(i, 0), (i, bg.size[1])], fill=int(70 * i / bg.size[0]))
photo = Image.composite(Image.new('RGB', bg.size, (0, 0, 0)), warped, shade)
photo = photo.filter(ImageFilter.GaussianBlur(0.6)).resize((photo.size[0] * 2 // 3, photo.size[1] * 2 // 3))
photo.save(f'{OUT}/us-acord-phone-photo.jpg', quality=70)
add('us-acord-phone-photo.jpg', 'insurance_certificate', {k: v for k, v in truth[0]['fields'].items()}, 'Phone photo of the clean certificate: perspective skew, shadow, background, downscaled')

# 9. Ambiguous date order
def ambiguous(path):
    W, H = A4; c = canvas.Canvas(path, pagesize=A4)
    c.setFont('Helvetica-Bold', 14); c.drawString(50, H - 70, 'Certificate of Insurance')
    c.setFont('Helvetica', 10)
    for i, (k, v) in enumerate([('Insured', 'Coastline Glazing Ltd'), ('Insurer', 'Meridian Assurance Ltd'), ('Policy', 'MA-20931'), ('Cover', 'Public liability, limit 2,000,000'), ('Effective', '03/04/2026'), ('Expiry', '02/04/2027')]):
        c.drawString(50, H - 110 - i * 18, f'{k}:'); c.drawString(160, H - 110 - i * 18, v)
    footer(c, W); c.save()
ambiguous(f'{OUT}/ambiguous-dates.pdf')
add('ambiguous-dates.pdf', 'insurance_certificate', {'namedInsured': 'Coastline Glazing Ltd', 'issuer': 'Meridian Assurance Ltd', 'referenceNumber': 'MA-20931', 'glEachOccurrence': 2000000}, 'Dates could be 3 April or 4 March; no country or currency shown. The reader must not be confident about the dates.', low=['issueDate', 'expiryDate'])

# 10. Additional insured endorsement
def endorsement(path):
    W, H = letter; c = canvas.Canvas(path, pagesize=letter)
    c.setFont('Helvetica', 8); c.drawString(36, H - 40, 'POLICY NUMBER: GL-4471-22                                                      COMMERCIAL GENERAL LIABILITY')
    c.setFont('Helvetica-Bold', 12); c.drawCentredString(W / 2, H - 70, 'ADDITIONAL INSURED - OWNERS, LESSEES OR CONTRACTORS - SCHEDULED PERSON OR ORGANIZATION')
    c.setFont('Helvetica', 8.5)
    lines = ['This endorsement modifies insurance provided under the following: COMMERCIAL GENERAL LIABILITY COVERAGE PART.', '', 'Named Insured: Keystone Plumbing LLC', 'Insurer: Granite Mutual Insurance Company', 'Endorsement effective: 03/01/2026          Policy expiration: 03/01/2027', '', 'SCHEDULE', 'Name of Additional Insured Person(s) or Organization(s): Harbourline Construction and Quayside Library Trust', 'Location(s) of Covered Operations: Quayside Library project, 1 Harbour Walk', '', 'Section II - Who Is An Insured is amended to include as an additional insured the person(s) or organization(s) shown', 'in the Schedule, but only with respect to liability for bodily injury or property damage caused, in whole or in part,', "by your acts or omissions in the performance of your ongoing operations for the additional insured(s).", '', 'WAIVER OF TRANSFER OF RIGHTS OF RECOVERY: We waive any right of recovery against the person(s) or organization(s)', 'shown in the Schedule above.']
    for i, l in enumerate(lines): c.drawString(36, H - 100 - i * 13, l)
    footer(c, W); c.save()
endorsement(f'{OUT}/endorsement.pdf')
add('endorsement.pdf', 'insurance_endorsement', {'namedInsured': 'Keystone Plumbing LLC', 'issuer': 'Granite Mutual Insurance Company', 'referenceNumber': 'GL-4471-22', 'issueDate': '2026-03-01', 'expiryDate': '2027-03-01', 'additionalInsured': True, 'waiverOfSubrogation': True}, 'Additional insured endorsement page with waiver wording')

# 11. Contractor licence
def licence(path):
    W, H = letter; c = canvas.Canvas(path, pagesize=letter)
    c.setFont('Helvetica-Bold', 15); c.drawCentredString(W / 2, H - 80, 'STATE CONTRACTOR LICENSING BOARD (SPECIMEN)')
    c.setFont('Helvetica-Bold', 12); c.drawCentredString(W / 2, H - 104, 'Electrical Contractor License')
    c.setFont('Helvetica', 11)
    for i, (k, v) in enumerate([('Licensee', 'Lee Electrical Ltd'), ('License number', 'EC-55821'), ('Classification', 'Electrical - unrestricted'), ('Jurisdiction', 'State of Illinois'), ('Issued', 'June 1, 2025'), ('Expires', 'May 31, 2027')]):
        c.drawString(150, H - 150 - i * 22, f'{k}:'); c.drawString(290, H - 150 - i * 22, v)
    footer(c, W); c.save()
licence(f'{OUT}/licence.pdf')
add('licence.pdf', 'licence_registration', {'namedInsured': 'Lee Electrical Ltd', 'referenceNumber': 'EC-55821', 'issueDate': '2025-06-01', 'expiryDate': '2027-05-31', 'jurisdiction': 'State of Illinois'}, 'Contractor licence with written-out dates')

# 12. Method statement (2 pages)
def rams(path):
    W, H = A4; c = canvas.Canvas(path, pagesize=A4)
    c.setFont('Helvetica-Bold', 14); c.drawString(50, H - 70, 'Risk Assessment and Method Statement')
    c.setFont('Helvetica', 10)
    for i, (k, v) in enumerate([('Company', 'Harbour Scaffolding Ltd'), ('Project', 'Quayside Library'), ('Activity', 'Erection and dismantling of tube and fitting scaffold'), ('Prepared by', 'D. Hughes, Contracts Manager'), ('Revision', 'B'), ('Date', '02/10/2026'), ('Review date', '02/04/2027')]):
        c.drawString(50, H - 100 - i * 16, f'{k}:'); c.drawString(170, H - 100 - i * 16, v)
    c.drawString(50, H - 240, '1. Sequence of works ... (continued on page 2)')
    footer(c, W); c.showPage()
    c.setFont('Helvetica', 10); c.drawString(50, H - 70, '2. Hazards and controls: falls from height - edge protection, harness where required.')
    footer(c, W); c.save()
rams(f'{OUT}/method-statement.pdf')
add('method-statement.pdf', 'method_statement', {'namedInsured': 'Harbour Scaffolding Ltd', 'projectReference': 'Quayside Library', 'issueDate': '2026-10-02', 'expiryDate': '2027-04-02'}, 'Two-page method statement, UK dates')

# 13-16. Company and tax documents that look alike, and an employers' liability-only certificate.
def simple(path, title, rows, note=None):
    W, H = A4; c = canvas.Canvas(path, pagesize=A4)
    c.setFont('Helvetica-Bold', 15); c.drawString(50, H - 70, title)
    c.setFont('Helvetica', 10)
    for i, (k, v) in enumerate(rows):
        c.drawString(50, H - 104 - i * 18, f'{k}:'); c.drawString(210, H - 104 - i * 18, v)
    if note: c.drawString(50, H - 120 - len(rows) * 18, note)
    footer(c, W); c.save()
simple(f'{OUT}/vat-registration.pdf', 'Certificate of Registration for VAT', [('Name', 'Thameside Electrical Services Ltd'), ('VAT registration number', 'GB 284 7716 52'), ('Effective date of registration', '1 May 2021'), ('Issued by', 'HM Revenue & Customs')], 'This certificate confirms registration for Value Added Tax.')
add('vat-registration.pdf', 'tax_registration', {'namedInsured': 'Thameside Electrical Services Ltd', 'issuer': 'HM Revenue & Customs', 'referenceNumber': 'GB 284 7716 52', 'issueDate': '2021-05-01'}, 'VAT registration certificate (a tax document, not a company registration)')
simple(f'{OUT}/tax-clearance.pdf', 'Tax Clearance Certificate', [('Taxpayer', 'Thameside Electrical Services Ltd'), ('Reference', 'TC-2026-118204'), ('Date of issue', '3 February 2026'), ('Valid until', '2 February 2027'), ('Issued by', 'Revenue Commissioners')], 'The taxpayer named above is in good standing with the tax authority.')
add('tax-clearance.pdf', 'tax_registration', {'namedInsured': 'Thameside Electrical Services Ltd', 'referenceNumber': 'TC-2026-118204', 'issueDate': '2026-02-03', 'expiryDate': '2027-02-02'}, 'Tax clearance certificate (a tax document, not a company registration)')
simple(f'{OUT}/company-incorporation.pdf', 'Certificate of Incorporation of a Private Limited Company', [('Company name', 'Thameside Electrical Services Ltd'), ('Company number', '09876543'), ('Incorporated on', '14 March 2016'), ('Registrar', 'Registrar of Companies for England and Wales')], 'The company is limited by shares and its registered office is in England and Wales.')
add('company-incorporation.pdf', 'company_registration', {'namedInsured': 'Thameside Electrical Services Ltd', 'referenceNumber': '09876543', 'issueDate': '2016-03-14'}, 'Certificate of incorporation')
simple(f'{OUT}/el-only.pdf', 'Certificate of Employers\' Liability Insurance', [('Policy holder', 'Thameside Electrical Services Ltd'), ('Insurer', 'Albion General Insurance plc'), ('Policy number', 'EL-447190'), ('Period of insurance', '01/06/2026 to 31/05/2027'), ('Limit of indemnity', 'GBP 10,000,000 any one occurrence')], 'Employers\' Liability (Compulsory Insurance) Act 1969. This certificate covers employers\' liability only.')
add('el-only.pdf', 'insurance_certificate', {'namedInsured': 'Thameside Electrical Services Ltd', 'issuer': 'Albion General Insurance plc', 'referenceNumber': 'EL-447190', 'issueDate': '2026-06-01', 'expiryDate': '2027-05-31', 'elLimit': 10000000, 'wcCoverage': True}, "Employers' liability only: must not pass as public liability")

with open(f'{OUT}/truth.json', 'w') as f: json.dump(truth, f, indent=2)
print(len(truth), 'documents written to', os.path.abspath(OUT))
