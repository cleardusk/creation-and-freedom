#!/usr/bin/env python3
"""Build the bilingual reader from content/<lang>/{book,notes}.md.

book.md   '# NN | part | title' starts a chapter, '## ' a section heading,
          other non-empty lines are paragraphs. Inline: [^nXX] note refs,
          [text](url) links, **text** emphasis.
notes.md  '@ nXX | title' starts a note, plain lines are its copy,
          '> link title | url | source' lines are its sources.

Usage: python3 tools/build.py   (writes index.html and en/index.html)
"""
import html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
VERSION = '2.4.5'

UI = {
    'zh': dict(
        lang='zh-CN', out='index.html', assets='assets/', other='en/index.html', other_lang='en', other_label='EN',
        title='创造与自由', subtitle='纳瓦尔思想读本', description='创造与自由：纳瓦尔思想读本。', afterword='结语', default_family='kai',
        cover_meta=('2021 — 2026', '四部 · 十二章'), start='开始阅读', parts_label='四部', full_toc='全书目录',
        skip='跳到正文', switch='切换语言', contents='目录', pager='翻页', prev_page='上一页', next_page='下一页',
        settings='阅读设置', pin='固定目录', close_contents='关闭目录', search='搜索全书', search_placeholder='输入词句…',
        marks='我的标记', export='导出备份', import_='导入备份', marks_hint='标记按语言保存；导入备份会合并现有标记。',
        marks_empty='你高亮或划线的文字会显示在这里。', back_cover='返回封面', chapters_label='章节',
        reading='阅读', typeface='字体', faces=('书宋', '黑体', '楷体'), layout='翻页', modes=('左右翻页', '连续滚动'),
        size='字号', weight='字重', weights=('轻', '标准', '重'), night='夜读', show_notes='显示批注',
        tap_help='轻点正文左侧返回、右侧前进，中间可选字。', mark_help='选中文字可高亮或划线，标记保存在当前浏览器。',
        epub=f'creation-and-freedom-v{VERSION}.epub', pdf=f'creation-and-freedom-v{VERSION}.pdf',
        storage='当前浏览器无法保存阅读进度。', note='批注', close_note='关闭批注', text_marks='文字标记',
        mark_buttons=('高亮', '划线', '清除'), close_marks='关闭标记工具', undo='撤销上次修改',
        chapter_nav='章节导航', cover='封面', prev_chapter='上一章', next_chapter='下一章',
        note_label='查看批注{n}: {title}', notes_bank='批注', note_kind='来源', end='终', sep='；',
        tagline='创造的成本下降了，自由的成本没有。', disclaimer='独立编写 · 未经纳瓦尔授权或审阅',
        limit='编者按', part_range='第{a}—{b}章', chapter_no='第{n}章',
    ),
    'en': dict(
        lang='en', out='en/index.html', assets='../assets/', other='../index.html', other_lang='zh-CN', other_label='中文',
        title='Creation and Freedom', subtitle='A Naval Reader', description='Creation and Freedom：A Naval Reader。', afterword='Afterword', default_family='serif',
        cover_meta=('2021 — 2026', 'FOUR PARTS · TWELVE CHAPTERS'), start='Start reading', parts_label='Four parts',
        full_toc='Full contents', skip='Skip to text', switch='Switch language', contents='Contents', pager='Layout',
        prev_page='Previous page', next_page='Next page', settings='Reading settings', pin='Pin contents',
        close_contents='Close contents', search='Search this book', search_placeholder='Search words or phrases…',
        marks='My marks', export='Export backup', import_='Import backup',
        marks_hint='Marks are saved per language. Importing merges them with your existing marks.',
        marks_empty='Your highlights and underlines will appear here.', back_cover='Back to cover', chapters_label='Chapters',
        reading='Reading', typeface='Typeface', faces=('Serif', 'Sans', 'Classic'), layout='Layout', modes=('Pages', 'Scroll'),
        size='Size', weight='Weight', weights=('Light', 'Regular', 'Heavy'), night='Night', show_notes='Show notes',
        tap_help='Tap the left side to go back or the right side to continue. The center remains available for selecting text.',
        mark_help='Select text to highlight or underline. Marks are saved in this browser.',
        epub=f'creation-and-freedom-v{VERSION}-en.epub', pdf=f'creation-and-freedom-v{VERSION}-en.pdf',
        storage='This browser cannot save your reading position.', note='Note', close_note='Close note',
        text_marks='Text marks', mark_buttons=('Highlight', 'Underline', 'Clear'), close_marks='Close marking tools',
        undo='Undo last change', chapter_nav='Chapter navigation', cover='Cover', prev_chapter='Previous chapter',
        next_chapter='Next chapter', note_label='Read note {n}: {title}', notes_bank='Notes', note_kind='Source',
        end='FINIS', sep='; ',
        tagline='Making got cheaper. Freedom didn’t.', disclaimer='Independent · Not authorized or reviewed by Naval',
        limit='Editor’s note', part_range='Chapters {a}–{b}', chapter_no='Chapter {n}',
    ),
}

