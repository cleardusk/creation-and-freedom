"""Check release files against the source manuscript (requires pymupdf)."""
import re
import sys
import unittest
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET

import pymupdf as fitz
import build

OUT = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path('output/releases') / ('v' + build.VERSION)
compact = lambda text: re.sub(r'[\s\u00ad\u2010]+', '', text).casefold()


class Editions(unittest.TestCase):
    def test_epubs_have_complete_text_notes_and_valid_local_links(self):
        for lang in build.UI:
            with self.subTest(lang=lang):
                notes = build.parse_notes(f'{build.ROOT}/content/{lang}/notes.md', lang)
                path = OUT / build.UI[lang]['epub']
                self.assertTrue(path.is_file(), f'Missing edition: {path}')
                with zipfile.ZipFile(path) as z:
                    self.assertIsNone(z.testzip())
                    self.assertEqual(z.infolist()[0].filename, 'mimetype')
                    self.assertEqual(z.infolist()[0].compress_type, zipfile.ZIP_STORED)
                    self.assertEqual(z.read('mimetype'), b'application/epub+zip')
                    docs = {name: ET.fromstring(z.read(name)) for name in z.namelist() if name.endswith('.xhtml')}
                    for name, doc in docs.items():
                        ids = [e.attrib['id'] for e in doc.iter() if 'id' in e.attrib]
                        self.assertEqual(len(ids), len(set(ids)), name)
                        for e in doc.iter():
                            for attr in ('href', 'src'):
                                ref = urlsplit(e.get(attr, ''))
                                if ref.scheme or ref.netloc or not e.get(attr):
                                    continue
                                target = str(Path(name).parent / unquote(ref.path)) if ref.path else name
                                self.assertIn(target, z.namelist(), (name, e.attrib))
                                if ref.fragment:
                                    self.assertTrue(any(n.get('id') == unquote(ref.fragment) for n in docs[target].iter()), (name, e.attrib))
                    for ch in build.parse_book(f'{build.ROOT}/content/{lang}/book.md', lang):
                        doc = docs[f'EPUB/c{ch["id"]}.xhtml']
                        for parent in doc.iter():
                            for child in list(parent):
                                if child.get('class') == 'noteref':
                                    parent.remove(child)
                        text = compact(''.join(doc.itertext()))
                        self.assertIn(compact(ch['title']), text)
                        for _, block in ch['blocks']:
                            plain = build.inline(block, build.UI[lang], notes, {})[1]
                            self.assertTrue(compact(plain) in text, f'{lang}: EPUB missing text: {plain[:90]}')
                    for nid, note in notes.items():
                        doc = docs['EPUB/notes.xhtml']
                        self.assertTrue(any(n.get('id') == nid for n in doc.iter()))
                        for copy in note['copy']:
                            self.assertTrue(compact(build.inline(copy, build.UI[lang], notes, {})[1]) in compact(''.join(doc.itertext())))
                        for title, url, source in note['links']:
                            self.assertTrue(any(n.get('href') == url for n in doc.iter()))

    def test_pdfs_have_all_body_text_and_no_annotation_markers(self):
        for lang in build.UI:
            with self.subTest(lang=lang):
                notes = build.parse_notes(f'{build.ROOT}/content/{lang}/notes.md', lang)
                path = OUT / build.UI[lang]['pdf']
                self.assertTrue(path.is_file(), f'Missing edition: {path}')
                with fitz.open(path) as pdf:
                    self.assertGreater(len(pdf), 15)
                    self.assertTrue(all(page.get_text().strip() for page in pdf))
                    text = compact(''.join(page.get_text(clip=fitz.Rect(0, 40, page.rect.width, page.rect.height - 40)) for page in pdf))
                    for ch in build.parse_book(f'{build.ROOT}/content/{lang}/book.md', lang):
                        for tag, block in ch['blocks']:
                            plain = build.inline(block, build.UI[lang], notes, {})[1]
                            if tag == 'h2':
                                plain = re.sub(r'^(编者按：|Editor’s note: )', '', plain)
                            self.assertTrue(compact(plain) in text, f'{lang}: PDF missing text: {plain[:90]}')
                    self.assertFalse(any(link.get('kind') == fitz.LINK_GOTO for page in pdf for link in page.get_links()))


if __name__ == '__main__':
    unittest.main()
