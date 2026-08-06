# -*- coding: utf-8 -*-
# 生成一个带文本层的最小 PDF（fixture.pdf），供 kbExtract.extractPdf 做真实抽取验证
import os

TEXT = "Hello Knowledge Base TCP Handshake 12345"

def build_pdf(text):
    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
    stream = ("BT /F1 24 Tf 72 720 Td (%s) Tj ET" % text).encode('latin-1')
    objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += ("%d 0 obj\n" % i).encode() + o + b"\nendobj\n"
    xref_pos = len(out)
    out += ("xref\n0 %d\n" % (len(objs) + 1)).encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += ("%010d 00000 n \n" % off).encode()
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref_pos)).encode()
    return bytes(out)

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, 'fixture.pdf')
    with open(target, 'wb') as f:
        f.write(build_pdf(TEXT))
    print(f"fixture.pdf 生成完成: {os.path.getsize(target)} bytes, 含文本: {TEXT!r}")

if __name__ == '__main__':
    main()
