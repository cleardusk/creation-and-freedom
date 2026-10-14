(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement, data = JSON.parse($('book-data').textContent);
  if ('scrollRestoration' in history) history.scrollRestoration='manual';
  const en=data.language==='en',t=(zh,english)=>en?english:zh;
  const chapters = [...document.querySelectorAll('.chapter')];
  const stage = $('reading-stage'), menu = $('contents'), noteDialog = $('note-dialog');
  const pinContents = $('pin-contents'), wideScreen = matchMedia('(min-width:1024px)');
  const font = $('font-size'), family = $('font-family'), weight = $('font-weight'), mode = $('reading-mode'), night = $('night-mode'), notes = $('show-notes');
  for (const group of [family,weight,mode]) Object.defineProperty(group,'value',{get:()=>group.querySelector('input:checked').value,set:value=>group.querySelectorAll('input').forEach(input=>input.checked=input.value===value)});
  const key = 'naval-reader-v2.2';
  const preferenceKey='naval-reader-preferences-v1',preferenceNames=['font','family','weight','mode','night','notes','tocPinned'];
  const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
  let state = {}, current = '', page = 0, pages = 1, step = 1, busy = false, timer, resizeTimer, appScrollY = -1;
  let laidOut = null, savedPosition = null, trigger = null, progressWarningShown=false;
  const warnProgress=()=>{
    $('storage-message').hidden=false;
    if(!progressWarningShown){$('mark-status').textContent=t('当前浏览器无法保存阅读设置或进度。','This browser cannot save your reading settings or position.');progressWarningShown=true;}
  };
  try {
    const own = localStorage.getItem(key);
    state = JSON.parse(own || '{}') || {};
    if (typeof state !== 'object' || Array.isArray(state)) state = {};
    if (!own) {
      const previous = JSON.parse(localStorage.getItem('naval-reader-v2.1') || '{}') || {};
      state = {chapter:previous.chapter,font:previous.font,night:previous.night,notes:previous.notes};
    }
    const preferences=JSON.parse(localStorage.getItem(preferenceKey)||'null');
    if(record(preferences)){
      for(const name of preferenceNames)if(Object.hasOwn(preferences,name))state[name]=preferences[name];
      if(record(preferences.typefaces))state.typefaces=preferences.typefaces;
    }
  } catch { warnProgress(); }
  const save = (changed=[]) => {
    try {
      let latest={};
      try {latest=JSON.parse(localStorage.getItem(key)||'{}')||{};} catch {}
      if(typeof latest!=='object'||Array.isArray(latest))latest={};
      let preferences=null;
      try {preferences=JSON.parse(localStorage.getItem(preferenceKey)||'null');} catch {}
      if(!record(preferences))preferences=null;
      const savedPreferences=preferences||latest;
      const next={...latest,...state};
      // Saving progress from an older tab must not undo another tab's settings.
      for(const name of preferenceNames){
        if(!changed.includes(name)&&Object.hasOwn(savedPreferences,name))next[name]=savedPreferences[name];
      }
      const faces=record(savedPreferences.typefaces)?savedPreferences.typefaces:state.typefaces;
      next.typefaces={...faces};
      if(changed.includes('family')||changed.includes('weight'))next.typefaces[data.language]=state.typefaces[data.language];
      // Older reader versions only write the progress key. Migrate settings once,
      // then update this separate record only after an explicit settings change.
      if(!preferences||changed.length)localStorage.setItem(preferenceKey,JSON.stringify(Object.fromEntries([...preferenceNames,'typefaces'].filter(name=>Object.hasOwn(next,name)).map(name=>[name,next[name]]))));
      localStorage.setItem(key,JSON.stringify(next));
    } catch {warnProgress();}
  };
  font.value = Number.isFinite(state.font) ? Math.min(26,Math.max(12,state.font)) : 18;
  const validFamily=value=>['serif','sans','kai'].includes(value),validWeight=value=>['light','normal','heavy'].includes(value);
  if(!state.typefaces||typeof state.typefaces!=='object'||Array.isArray(state.typefaces)){
    state.typefaces={};
    if(validFamily(state.family)){
      const language=['zh-CN','en'].includes(state.language)?state.language:data.language;
      state.typefaces[language]={family:state.family,weight:validWeight(state.weight)?state.weight:'normal'};
    }
  }
  const typography=state.typefaces[data.language]||{};
  family.value=validFamily(typography.family)?typography.family:root.dataset.font;
  weight.value=validWeight(typography.weight)?typography.weight:'normal';
  mode.value = state.mode === 'scroll' ? 'scroll' : 'paged';
  night.checked = state.night === true; notes.checked = state.notes === true;
  const active = () => $('c'+current);
  const paged = () => mode.value === 'paged' && Boolean(current);
  const pinned = () => wideScreen.matches && state.tocPinned === true;
  const menuBlocking = () => menu.open && !pinned();
  let touch=null,tap=null,tapTimer=0;
  const phoneScreen=matchMedia('(max-width:700px)');
  const cancelTap=()=>{clearTimeout(tapTimer);tapTimer=0;tap=null;};
  const syncContents = () => {
    document.body.classList.toggle('has-pinned-contents',pinned() && menu.open);
    pinContents.hidden = !wideScreen.matches;
    pinContents.setAttribute('aria-pressed',String(pinned()));
    const label=pinned()?t('取消固定目录','Unpin contents'):t('固定目录','Pin contents');
    pinContents.setAttribute('aria-label',label);pinContents.title=label;
    $('menu-button').setAttribute('aria-expanded',String(menu.open));
    menu.setAttribute('aria-modal',String(menuBlocking()));
  };
  const applyOptions = () => {
    root.style.setProperty('--body-size',font.value+'px'); root.dataset.font = family.value; root.dataset.weight=weight.value;
    root.toggleAttribute('data-night',night.checked);
    document.body.classList.toggle('notes-hidden',!notes.checked);
    document.body.classList.toggle('is-paged',paged());
    $('font-value').value = font.value;
    document.querySelectorAll('.paragraph-note').forEach(a => { a.tabIndex = notes.checked ? 0 : -1; a.setAttribute('aria-hidden',String(!notes.checked)); });
    $('pager').hidden = !paged();
    $('tap-help').hidden=mode.value!=='paged';
  };
  // A hairline under the top bar shows how far into the current chapter the reader is.
  const showProgress = () => {
    const done=!current?0:paged()?(page+1)/pages:Math.min(1,scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight));
    root.style.setProperty('--progress',String(done));
  };
  const updatePager = () => {
    showProgress();
    $('page-status').textContent = `${page+1} / ${pages}`;
    $('page-status').setAttribute('aria-label',`${data.chapters.find(c=>c.id===current)?.title || ''}, ${t('第','page ')}${page+1}${t('页，共',' of ')}${pages}${t('页','')}`);
    $('previous-page').setAttribute('aria-disabled',String(current === data.chapters[0].id && page === 0));
    $('next-page').setAttribute('aria-disabled',String(current === data.chapters.at(-1).id && page === pages-1));
  };
  const markCurrent = () => {
    const resumable = data.chapters.some(c=>c.id===state.chapter), entry = $('reading-entry');
    entry.hidden = false; entry.href = resumable ? '#c'+state.chapter : '#c00';
    const arrow = document.createElement('span'); arrow.textContent='→';arrow.setAttribute('aria-hidden','true');
    entry.replaceChildren(resumable?t('继续阅读','Continue reading'):t('开始阅读','Start reading'),arrow);
    document.querySelectorAll('.book-toc a').forEach(a => {
      a.removeAttribute('aria-current');
      if(a.hash==='#c'+current)a.setAttribute('aria-current','page');
      a.querySelector('.last-position')?.remove();
      if(a.hash==='#c'+state.chapter){
        const m=document.createElement('span');m.className='last-position';m.title=t('上次阅读位置','Last reading position');
        m.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg><span class="visually-hidden"></span>';m.querySelector('span').textContent=m.title;a.append(m);
      }
    });
  };
  const textNodes = el => {
    const walker = document.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.paragraph-note')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
    const nodes=[]; while(walker.nextNode())nodes.push(walker.currentNode);return nodes;
  };
  const markToolbar=$('mark-toolbar'), markKey='naval-reader-marks-v1:'+data.language;
  let markRecords={}, markSelection=[], markTimer, markError='', marksReadable=true, pendingMarks={}, undoChange=null, announcement;
  const plainText=el=>textNodes(el).map(n=>n.data).join('');
  const validRecord=record=>record&&typeof record==='object'&&typeof record.text==='string'&&record.text.length<=20000&&Array.isArray(record.ranges)&&record.ranges.length<=2000&&record.ranges.every((r,i)=>r&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=record.text.length&&[1,2,3].includes(r.flags)&&(!i||r.start>=record.ranges[i-1].end));
  const validMarks=(record,el)=>validRecord(record)&&record.text===plainText(el);
  const announce=message=>{cancelAnimationFrame(announcement);$('mark-status').textContent='';announcement=requestAnimationFrame(()=>$('mark-status').textContent=message);};
  const markWarning=message=>{
    markError=message;$('mark-storage-message').textContent=message;$('mark-storage-message').hidden=!message;
    $('mark-feedback').textContent=message;$('mark-feedback').hidden=!message;announce(message);
  };
  const parseMarkRecords=raw=>{
    if(!raw)return {};
    const parsed=JSON.parse(raw);if(!parsed||parsed.version!==1||!parsed.blocks||typeof parsed.blocks!=='object'||Array.isArray(parsed.blocks)||!Object.values(parsed.blocks).every(validRecord))throw new Error('Invalid marks');return parsed.blocks;
  };
  try{
    const raw=localStorage.getItem(markKey);
    markRecords=parseMarkRecords(raw);
  }catch{marksReadable=false;markWarning(t('已保存的标记暂时无法读取，原记录将保留。','Saved marks could not be read. The original records will be kept.'));}
  const rangesFor=el=>Object.hasOwn(markRecords,el.id)&&validMarks(markRecords[el.id],el)?markRecords[el.id].ranges:[];
  const renderMarks=el=>{
    el.querySelectorAll('.reader-mark').forEach(mark=>mark.replaceWith(...mark.childNodes));el.normalize();
    const ranges=rangesFor(el);if(!ranges.length)return;
    let offset=0;
    for(const n of textNodes(el)){
      const start=offset,end=offset+n.length;offset=end;
      const hits=ranges.filter(r=>r.start<end&&r.end>start);if(!hits.length)continue;
      const fragment=document.createDocumentFragment();let cursor=start;
      for(const r of hits){
        const a=Math.max(r.start,start),b=Math.min(r.end,end);
        if(a>cursor)fragment.append(document.createTextNode(n.data.slice(cursor-start,a-start)));
        const mark=document.createElement('mark');mark.className='reader-mark';mark.dataset.flags=r.flags;
        mark.dataset.start=r.start;mark.dataset.end=r.end;mark.textContent=n.data.slice(a-start,b-start);fragment.append(mark);cursor=b;
      }
      if(cursor<end)fragment.append(document.createTextNode(n.data.slice(cursor-start)));n.replaceWith(fragment);
    }
  };
  for(const id of Object.keys(markRecords)){
    const el=$(id);if(!el?.matches('[data-prose]')||!stage.contains(el))continue;
    if(validMarks(markRecords[id],el))renderMarks(el);
    else markWarning(t('部分标记对应的文字已更新，已保留原记录。','Some marked text has changed. The original records have been kept.'));
  }
  const dismissMarks=(clear=false)=>{
    clearTimeout(markTimer);markToolbar.hidden=true;markSelection=[];
    if(clear)undoChange=null;
    if(clear&&stage.contains(getSelection()?.anchorNode))getSelection().removeAllRanges();
  };
  const captureMarks=()=>{
    const selection=getSelection(),chapter=active();if(!chapter||!selection?.rangeCount||selection.isCollapsed)return [];
    const range=selection.getRangeAt(0);if(!chapter.contains(range.startContainer)||!chapter.contains(range.endContainer))return [];
    const pieces=[];
    for(const el of chapter.querySelectorAll('[data-prose]')){
      let offset=0,start=null,end=0;
      for(const n of textNodes(el)){
        const a=range.startContainer===n?range.startOffset:range.comparePoint(n,0)<0?n.length:0;
        const b=range.endContainer===n?range.endOffset:range.comparePoint(n,n.length)>0?0:n.length;
        if(b>a){if(start===null)start=offset+a;end=offset+b;}offset+=n.length;
      }
      if(start!==null&&plainText(el).slice(start,end).trim())pieces.push({id:el.id,start,end});
    }
    return pieces;
  };
  const coverage=(piece,flag)=>{
    let cursor=piece.start;
    for(const r of rangesFor($(piece.id))){if(r.end<=cursor)continue;if(r.start>cursor||!(r.flags&flag))return false;cursor=Math.min(piece.end,r.end);if(cursor===piece.end)return true;}return false;
  };
  const placeMarkToolbar=()=>{
    if(!markSelection.length)return;
    const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;
    const viewport=window.visualViewport,viewLeft=viewport?.offsetLeft||0,viewTop=viewport?.offsetTop||0;
    const viewRight=viewLeft+(viewport?.width||innerWidth),viewBottom=viewTop+(viewport?.height||innerHeight);
    const readingLeft=pinned()&&menu.open?menu.getBoundingClientRect().right:0;
    const rects=range?[...range.getClientRects()]:[charRect($(markSelection[0].id),markSelection[0].start)];
    const rect=rects.find(r=>r.width&&r.right>readingLeft&&r.left<viewRight&&r.bottom>viewTop&&r.top<viewBottom);if(!rect){dismissMarks();return;}
    $('undo-mark').hidden=!undoChange;
    markToolbar.hidden=false;
    const box=markToolbar.getBoundingClientRect();
    let left=Math.max(Math.max(readingLeft,viewLeft)+12,Math.min(rect.left+rect.width/2-box.width/2,viewRight-box.width-12));
    let top=rect.top-box.height-12>viewTop+64?rect.top-box.height-12:Math.min(rect.bottom+12,viewBottom-box.height-12);
    if(matchMedia('(max-width:700px)').matches){
      left=viewLeft+(viewRight-viewLeft-box.width)/2;
      const bottom=paged()?Math.min(viewBottom-16,$('pager').getBoundingClientRect().top-12):viewBottom-18;
      const visible=rects.filter(r=>r.width&&r.right>viewLeft&&r.left<viewRight&&r.bottom>viewTop&&r.top<viewBottom);
      const endpoints=[visible[0],visible.at(-1)].filter(Boolean);
      const candidates=[bottom-box.height,viewTop+64,viewTop+(viewBottom-viewTop-box.height)/2];
      const free=candidates.find(y=>y>=viewTop+12&&y+box.height<=viewBottom-12&&!endpoints.some(r=>y<r.bottom+14&&y+box.height>r.top-14));
      top=free??candidates[0];
    }
    markToolbar.style.left=left+'px';markToolbar.style.top=Math.max(viewTop+12,top)+'px';
    for(const b of markToolbar.querySelectorAll('[data-mark]')){
      const flag=Number(b.dataset.mark);if(flag)b.setAttribute('aria-pressed',String(markSelection.every(p=>coverage(p,flag))));
      else b.disabled=!markSelection.some(p=>rangesFor($(p.id)).some(r=>r.start<p.end&&r.end>p.start));
    }
  };
  const restoreMarkSelection=pieces=>{
    const point=(id,offset)=>{const nodes=textNodes($(id));for(const n of nodes){if(offset<=n.length)return [n,offset];offset-=n.length;}const n=nodes.at(-1);return [n,n.length];};
    const first=pieces[0],last=pieces.at(-1),range=document.createRange();range.setStart(...point(first.id,first.start));range.setEnd(...point(last.id,last.end));
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  };
  const changeMarks=(ranges,piece,flag,remove)=>{
    const edges=[...new Set([piece.start,piece.end,...ranges.flatMap(r=>[r.start,r.end])])].sort((a,b)=>a-b),next=[];
    for(let i=0;i<edges.length-1;i++){
      const start=edges[i],end=edges[i+1],old=ranges.find(r=>r.start<=start&&r.end>=end);
      let flags=old?.flags||0;
      if(start>=piece.start&&end<=piece.end)flags=flag===0?0:remove?flags&~flag:flags|flag;
      if(!flags)continue;
      const previous=next.at(-1);if(previous?.end===start&&previous.flags===flags)previous.end=end;else next.push({start,end,flags});
    }
    return next;
  };
  const syncMarkRecords=()=>{
    try{
      const latest=parseMarkRecords(localStorage.getItem(markKey));marksReadable=true;
      const ids=new Set([...Object.keys(markRecords),...Object.keys(latest),...Object.keys(pendingMarks)]);
      markRecords=latest;
      for(const [id,record] of Object.entries(pendingMarks)){if(record)markRecords[id]=record;else delete markRecords[id];}
      for(const id of ids){const el=$(id);if(el?.matches('[data-prose]')&&stage.contains(el))renderMarks(el);}
      return true;
    }catch{marksReadable=false;return false;}
  };
  const persistMarks=()=>{
    let saved=false;
    try{if(!marksReadable)throw new Error('Existing marks unreadable');localStorage.setItem(markKey,JSON.stringify({version:1,blocks:markRecords}));pendingMarks={};if(markError)markWarning('');saved=true;}
    catch{markWarning(t('本次标记未保存，刷新后会丢失。','These marks were not saved and will be lost on reload.'));}
    refreshMarkList();return saved;
  };
  const archiveMark=(id,record)=>{
    if(!validRecord(record)||!record.ranges.length)return null;
    const original=JSON.stringify(record);
    for(const [key,value] of Object.entries(markRecords))if(key.startsWith(id+'~')&&JSON.stringify(value)===original)return null;
    let n=1;while(Object.hasOwn(markRecords,id+'~'+n))n++;
    const key=id+'~'+n;markRecords[key]=record;pendingMarks[key]=record;return key;
  };
  const applyMark=flag=>{
    if(!markSelection.length||menuBlocking()||noteDialog.open)return;
    const pieces=markSelection.slice();
    // Merge current storage before every edit so another tab's marks survive.
    syncMarkRecords();
    const before={},after={};
    const remove=flag&&pieces.every(p=>coverage(p,flag));
    for(const piece of pieces){
      const el=$(piece.id);if(!el||el.closest('.chapter')!==active())return;
      before[el.id]=markRecords[el.id]||null;
      if(markRecords[el.id]&&!validMarks(markRecords[el.id],el)){
        const archived=archiveMark(el.id,markRecords[el.id]);if(archived){before[archived]=null;after[archived]=markRecords[archived];}
      }
      const ranges=changeMarks(rangesFor(el),piece,flag,remove);
      if(ranges.length)markRecords[el.id]={text:plainText(el),ranges};else delete markRecords[el.id];
      pendingMarks[el.id]=markRecords[el.id]||null;after[el.id]=pendingMarks[el.id];renderMarks(el);
    }
    undoChange={before,after,pieces};persistMarks();
    restoreMarkSelection(pieces);markSelection=pieces;placeMarkToolbar();remember();
    if(!markError)announce(flag===0?t('已清除所选文字的标记。','Marks cleared from the selected text.'):flag===1?t('已保存高亮。','Highlight saved.'):t('已保存划线。','Underline saved.'));
  };
  $('undo-mark').addEventListener('click',()=>{
    if(!undoChange)return;
    const change=undoChange;syncMarkRecords();
    if(Object.entries(change.after).some(([id,record])=>JSON.stringify(markRecords[id]||null)!==JSON.stringify(record))){undoChange=null;markWarning(t('这处标记已在其他标签页更新，无法撤销。','These marks changed in another tab and cannot be undone.'));placeMarkToolbar();return;}
    for(const [id,record] of Object.entries(change.before)){
      if(record)markRecords[id]=record;else delete markRecords[id];pendingMarks[id]=record;
      const el=$(id);if(el?.matches('[data-prose]'))renderMarks(el);
    }
    undoChange=null;const saved=persistMarks();restoreMarkSelection(change.pieces);markSelection=change.pieces;placeMarkToolbar();markToolbar.querySelector('button:not(:disabled):not([hidden])')?.focus({preventScroll:true});if(saved)announce(t('已撤销上次标记修改。','Last mark change undone.'));
  });
  markToolbar.querySelectorAll('[data-mark]').forEach(b=>b.addEventListener('click',()=>applyMark(Number(b.dataset.mark))));
  markToolbar.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')e.preventDefault();});
  const closeMarks=()=>{const el=$(markSelection[0]?.id);dismissMarks(true);el?.focus({preventScroll:true});};
  $('close-marks').addEventListener('click',closeMarks);
  markToolbar.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeMarks();return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();const buttons=[...markToolbar.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
    const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();
  });
  document.addEventListener('selectionchange',()=>{
    clearTimeout(markTimer);markTimer=setTimeout(()=>{
      if(markToolbar.contains(document.activeElement)||menuBlocking()||noteDialog.open)return;
      markSelection=captureMarks();if(markSelection.length)placeMarkToolbar();else dismissMarks();
    },80);
  });
  document.addEventListener('pointerdown',e=>{if(!markToolbar.contains(e.target))dismissMarks();});
  stage.addEventListener('click',e=>{
    const mark=e.target.closest('.reader-mark');if(!mark||e.target.closest('a')||getSelection()?.toString())return;
    markSelection=[{id:mark.closest('[data-prose]').id,start:Number(mark.dataset.start),end:Number(mark.dataset.end)}];restoreMarkSelection(markSelection);placeMarkToolbar();
  });
  window.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!markToolbar.hidden){e.preventDefault();closeMarks();}
    if(e.key==='Tab'&&!e.shiftKey&&!markToolbar.hidden&&!markToolbar.contains(e.target)){e.preventDefault();markToolbar.querySelector('button').focus();}
  });
  window.addEventListener('storage',e=>{
    if(e.key!==markKey&&e.key!==null)return;
    try{
      const latest=parseMarkRecords(localStorage.getItem(markKey)),ids=new Set([...Object.keys(markRecords),...Object.keys(latest)]);
      markRecords=latest;
      for(const [id,record] of Object.entries(pendingMarks)){if(record)markRecords[id]=record;else delete markRecords[id];}
      dismissMarks(true);
      for(const id of ids){const el=$(id);if(el?.matches('[data-prose]')&&stage.contains(el))renderMarks(el);}
      refreshMarkList();
    }catch{markWarning(t('另一标签页的标记暂时无法读取。','Marks from another tab could not be read.'));}
  });

  const markEntries=()=>{
    const entries=[];
    for(const [id,record] of Object.entries(markRecords)){
      if(!/^c\d{2}-b\d{3}(?:~[1-9]\d*)?$/.test(id)||!validRecord(record))continue;
      const anchor=id.split('~')[0],chapter=data.chapters.find(c=>c.id===anchor.slice(1,3)),el=$(anchor);
      if(!chapter)continue;
      const stale=id!==anchor||!el||!validMarks(record,el);
      const excerpts=[];
      for(const range of record.ranges){const previous=excerpts.at(-1);if(previous?.end===range.start){previous.end=range.end;previous.flags|=range.flags;}else excerpts.push({...range});}
      for(const range of excerpts)entries.push({id,anchor,chapter,record,range,stale});
    }
    return entries.sort((a,b)=>a.anchor.localeCompare(b.anchor)||Number(a.stale)-Number(b.stale)||a.range.start-b.range.start||a.id.localeCompare(b.id));
  };
  const refreshMarkList=()=>{
    const entries=markEntries();$('marks-count').textContent=entries.length?String(entries.length):'';
    if(!$('marks-panel').open)return;
    const list=$('mark-list');list.replaceChildren();$('marks-empty').hidden=entries.length>0;
    let group,cid='';
    for(const entry of entries.slice(0,200)){
      if(cid!==entry.chapter.id){cid=entry.chapter.id;group=document.createElement('section');group.className='mark-group';const heading=document.createElement('h3');heading.textContent=entry.chapter.title;group.append(heading);list.append(group);}
      const button=document.createElement('button');button.type='button';button.className='mark-entry';button.disabled=entry.stale;
      const kind=document.createElement('small');kind.textContent=(entry.stale?t('旧版摘录 · ','Earlier text · '):'')+(entry.range.flags===3?t('高亮与划线','Highlight and underline'):entry.range.flags===1?t('高亮','Highlight'):t('划线','Underline'));
      const quote=document.createElement('span'),text=entry.record.text.slice(entry.range.start,entry.range.end);quote.textContent=text.length>180?text.slice(0,180)+'…':text;
      button.append(kind,quote);button.addEventListener('click',()=>{navigate('#'+entry.anchor);const pos={anchor:entry.anchor,textOffset:entry.range.start};layout(pos);remember(pos);$(entry.anchor).focus({preventScroll:true});});group.append(button);
    }
    if(entries.length>200){const hint=document.createElement('p');hint.className='muted';hint.textContent=t('显示前200条；备份包含全部标记。','Showing the first 200 marks. Backups include all marks.');list.append(hint);}
  };
  $('marks-panel').addEventListener('toggle',refreshMarkList);refreshMarkList();
  const backupMessage=message=>{$('marks-message').textContent=message;$('marks-message').hidden=!message;announce(message);};
  $('export-marks').addEventListener('click',()=>{
    if(!syncMarkRecords()){backupMessage(t('已保存的记录无法读取，暂时无法导出。','Saved records could not be read, so a backup could not be exported.'));return;}
    const backup={format:'naval-reader-marks',version:1,language:data.language,title:data.title,exportedAt:new Date().toISOString(),blocks:markRecords};
    const blob=new Blob([JSON.stringify(backup,null,2)+'\n'],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;const d=new Date(),day=[d.getFullYear(),d.getMonth()+1,d.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
    link.download='naval-marks-'+data.language+'-'+day+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    backupMessage(t('已导出当前语言的全部标记。','All marks for this language have been exported.'));
  });
  $('import-marks').addEventListener('click',()=>$('marks-file').click());
  $('marks-file').addEventListener('change',async()=>{
    const file=$('marks-file').files[0];$('marks-file').value='';if(!file)return;
    let incoming;
    try{
      if(file.size>2*1024*1024)throw new Error('size');
      incoming=JSON.parse(await file.text());
      if(incoming?.format!=='naval-reader-marks'||incoming.version!==1||!incoming.blocks||typeof incoming.blocks!=='object'||Array.isArray(incoming.blocks))throw new Error('format');
      if(incoming.language!==data.language){backupMessage(t('请切换到备份对应的语言后导入。','Switch to the language used in this backup before importing.'));return;}
      const entries=Object.entries(incoming.blocks);
      if(entries.length>2000||entries.reduce((n,[,r])=>n+(r?.ranges?.length||0),0)>10000||entries.some(([id,r])=>!/^c\d{2}-b\d{3}(?:~[1-9]\d{0,5})?$/.test(id)||!data.chapters.some(c=>c.id===id.slice(1,3))||!validRecord(r)))throw new Error('records');
    }catch{backupMessage(t('这个文件不是有效的标记备份，已有记录保持原样。','This file is not a valid marks backup. Existing records are unchanged.'));return;}
    if(!syncMarkRecords()){backupMessage(t('已有标记暂时无法读取，未导入备份。','Existing marks could not be read. The backup was not imported.'));return;}
    undoChange=null;dismissMarks(true);
    for(const [id,record] of Object.entries(incoming.blocks)){
      if(!record.ranges.length)continue;
      const anchor=id.split('~')[0],el=$(anchor),old=Object.hasOwn(markRecords,anchor)?markRecords[anchor]:null;
      if(id!==anchor||!el||!validMarks(record,el)){archiveMark(anchor,record);continue;}
      if(old&&!validMarks(old,el))archiveMark(anchor,old);
      let ranges=old&&validMarks(old,el)?old.ranges:[];
      for(const range of record.ranges)for(const flag of [1,2])if(range.flags&flag)ranges=changeMarks(ranges,range,flag,false);
      markRecords[anchor]={text:record.text,ranges};pendingMarks[anchor]=markRecords[anchor];renderMarks(el);
    }
    const saved=persistMarks();refreshMarkList();
    backupMessage(saved?t('备份已合并，已有标记已保留。','Backup merged. Existing marks have been kept.'):t('备份已载入，但未保存；请导出备份后再刷新。','Backup loaded but not saved. Export a backup before reloading.'));
  });

  const charRect = (el,offset=0) => {
    const nodes=textNodes(el);let left=Math.max(0,offset);
    // A character at a column boundary may have two fragments. Its final
    // fragment locates the continuing text; their union can point a page back.
    for(const n of nodes){if(left<n.length){const r=document.createRange();r.setStart(n,left);r.setEnd(n,left+1);return (paged()&&[...r.getClientRects()].at(-1))||r.getBoundingClientRect();}left-=n.length;}
    return el.getClientRects()[0] || el.getBoundingClientRect();
  };
  const position = () => {
    const chapter=active();if(!chapter)return null;
    // Measure the layout on screen; a just-changed mode radio has not been applied yet.
    const laid=document.body.classList.contains('is-paged');
    const box=stage.getBoundingClientRect(), threshold=laid?box.top:76;
    for(const el of chapter.querySelectorAll('[data-prose]')){
      let accumulated=0;
      for(const n of textNodes(el)){
        if(!n.length)continue;
        const r=document.createRange();r.selectNodeContents(n);
        if(![...r.getClientRects()].some(b=>laid?b.right>box.left+1&&b.left<box.right-1:b.bottom>threshold)){accumulated+=n.length;continue;}
        let lo=0,hi=n.length-1;
        while(lo<hi){const mid=Math.floor((lo+hi)/2);r.setStart(n,mid);r.setEnd(n,mid+1);const b=r.getBoundingClientRect();const before=laid?b.right<=box.left+1:b.bottom<=threshold;if(before)lo=mid+1;else hi=mid;}
        r.setStart(n,lo);r.setEnd(n,lo+1);
        return {anchor:el.id,textOffset:accumulated+lo,offset:laid?0:r.getBoundingClientRect().top-threshold};
      }
    }
    return {anchor:chapter.querySelector('[data-prose]').id,textOffset:0,offset:0};
  };
  // The first block that starts on screen, so the other language opens on the same page.
  const switchAnchor = pos => {
    const el=pos&&$(pos.anchor);if(!el)return '#cover';
    const blocks=[...active().querySelectorAll('[data-prose]')],next=blocks[blocks.indexOf(el)+1];
    if(!pos.textOffset||!next)return '#'+el.id;
    const r=charRect(next,0),box=stage.getBoundingClientRect();
    return (paged()?r.left<box.right-1:r.top<innerHeight)?'#'+next.id:'#'+el.id;
  };
  const remember = (known=null,changed=[]) => {
    if(!current||busy)return;
    savedPosition=known||position();state.position=savedPosition;state.language=data.language;
    $('language-switch').hash=switchAnchor(savedPosition);state.chapter=current;state.hash=location.hash;save(changed);markCurrent();
  };
  const setPage = number => {
    dismissMarks(true);
    page=Math.min(pages-1,Math.max(0,number));
    active()?.style.setProperty('--page-shift',`${-page*step}px`);
    stage.scrollLeft=0;updatePager();
    // Keep off-page links out of the keyboard sequence; focusing one should
    // never scroll the clipped multi-column viewport by itself.
    if(paged()){
      const box=stage.getBoundingClientRect();
      active().querySelectorAll('a').forEach(a=>{const b=a.getBoundingClientRect();a.tabIndex=b.right>box.left&&b.left<box.right&&(!a.matches('.paragraph-note')||notes.checked)?0:-1;});
    }
  };
  const layout = pos => {
    cancelTap();
    touch=null;
    if(!current)return;
    const chapter=active();chapter.style.setProperty('--page-shift','0px');page=0;
    if(paged()){
      window.scrollTo(0,0);stage.style.setProperty('--page-width',stage.clientWidth+'px');
      step=stage.clientWidth+48;
      // Column padding can overflow into an empty trailing column. Count pages
      // through the last text fragment, including the book's closing ornament.
      const end=chapter.querySelector('.book-end span')||[...chapter.querySelectorAll('[data-prose]')].at(-1);
      const range=document.createRange();range.selectNodeContents(end);
      const right=Math.max(...[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>r.right));
      pages=Number.isFinite(right)?Math.max(1,Math.floor((right-stage.getBoundingClientRect().left-.5)/step)+1):Math.max(1,Math.ceil((chapter.scrollWidth+47)/step));
      const el=pos&&$(pos.anchor);
      const rect=el&&chapter.contains(el)?charRect(el,pos.textOffset):null;
      setPage(rect?Math.floor((rect.left-stage.getBoundingClientRect().left+1)/step):0);
    }else{
      chapter.style.removeProperty('--page-shift');chapter.querySelectorAll('a:not(.paragraph-note)').forEach(a=>a.removeAttribute('tabindex'));
      if(pos&&$(pos.anchor)&&chapter.contains($(pos.anchor))){const rect=charRect($(pos.anchor),pos.textOffset);window.scrollBy(0,rect.top-76-(pos.offset||0));}
      else window.scrollTo(0,0);
      appScrollY=scrollY;
    }
  };
  const closeNote = (returnFocus=false) => {
    const link=trigger;trigger=null;
    link?.setAttribute('aria-expanded','false');
    if(noteDialog.contains(document.activeElement))document.activeElement.blur();
    if(noteDialog.open)noteDialog.close();
    if(returnFocus)link?.focus({preventScroll:true});
    else if(document.activeElement===link)link.blur();
  };
  const placeNote = () => {
    if(!noteDialog.open||!trigger)return;
    const anchor=trigger.getBoundingClientRect(), viewport=window.visualViewport;
    const viewLeft=viewport?.offsetLeft||0, viewTop=viewport?.offsetTop||0;
    const viewWidth=viewport?.width||innerWidth, viewHeight=viewport?.height||innerHeight;
    const readingBox=stage.getBoundingClientRect();
    if(anchor.right<readingBox.left||anchor.left>readingBox.right||anchor.bottom<viewTop||anchor.top>viewTop+viewHeight){closeNote();return;}
    const edge=12, gap=14;
    const leftEdge=Math.max(viewLeft+edge,pinned()&&menu.open?menu.getBoundingClientRect().right+edge:0);
    const rightEdge=viewLeft+viewWidth-edge;
    noteDialog.style.width=Math.min(470,rightEdge-leftEdge)+'px';
    noteDialog.style.setProperty('--note-max-height',(viewHeight-edge*2)+'px');
    const naturalHeight=noteDialog.getBoundingClientRect().height;
    const below=viewTop+viewHeight-edge-anchor.bottom-gap, above=anchor.top-gap-viewTop-edge;
    const side=below>=naturalHeight||below>=above?'below':'above';
    noteDialog.dataset.side=side;
    noteDialog.style.setProperty('--note-max-height',Math.max(40,side==='below'?below:above)+'px');
    const box=noteDialog.getBoundingClientRect(), center=anchor.left+anchor.width/2;
    const left=Math.max(leftEdge,Math.min(center-box.width/2,rightEdge-box.width));
    noteDialog.style.left=left+'px';
    noteDialog.style.top=(side==='below'?anchor.bottom+gap:anchor.top-gap-box.height)+'px';
    noteDialog.style.setProperty('--note-arrow-x',Math.max(26,Math.min(box.width-26,center-left))+'px');
  };
  let noteFrame;
  const queueNotePlacement=()=>{if(noteDialog.open&&!noteFrame)noteFrame=requestAnimationFrame(()=>{noteFrame=null;placeNote();});};
  const show = (hash,restore=false,atEnd=false) => {
    cancelTap();
    touch=null;
    dismissMarks(true);
    const found=$(hash.replace(/^#/,'')), chapter=found?.closest('.chapter');
    const oldSaved=state.position;
    current=chapter?.dataset.id || '';busy=true;
    chapters.forEach(c=>c.hidden=c!==chapter);$('cover').hidden=Boolean(chapter);stage.hidden=!chapter;
    applyOptions();if(menu.open&&!pinned())menu.close();closeNote();
    if(pinned()&&!menu.open)menu.show();syncContents();
    document.title=chapter?`${data.chapters.find(c=>c.id===current).title} · ${data.title}`:data.title;
    if(chapter){
      const pos=restore&&state.chapter===current&&state.language===data.language?oldSaved:found?.matches('[data-prose]')?{anchor:found.id,textOffset:0}:null;
      layout(pos);if(atEnd&&paged())setPage(pages-1);laidOut=atEnd?null:pos;
      (found?.matches('[tabindex]')?found:chapter.querySelector('h1')).focus({preventScroll:true});
    }else{const art=document.querySelector('.cover-art[data-src]');if(art&&!art.hasAttribute('src'))art.src=art.dataset.src;window.scrollTo(0,0);$('language-switch').hash='cover';markCurrent();}
    showProgress();busy=false;remember(laidOut);laidOut=null;
    if(pinned())menu.querySelector('#panel-toc a[aria-current="page"]')?.scrollIntoView({block:'nearest'});
  };
  const navigate=(hash,restore=false,atEnd=false,replace=false)=>{remember();if(location.hash!==hash)history[replace?'replaceState':'pushState'](null,'',hash);show(hash,restore,atEnd);};
  const finishStartup=()=>{clearTimeout(startupTimer);root.classList.remove('reader-starting');};
  const startupTimer=setTimeout(finishStartup,2500);
  root.classList.add('js');$('menu-button').hidden=false;applyOptions();markCurrent();
  const reloading=performance.getEntriesByType('navigation')[0]?.type==='reload';
  show(location.hash||'#cover',reloading&&location.hash===(state.hash||'#c'+state.chapter));
  window.addEventListener('hashchange',()=>show(location.hash));
  const turn = direction => {
    cancelTap();
    if(!paged()||menuBlocking()||noteDialog.open)return;
    if(page+direction>=0&&page+direction<pages){setPage(page+direction);remember();return;}
    const i=data.chapters.findIndex(c=>c.id===current),next=data.chapters[i+direction];
    if(!next)return;
    const button=document.activeElement?.closest?.('#pager button');
    navigate('#c'+next.id,false,direction<0,true);button?.focus({preventScroll:true});
  };
  $('previous-page').addEventListener('click',()=>turn(-1));$('next-page').addEventListener('click',()=>turn(1));
  const canTapPage=(target,x,y)=>{
    if(!phoneScreen.matches||!paged()||menuBlocking()||noteDialog.open||!markToolbar.hidden||getSelection()?.toString()||(window.visualViewport?.scale||1)>1)return false;
    if(target.closest('a,button,input,select,textarea,summary,[role="button"],[contenteditable],.reader-mark'))return false;
    const box=stage.getBoundingClientRect();
    return y>=box.top&&y<=box.bottom;
  };
  const zone=x=>{const view=window.visualViewport,left=view?.offsetLeft||0,width=view?.width||innerWidth;return x<left+width/3?-1:x>left+width*2/3?1:0;};
  // Wait briefly so a second tap or long press can keep native text selection.
  document.addEventListener('pointerdown',e=>{
    // A quick second tap in the same zone keeps paging; elsewhere it may start a selection.
    let secondTap=Boolean(tapTimer);
    if(secondTap&&tap?.direction&&e.isPrimary&&zone(e.clientX)===tap.direction){turn(tap.direction);secondTap=false;}
    cancelTap();
    if(secondTap||!e.isPrimary||!['touch','pen'].includes(e.pointerType)||!canTapPage(e.target,e.clientX,e.clientY))return;
    tap={id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now(),chapter:current,page,target:e.target};
  },true);
  document.addEventListener('pointermove',e=>{
    if(tap&&(e.pointerId!==tap.id||Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>10))cancelTap();
  },{capture:true,passive:true});
  document.addEventListener('pointerup',e=>{
    const point=tap;tap=null;
    if(!point||e.pointerId!==point.id||Date.now()-point.time>250||Math.hypot(e.clientX-point.x,e.clientY-point.y)>10||!canTapPage(point.target,e.clientX,e.clientY))return;
    const direction=zone(e.clientX);
    if(!direction)return;
    tap={...point,direction};
    tapTimer=setTimeout(()=>{
      tapTimer=0;
      if(current===point.chapter&&page===point.page&&point.target.isConnected&&canTapPage(point.target,point.x,point.y))turn(direction);
    },240);
  },true);
  document.addEventListener('pointercancel',cancelTap,true);
  document.addEventListener('contextmenu',cancelTap,true);
  const closeContents=()=>{
    const pos=position();if(pinned()){state.tocPinned=false;save(['tocPinned']);}
    menu.close();syncContents();layout(pos);remember(pos);$('menu-button').focus({preventScroll:true});
  };
  const openMenu=()=>{
    cancelTap();
    touch=null;
    if(menu.open){closeContents();return;}
    dismissMarks(true);remember();closeNote();menu.showModal();syncContents();
    menu.querySelector('.close-button').focus({preventScroll:true});
    menu.querySelector('#panel-toc a[aria-current="page"]')?.scrollIntoView({block:'nearest'});
  };
  $('menu-button').addEventListener('click',openMenu);
  $('settings-shortcut').addEventListener('click',()=>{
    $('settings-panel').open=true;
    $('settings-panel').scrollIntoView({block:'start'});$('settings-panel').querySelector('summary').focus({preventScroll:true});
  });
  pinContents.addEventListener('click',()=>{
    const pos=position(),scroll=menu.querySelector('.drawer-body').scrollTop;
    menu.close();state.tocPinned=!pinned();save(['tocPinned']);syncContents();
    // Finish the closed layout before moving the dialog between display layers.
    if(!pinned())menu.getBoundingClientRect();
    if(pinned())menu.show();else menu.showModal();syncContents();
    menu.querySelector('.drawer-body').scrollTop=scroll;
    busy=true;layout(pos);busy=false;remember(pos);pinContents.focus({preventScroll:true});
  });
  menu.addEventListener('close',()=>{syncContents();if(!menu.open&&(document.activeElement===document.body||menu.contains(document.activeElement)))$('menu-button').focus({preventScroll:true});});
  wideScreen.addEventListener('change',()=>{
    const pos=savedPosition||position(),wasPinned=document.body.classList.contains('has-pinned-contents');
    const wasOpen=menu.open,scroll=menu.querySelector('.drawer-body').scrollTop;
    if(wasOpen)menu.close();syncContents();if(!pinned())menu.getBoundingClientRect();
    if(pinned())menu.show();else if(wasOpen&&!wasPinned)menu.showModal();
    syncContents();menu.querySelector('.drawer-body').scrollTop=scroll;
    busy=true;layout(pos);busy=false;remember(pos);
    if(pinned())menu.querySelector('#panel-toc a[aria-current="page"]')?.scrollIntoView({block:'nearest'});
  });
  $('settings-panel').addEventListener('toggle',()=>requestAnimationFrame(()=>{if($('settings-panel').open&&menu.open){const body=menu.querySelector('.drawer-body'),b=body.getBoundingClientRect(),p=$('settings-panel').getBoundingClientRect();if(p.bottom>b.bottom)body.scrollTop+=p.bottom-b.bottom+20;}}));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',e=>{const dialog=b.closest('dialog');if(dialog===menu)closeContents();else closeNote(e.detail===0);}));
  menu.addEventListener('click',e=>{if(pinned())return;const b=menu.getBoundingClientRect();if(e.target===menu&&(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom))closeContents();});
  noteDialog.addEventListener('close',()=>{if(!noteDialog.open){trigger?.setAttribute('aria-expanded','false');trigger=null;}});
  document.addEventListener('pointerdown',e=>{if(noteDialog.open&&!noteDialog.contains(e.target)&&!e.target.closest('.paragraph-note'))closeNote();},true);
  document.addEventListener('focusin',e=>{if(noteDialog.open&&!noteDialog.contains(e.target)&&e.target!==trigger)closeNote();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&noteDialog.open){e.preventDefault();e.stopPropagation();closeNote(true);}},true);
  const openNote=(link,keyboard)=>{
    cancelTap();
    touch=null;
    dismissMarks(true);
    const note=$(link.dataset.note);if(!note)return;
    if(noteDialog.open&&trigger===link){closeNote(keyboard);return;}
    trigger?.setAttribute('aria-expanded','false');
    trigger=link;$('note-dialog-title').textContent=note.dataset.title;$('note-dialog-kind').textContent=t('批注','Note')+' · '+link.textContent;
    link.setAttribute('aria-expanded','true');
    $('note-dialog-content').replaceChildren(note.querySelector('.note-copy').cloneNode(true));
    noteDialog.style.visibility='hidden';
    if(!noteDialog.open)noteDialog.show();
    noteDialog.querySelector('.note-scroll').scrollTop=0;placeNote();noteDialog.style.visibility='';
    if(keyboard)noteDialog.querySelector('.close-button').focus({preventScroll:true});
    else if(noteDialog.contains(document.activeElement)||document.activeElement===link)document.activeElement.blur();
  };
  document.addEventListener('click',e=>{
    const link=e.target.closest('a[href^="#"]');if(!link||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    if(link.matches('.paragraph-note')){e.preventDefault();openNote(link,e.detail===0);return;}
    if(link.hash==='#reading'){e.preventDefault();(active()?.querySelector('h1')||$('reading')).focus({preventScroll:true});return;}
    if($(link.hash.slice(1))){
      e.preventDefault();navigate(link.hash,link.id==='reading-entry');
      if(link.dataset.offset){const pos={anchor:link.hash.slice(1),textOffset:Number(link.dataset.offset)};layout(pos);remember(pos);}
    }
  });
  for(const control of [font,family,weight,mode,night,notes])control.addEventListener('input',()=>{
    // Re-measuring after each step of a slider drag walks the anchor backwards.
    const pos=savedPosition||position();busy=true;
    Object.assign(state,{font:Number(font.value),family:family.value,weight:weight.value,mode:mode.value,night:night.checked,notes:notes.checked});
    state.typefaces[data.language]={family:family.value,weight:weight.value};
    const changed=control===family||control===weight?['family','weight']:[control===font?'font':control===mode?'mode':control===night?'night':'notes'];
    applyOptions();layout(pos);busy=false;if(current)remember(pos,changed);else save(changed);
  });
  const search=$('search'),results=$('search-results');
  const runSearch=()=>{
    const q=search.value.trim();results.replaceChildren();$('panel-toc').hidden=Boolean(q);results.hidden=!q;
    if(!q){$('search-count').textContent='';return;}
    // Curly and straight quotes match each other; the 1:1 mapping keeps excerpt offsets valid.
    const fold=x=>x.toLocaleLowerCase().replace(/[‘’]/g,"'").replace(/[“”]/g,'"'),needle=fold(q);
    const matches=data.search.filter(i=>fold(i.text).includes(needle));let lastTitle='';
    $('search-count').textContent=matches.length?`${matches.length}${t(' 处',' matches')}${matches.length>40?t('，显示前 40 处','; showing the first 40'):''}`:t('没有找到相同词句','No matching words or phrases');
    for(const item of matches.slice(0,40)){
      if(item.title!==lastTitle){const title=document.createElement('p');title.className='search-chapter';title.textContent=lastTitle=item.title;results.append(title);}
      const a=document.createElement('a');a.className='search-result';a.href='#'+item.anchor;
      const excerpt=document.createElement('span'),index=fold(item.text).indexOf(needle),start=Math.max(0,index-24),end=Math.min(item.text.length,index+q.length+55);
      excerpt.append((start?'…':'')+item.text.slice(start,index));const mark=document.createElement('mark');mark.textContent=item.text.slice(index,index+q.length);excerpt.append(mark,item.text.slice(index+q.length,end)+(end<item.text.length?'…':''));
      a.dataset.offset=index;a.append(excerpt);results.append(a);
    }
  };
  search.addEventListener('input',e=>{if(!e.isComposing)runSearch();});search.addEventListener('compositionend',runSearch);
  document.querySelector('.search-form').addEventListener('submit',e=>{e.preventDefault();runSearch();});
  window.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!menu.open)openMenu();$('search-panel').open=true;search.focus();return;}
    if((e.shiftKey&&e.key!==' ')||getSelection()?.toString()||!markToolbar.hidden||e.ctrlKey||e.metaKey||e.altKey||menuBlocking()||noteDialog.open||e.target.closest('#contents,input,select,textarea,summary,[contenteditable]'))return;
    if(!current){if(e.key==='ArrowRight'&&(!e.target.closest('a,button')||e.target===$('reading-entry'))){e.preventDefault();navigate($('reading-entry').hash,true);}return;}
    if(!paged())return;
    if(e.key===' '&&e.target.closest('button,a'))return;
    if(e.key==='Home'||e.key==='End'){e.preventDefault();setPage(e.key==='Home'?0:pages-1);remember();return;}
    if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();turn(e.key===' '&&e.shiftKey?-1:1);}
    if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();turn(-1);}
  });
  stage.addEventListener('touchstart',e=>{
    touch=paged()&&e.touches.length===1&&!e.target.closest('a,button')&&!menuBlocking()&&!noteDialog.open&&!getSelection()?.toString()?{x:e.touches[0].clientX,y:e.touches[0].clientY,time:Date.now()}:null;
  },{passive:true});
  stage.addEventListener('touchmove',e=>{
    if(!touch)return;
    if(e.touches.length!==1||getSelection()?.toString()){touch=null;return;}
    const dx=e.touches[0].clientX-touch.x,dy=e.touches[0].clientY-touch.y;
    if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx))touch=null;
  },{passive:true});
  stage.addEventListener('touchend',e=>{
    if(!touch||!paged())return;
    const p=e.changedTouches[0],dx=p.clientX-touch.x,dy=p.clientY-touch.y,elapsed=Date.now()-touch.time;
    touch=null;
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.6&&elapsed<700&&!getSelection()?.toString())turn(dx<0?1:-1);
  },{passive:true});
  stage.addEventListener('touchcancel',()=>{touch=null;},{passive:true});
  const queueLayout=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const pos=savedPosition;busy=true;layout(pos);busy=false;remember(pos);placeNote();if(pinned()&&menu.open)menu.querySelector('#panel-toc a[aria-current="page"]')?.scrollIntoView({block:'nearest'});},150);};
  window.addEventListener('resize',()=>{dismissMarks();queueNotePlacement();queueLayout();});
  // Dynamic browser bars can resize the reading columns without a window resize.
  let stageWidth=stage.clientWidth,stageHeight=stage.clientHeight;
  if(window.ResizeObserver)new ResizeObserver(()=>{
    const width=stage.clientWidth,height=stage.clientHeight;
    if(width===stageWidth&&height===stageHeight)return;
    stageWidth=width;stageHeight=height;if(current)queueLayout();
  }).observe(stage);
  const fontLayout=()=>{if(current){const pos=savedPosition;layout(pos);remember(pos);placeNote();}};
  if(document.fonts)document.fonts.ready.then(()=>{fontLayout();finishStartup();},finishStartup);else finishStartup();
  window.addEventListener('beforeprint',()=>{const art=document.querySelector('.cover-art[data-src]');if(art&&!art.hasAttribute('src'))art.src=art.dataset.src;});
  document.fonts?.addEventListener('loadingdone',fontLayout);
  window.addEventListener('scroll',()=>{dismissMarks();queueNotePlacement();if(!paged()){showProgress();clearTimeout(timer);if(Math.abs(scrollY-appScrollY)<1)return;appScrollY=-1;timer=setTimeout(remember,200);}},{passive:true});
  window.visualViewport?.addEventListener('resize',()=>{dismissMarks();queueNotePlacement();});
  window.visualViewport?.addEventListener('scroll',()=>{dismissMarks();queueNotePlacement();});
  window.addEventListener('pagehide',()=>{cancelTap();touch=null;remember();});document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelTap();touch=null;remember();}});
})();