esc = lambda s: html.escape(s, quote=True)


def smarten(text):
    """Typographer's quotes for English prose; URLs are left untouched."""
    parts = re.split(r'(https?://\S+)', text)
    for i in range(0, len(parts), 2):
        t = parts[i]
        t = re.sub(r"(\w)'", '\\1\u2019', t)
        t = re.sub(r"'(\d\d)s", '\u2019\\1s', t)
        t = re.sub(r"(^|[\s(\[\u2014\u201c])'", '\\1\u2018', t)
        t = t.replace("'", '\u2019')
        t = re.sub(r'(^|[\s(\[\u2014\u2018])"', '\\1\u201c', t)
        t = t.replace('"', '\u201d')
        parts[i] = t
    return ''.join(parts)


def read(path, lang):
    text = open(path, encoding='utf-8').read()
    return smarten(text) if lang == 'en' else text


def parse_book(path, lang):
    chapters = []
    for line in read(path, lang).split('\n'):
        line = line.rstrip()
        if not line:
            continue
        if line.startswith('# '):
            cid, part, title = [x.strip() for x in line[2:].split('|', 2)]
            chapters.append(dict(id=cid, part=part, title=title, blocks=[]))
        elif line.startswith('## '):
            chapters[-1]['blocks'].append(('h2', line[3:].strip()))
        else:
            chapters[-1]['blocks'].append(('p', line.strip()))
    return chapters


def parse_notes(path, lang):
    notes = {}
    for chunk in re.split(r'\n(?=@ )', read(path, lang).strip()):
        lines = [l for l in chunk.split('\n') if l.strip()]
        nid, title = [x.strip() for x in lines[0][2:].split('|', 1)]
        copy = [l for l in lines[1:] if not l.startswith('> ')]
        links = [[x.strip() for x in l[2:].split('|')] for l in lines[1:] if l.startswith('> ')]
        notes[nid] = dict(title=title, copy=copy, links=links)
    return notes


def inline(text, ui, notes, numbers):
    """Render inline markup; returns (html, plain text for search)."""
    out, plain, pos = [], [], 0
    pattern = re.compile(r'\[\^(n\d+)\]|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*')
    for m in pattern.finditer(text):
        before = text[pos:m.start()]
        # Keep a note marker on the same line as the word it annotates.
        tail = re.search(r'\S+$' if ui['lang'] == 'en' else r'.[^\w\s]*$', before) if m.group(1) else None
        head = before[:tail.start()] if tail else before
        out.append(html.escape(head, quote=False))
        plain.append(before)
        if m.group(1):
            nid = m.group(1)
            if nid not in numbers:
                numbers[nid] = len(numbers) + 1
            n = numbers[nid]
            label = ui['note_label'].format(n=n, title=notes[nid]['title'])
            marker = (f'<a class="paragraph-note" href="#{nid}" data-note="{nid}" aria-haspopup="dialog" '
                      f'aria-controls="note-dialog" aria-expanded="false" aria-label="{esc(label)}">{n}</a>')
            out.append(f'<span class="note-anchor">{html.escape(tail.group(), quote=False)}{marker}</span>' if tail else marker)
        elif m.group(2):
            out.append(f'<a href="{esc(m.group(3))}" rel="noopener noreferrer">{esc(m.group(2))}</a>')
            plain.append(m.group(2))
        elif m.group(4):
            out.append(f'<strong>{esc(m.group(4))}</strong>')
            plain.append(m.group(4))
        else:
            out.append(f'<em>{esc(m.group(5))}</em>')
            plain.append(m.group(5))
        pos = m.end()
    out.append(html.escape(text[pos:], quote=False))
    plain.append(text[pos:])
    return ''.join(out), ''.join(plain)


