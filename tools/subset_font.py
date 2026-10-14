#!/usr/bin/env python3
"""Subset Noto Serif SC to the characters the built reader actually uses.

Usage: python3 tools/subset_font.py SOURCE.ttf assets/fonts/FONT.woff2 [FAMILY]
Needs fonttools and brotli. Run after tools/build.py so index.html is current.
"""
import html, os, re, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAMILY = 'Creation Song'


def used_text():
    text = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    text = html.unescape(text)  # markup, attributes and script strings alike
    return set(text) | set(chr(c) for c in range(0x20, 0x7f)) | set('“”‘’—–…·、，。：；！？（）《》「」『』〔〕【】')


def main(src, out, family=FAMILY):
    font = TTFont(src)
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(text=''.join(sorted(used_text())))
    sub.subset(font)
    if 'fvar' in font:
        font = instancer.instantiateVariableFont(font, {'wght': (400, 600)})
    for record in font['name'].names:
        if record.nameID in (1, 4, 16):
            record.string = family
        elif record.nameID == 6:
            record.string = family.replace(' ', '')
    font.flavor = 'woff2'
    font.save(out)
    print(f'wrote {out}: {len(font.getGlyphOrder())} glyphs, {os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    main(*sys.argv[1:4])
