#!/usr/bin/env python3
"""Build bilingual EPUBs, annotation-free PDFs, and an offline reader ZIP.

Install tools/requirements-editions.txt and run playwright install chromium first.
Usage: python3 tools/build_editions.py [--output output/releases/v2.4.0]
"""
import argparse
import hashlib
import io
import re
import zipfile
from pathlib import Path

from ebooklib import epub
from fontTools.ttLib import TTFont
from playwright.sync_api import sync_playwright

import build

ROOT = Path(build.ROOT)
STYLE = '''
@font-face {font-family: "Creation Song"; src: url("fonts/reader-song.ttf")}
body {font-family: "Creation Song", Georgia, serif; line-height: 1.8; margin: 5%;}
h1 {font-size: 1.8em; line-height: 1.35; margin: 1.5em 0 1em;}
h2 {font-size: 1.2em; margin-top: 1.8em;}
p {margin: 0 0 1em; orphans: 2; widows: 2;}
a {color: #2e4a6b;} .part, .disclaimer {font-size: .85em;}
.art {width: 100%; height: auto; margin: 2em 0;}
.noteref {font-size: .7em; vertical-align: super; text-decoration: none;}
.note {margin-bottom: 2em;} .note-anchor {white-space: nowrap;}
'''


def build_epub(lang, out):
    ui = build.UI[lang]
    chapters = build.parse_book(ROOT / 'content' / lang / 'book.md', lang)
    notes = build.parse_notes(ROOT / 'content' / lang / 'notes.md', lang)
    book = epub.EpubBook()
    book.set_identifier(f'creation-and-freedom-{lang}-v{build.VERSION}')
    book.set_title(ui['title'] + ' · ' + ui['subtitle'])
    book.set_language(ui['lang'])
    book.add_metadata('DC', 'description', ui['disclaimer'])
    css = epub.EpubItem(uid='style', file_name='style.css', media_type='text/css', content=STYLE.encode())
    book.add_item(css)
    font = TTFont(ROOT / 'assets/fonts/reader-song-v240.woff2')
    font.flavor = None
    font_bytes = io.BytesIO()
    font.save(font_bytes)
    book.add_item(epub.EpubItem(uid='font', file_name='fonts/reader-song.ttf', media_type='font/ttf', content=font_bytes.getvalue()))
    book.add_item(epub.EpubItem(uid='font-license', file_name='fonts/OFL.txt', media_type='text/plain', content=(ROOT / 'assets/fonts/OFL.txt').read_bytes()))
    book.set_cover('art.png', (ROOT / 'assets/cover-art.png').read_bytes(), create_page=False)

    def page(name, title, content):
        item = epub.EpubHtml(title=title, file_name=name, lang=ui['lang'])
        item.content = content
        item.add_item(css)
        book.add_item(item)
        return item

    cover = page('cover.xhtml', ui['title'], f'<section epub:type="titlepage"><p>2021 — 2026 · v{build.VERSION}</p>'
                 f'<h1>{build.esc(ui["title"])}</h1><p>{build.esc(ui["subtitle"])}</p><p>{build.esc(ui["tagline"])}</p>'
                 f'<img class="art" src="art.png" alt=""/><p class="disclaimer">{build.esc(ui["disclaimer"])}</p></section>')
    numbers, items = {}, []
    for ch in chapters:
        body = [f'<section id="c{ch["id"]}"><p class="part">{build.esc(ch["part"])}</p><h1>{build.esc(ch["title"])}</h1>']
        for tag, text in ch['blocks']:
            rendered = build.inline(text, ui, notes, numbers)[0]
            rendered = re.sub(r'<a class="paragraph-note"[^>]*data-note="(n\d+)"[^>]*>(\d+)</a>',
                              r'<a class="noteref" epub:type="noteref" href="notes.xhtml#\1">\2</a>', rendered)
            body.append(f'<{tag}>{rendered}</{tag}>')
        items.append(page(f'c{ch["id"]}.xhtml', ch['title'], ''.join(body) + '</section>'))
    note_body = [f'<section epub:type="endnotes"><h1>{build.esc(ui["notes_bank"])}</h1>']
    for nid, n in numbers.items():
        note = notes[nid]
        note_body.append(f'<section class="note" id="{nid}" epub:type="endnote"><h2>{n} · {build.esc(note["title"])}</h2>')
        for text in note['copy']:
            note_body.append('<p>' + build.inline(text, ui, notes, numbers)[0] + '</p>')
        for title, url, source in note['links']:
            note_body.append(f'<p><a href="{build.esc(url)}">{build.esc(title)}</a><br/>{build.esc(source)}</p>')
        note_body.append('</section>')
    endnotes = page('notes.xhtml', ui['notes_bank'], ''.join(note_body) + '</section>')
    book.toc = [cover, *items, endnotes]
    book.spine = [cover, 'nav', *items, endnotes]
    book.add_item(epub.EpubNcx())
    nav = epub.EpubNav(title=ui['full_toc'])
    nav.add_item(css)
    book.add_item(nav)
    epub.write_epub(str(out / ui['epub']), book)


def build_pdfs(out):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for ui in build.UI.values():
            page = browser.new_page(java_script_enabled=False)
            page.goto((ROOT / ui['out']).as_uri(), wait_until='networkidle')
            page.emulate_media(media='print')
            page.evaluate('document.fonts.ready')
            page.pdf(path=str(out / ui['pdf']), prefer_css_page_size=True, print_background=True,
                     display_header_footer=True, header_template='<span></span>',
                     footer_template='<div style="font-size:8px;width:100%;text-align:center;color:#666"><span class="pageNumber"></span></div>',
                     tagged=True, outline=True)
            page.close()
        browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'output/releases' / ('v' + build.VERSION))
    out = parser.parse_args().output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    for lang, ui in build.UI.items():
        (ROOT / ui['out']).write_text(build.build(lang), encoding='utf-8')
        build_epub(lang, out)
    build_pdfs(out)
    bundle = out / f'creation-and-freedom-v{build.VERSION}-offline.zip'
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in [ROOT / 'index.html', ROOT / 'en/index.html', *sorted((ROOT / 'assets').rglob('*'))]:
            if path.is_file():
                text = path.read_text(encoding='utf-8') if path.suffix == '.html' else None
                if text:
                    prefix = '../' if path.parent.name == 'en' else ''
                    text = re.sub(r'https://github.com/cleardusk/creation-and-freedom/releases/download/v[^/]+/', prefix, text)
                    z.writestr(str(path.relative_to(ROOT)), text)
                else:
                    z.write(path, path.relative_to(ROOT))
        for ui in build.UI.values():
            for kind in ('epub', 'pdf'):
                z.write(out / ui[kind], ui[kind])
    assets = [out / ui[kind] for ui in build.UI.values() for kind in ('epub', 'pdf')] + [bundle]
    for path in assets:
        print(path.name, path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