def toc_title(ch):
    """Split 'Chapter 01 Title' / '第01章 标题' into (number, short title)."""
    m = re.match(r'^(?:第(\d+)章|Chapter (\d+)) (.+)$', ch['title'])
    return (m.group(1) or m.group(2), m.group(3)) if m else (None, ch['title'])


def toc(chapters, ui):
    groups = []
    for ch in chapters:
        if not groups or groups[-1][0] != ch['part']:
            groups.append((ch['part'], []))
        groups[-1][1].append(ch)
    out = []
    for part, chs in groups:
        links = []
        for ch in chs:
            num, title = toc_title(ch)
            if num:
                links.append(f'<a href="#c{ch["id"]}"><span class="toc-number">{num}</span><span class="toc-title">{esc(title)}</span></a>')
            else:
                title = ui['afterword'] if ch['id'] == '13' else title
                links.append(f'<a href="#c{ch["id"]}">{esc(title)}</a>')
        out.append(f'<div class="toc-group"><h2>{esc(part)}</h2>{"".join(links)}</div>')
    return ''.join(out)


def build(lang):
    ui = UI[lang]
    chapters = parse_book(os.path.join(ROOT, 'content', lang, 'book.md'), lang)
    notes = parse_notes(os.path.join(ROOT, 'content', lang, 'notes.md'), lang)
    numbers, search, sections = {}, [], []
    for i, ch in enumerate(chapters):
        cid = ch['id']
        num, short = toc_title(ch)
        pre, _, post = ui['chapter_no'].partition('{n}')
        kicker = (f'<span class="chapter-no"><span class="visually-hidden">{esc(pre)}</span>{num}'
                  f'<span class="visually-hidden">{esc(post)} · </span></span>' if num else '')
        body = [f'<section class="chapter" id="c{cid}" data-id="{cid}" aria-labelledby="c{cid}-b000">'
                f'<header class="chapter-header"><p class="chapter-part">{kicker}<span class="chapter-part-name">{esc(ch["part"])}</span></p>'
                f'<h1 id="c{cid}-b000" data-prose="c{cid}-b000" tabindex="-1">{esc(short)}</h1></header>']
        limit = False
        for b, (tag, text) in enumerate(ch['blocks'], 1):
            bid = f'c{cid}-b{b:03d}'
            rendered, plain = inline(text, ui, notes, numbers)
            if tag == 'h2':
                m = re.match(r'^(编者按：|Editor’s note: )(.+)$', text)
                limit = bool(m)
                if m:
                    rendered = (f'<span class="limit-tag">{esc(ui["limit"])}<span class="visually-hidden">{esc(m.group(1)[len(ui["limit"]):])}</span></span>'
                                + inline(m.group(2), ui, notes, numbers)[0])
            row = ('row heading-row' if tag == 'h2' else 'row') + (' limit-row' if limit else '')
            body.append(f'<div class="{row}"><div class="prose"><{tag} id="{bid}" data-prose="{bid}" tabindex="-1">{rendered}</{tag}></div></div>')
            search.append(dict(anchor=bid, title=ch['title'], text=plain))
        if i == len(chapters) - 1:
            body.append(f'<div class="book-end"><span>{ui["end"]}</span><i></i></div>')
        prev = (f'<a href="#c{chapters[i-1]["id"]}"><span class="chapter-nav-label">{ui["prev_chapter"]}</span>{esc(chapters[i-1]["title"])}</a>'
                if i else f'<a href="#cover">{ui["cover"]}</a>')
        nxt = (f'<a href="#c{chapters[i+1]["id"]}"><span class="chapter-nav-label">{ui["next_chapter"]}</span>{esc(chapters[i+1]["title"])}</a>'
               if i < len(chapters) - 1 else f'<a href="#cover">{ui["cover"]}</a>')
        body.append(f'<nav class="chapter-nav" aria-label="{ui["chapter_nav"]}">{prev}{nxt}</nav></section>')
        sections.append(''.join(body))
    missing = set(notes) - set(numbers)
    assert not missing, f'{lang}: notes never referenced: {sorted(missing)}'
    bank = []
    for nid, n in sorted(numbers.items(), key=lambda x: x[1]):
        note = notes[nid]
        copy = ''.join(f'<p>{inline(p, ui, notes, numbers)[0]}</p>' for p in note['copy'])
        links = ''.join(f'<div><a href="{esc(u)}" rel="noopener noreferrer" title="{esc(t)}" aria-label="{esc(t)}">{esc(t)}</a>'
                        f'<div class="note-source">{esc(s)}</div></div>' for t, u, s in note['links'])
        bank.append(f'<article id="{nid}" data-title="{esc(note["title"])}" data-kind="{ui["note_kind"]}"><h2>{n} · {esc(note["title"])}</h2>'
                    f'<div class="note-copy">{copy}<div class="note-links">{links}</div></div></article>')
    data = dict(language=ui['lang'], title=ui['title'], chapters=[dict(id=c['id'], title=c['title']) for c in chapters], search=search)
    starts = {}
    for ch in chapters:
        if re.search(r'\d', ch['part']):
            starts.setdefault(ch['part'], [ch['id'], ch['id']])[1] = ch['id']
    return render(ui, chapters, sections, bank, data, starts)


def render(ui, chapters, sections, bank, data, starts):
    tpl = open(os.path.join(TOOLS, 'shell.html'), encoding='utf-8').read()
    css = open(os.path.join(TOOLS, 'reader.css'), encoding='utf-8').read().replace('{{ASSETS}}', ui['assets'])
    js = open(os.path.join(TOOLS, 'reader.js'), encoding='utf-8').read()
    parts = ''.join(
        f'<a href="#c{a}"><span class="part-number">{i:02d}</span><span class="part-name">{esc(re.sub(r"^.*· ", "", part))}</span>'
        f'<span class="part-range">{ui["part_range"].format(a=int(a), b=int(b))}</span>'
        '<svg class="part-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></a>'
        for i, (part, (a, b)) in enumerate(starts.items(), 1))
    values = dict(ui, css=css.rstrip('\n'), js=js.rstrip('\n'), toc=toc(chapters, ui), parts=parts,
                  chapters=''.join(sections), bank=''.join(bank), data=json.dumps(data, ensure_ascii=False).replace('</', '<\\/'),
                  meta_a=ui['cover_meta'][0], meta_b=ui['cover_meta'][1], face_a=ui['faces'][0], face_b=ui['faces'][1],
                  face_c=ui['faces'][2], weight_a=ui['weights'][0], weight_b=ui['weights'][1], weight_c=ui['weights'][2], serif_checked='checked' if ui['default_family']=='serif' else '',
                  kai_checked='checked' if ui['default_family']=='kai' else '',
                  mode_a=ui['modes'][0], mode_b=ui['modes'][1], mark_a=ui['mark_buttons'][0],
                  mark_b=ui['mark_buttons'][1], mark_c=ui['mark_buttons'][2], version=VERSION)
    return re.sub(r'\{\{(\w+)\}\}', lambda m: values[m.group(1)], tpl)


if __name__ == '__main__':
    for lang in UI:
        out = os.path.join(ROOT, UI[lang]['out'])
        open(out, 'w', encoding='utf-8').write(build(lang))
        print('wrote', os.path.relpath(out, ROOT))
