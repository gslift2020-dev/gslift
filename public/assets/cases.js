/* 설치사례 전체 목록 페이지
   - 번호 페이지(처음·이전·1 2 3 … ·다음·마지막): 20개씩, 주소에 ?page= 로 남아 뒤로가기·공유가 됨
   - 상황별로 찾기: 꼬리표(외부 설치, 셔터, 철망 승강로 …)를 여러 개 고르면 모두 맞는 사례만
   - 꼬리표 목록·개수는 서버(/api/cases?facet=1)가 줌 → 꼬리표를 바꿀 때 이 파일은 안 고쳐도 됨 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var CATS = window.GS_CATS || {};
  var PAGE = 20; // 한 줄 2·4·5칸 어느 화면에서도 마지막 줄이 꽉 차게
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 방문 통계 신호는 track.js 가 보냄

  /* 메뉴·맨 위로 */
  var nav = $('#nav'), menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', function () { var o = nav.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', o); });
  var toTop = $('#toTop');
  window.addEventListener('scroll', function () { toTop.classList.toggle('show', window.scrollY > 600); }, { passive: true });
  toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });

  var grid = $('#clGrid'), pager = $('#clPager'), loadingEl = $('#clLoading'), empty = $('#clEmpty');
  var tagBox = $('#clTags'), tagGroupsEl = $('#clTagGroups'), tagSel = $('#clTagSel'), tagToggle = $('#clTagToggle');
  var st = {}, groups = [], tagName = {}, req = 0;

  function readUrl() {
    var p = new URLSearchParams(location.search);
    st.cat = CATS[p.get('cat')] ? p.get('cat') : 'all';
    st.q = (p.get('q') || '').slice(0, 40);
    st.tags = (p.get('tag') || '').split(',').filter(function (t) { return /^[a-z]{2,12}$/.test(t); }).slice(0, 6);
    st.page = Math.max(parseInt(p.get('page'), 10) || 1, 1);
    $('#clQ').value = st.q;
  }
  function urlOf() {
    var p = [];
    if (st.cat !== 'all') p.push('cat=' + st.cat);
    if (st.tags.length) p.push('tag=' + st.tags.join(','));
    if (st.q) p.push('q=' + encodeURIComponent(st.q));
    if (st.page > 1) p.push('page=' + st.page);
    return location.pathname + (p.length ? '?' + p.join('&') : '');
  }
  // push: 뒤로가기로 돌아올 수 있게 기록 (페이지 이동·꼬리표), 검색어 입력은 기록을 덮어씀
  function go(push) {
    var u = urlOf();
    if (u !== location.pathname + location.search) history[push ? 'pushState' : 'replaceState'](null, '', u);
    load();
  }

  function card(c) {
    var a = document.createElement('a'); a.className = 'cl-card'; a.href = '/case.html?id=' + c.id;
    var ph = document.createElement('div'); ph.className = 'ph';
    var im = document.createElement('img'); im.src = c.cover; im.alt = c.title; im.loading = 'lazy'; im.width = 900; im.height = 1200;
    ph.appendChild(im);
    if (c.count > 1) { var n = document.createElement('span'); n.className = 'cnt'; n.textContent = '사진 ' + c.count; ph.appendChild(n); }
    var b = document.createElement('b'); b.textContent = c.title;
    var sm = document.createElement('small'); sm.textContent = [c.site || CATS[c.cat], c.date].filter(Boolean).join(' · ');
    a.appendChild(ph); a.appendChild(b); a.appendChild(sm);
    // 고른 꼬리표가 있으면 카드에도 표시 (왜 이 사례가 나왔는지 보이게)
    var hit = (c.tags || []).filter(function (t) { return st.tags.indexOf(t) >= 0; });
    if (hit.length) {
      var tg = document.createElement('span'); tg.className = 'cl-card-tags';
      hit.forEach(function (t) { var i = document.createElement('i'); i.textContent = tagName[t] || t; tg.appendChild(i); });
      a.appendChild(tg);
    }
    return a;
  }

  var lastCounts = null;
  function drawTabs(counts) {
    counts = lastCounts = counts || lastCounts;
    $$('#clTabs button').forEach(function (t) {
      var on = t.dataset.cat === st.cat;
      t.classList.toggle('on', on); t.setAttribute('aria-selected', on);
      $('i', t).textContent = counts && counts[t.dataset.cat] != null ? counts[t.dataset.cat] : '';
    });
    if (counts && counts.all) $('#clTotal').textContent = '지금까지 ' + counts.all + '건의 사례를 올렸습니다.';
  }

  /* 상황별로 찾기 */
  function drawTags(tagCounts) {
    tagCounts = tagCounts || {};
    tagGroupsEl.innerHTML = '';
    groups.forEach(function (g) {
      // 지금 조건에서 1건 이상 있거나 이미 고른 꼬리표만 보여 줌
      var items = g.tags.filter(function (t) { return tagCounts[t.k] || st.tags.indexOf(t.k) >= 0; });
      if (!items.length) return;
      var row = document.createElement('div'); row.className = 'tg-row';
      var nm = document.createElement('span'); nm.className = 'tg-name'; nm.textContent = g.name; row.appendChild(nm);
      var list = document.createElement('div'); list.className = 'tg-list';
      items.forEach(function (t) {
        var on = st.tags.indexOf(t.k) >= 0;
        var b = document.createElement('button'); b.type = 'button'; b.className = 'tg' + (on ? ' on' : '');
        b.setAttribute('aria-pressed', on); b.dataset.k = t.k;
        b.textContent = t.n;
        var i = document.createElement('i'); i.textContent = tagCounts[t.k] || 0; b.appendChild(i);
        list.appendChild(b);
      });
      row.appendChild(list); tagGroupsEl.appendChild(row);
    });
    tagBox.hidden = !tagGroupsEl.children.length && !st.tags.length;
    // 고른 꼬리표 요약 + 모두 지우기
    tagSel.innerHTML = '';
    if (st.tags.length) {
      st.tags.forEach(function (k) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'tg-x'; b.dataset.k = k;
        b.setAttribute('aria-label', (tagName[k] || k) + ' 조건 빼기');
        b.textContent = (tagName[k] || k) + ' ✕'; tagSel.appendChild(b);
      });
      var clr = document.createElement('button'); clr.type = 'button'; clr.className = 'tg-clear'; clr.textContent = '조건 모두 지우기';
      tagSel.appendChild(clr);
    }
    $('#clTagCount').textContent = st.tags.length ? st.tags.length + '개 선택' : '';
  }
  function toggleTag(k) {
    var i = st.tags.indexOf(k);
    if (i >= 0) st.tags.splice(i, 1); else if (st.tags.length < 6) st.tags.push(k);
    st.page = 1; go(true);
  }
  tagGroupsEl.addEventListener('click', function (e) { var b = e.target.closest('.tg'); if (b) toggleTag(b.dataset.k); });
  tagSel.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('tg-clear')) { st.tags = []; st.page = 1; go(true); } else toggleTag(b.dataset.k);
  });
  // 휴대폰: 처음엔 접어 두고 버튼으로 펼침 (고른 조건이 있으면 펼친 채로)
  function setOpen(o) { tagBox.classList.toggle('open', o); tagToggle.setAttribute('aria-expanded', o); }
  tagToggle.addEventListener('click', function () { setOpen(!tagBox.classList.contains('open')); });

  /* 번호 페이지 */
  function pageList(cur, last) {
    // 1 … 4 5 [6] 7 8 … 20 처럼: 처음·끝과 현재 앞뒤 2개
    var out = [], w = window.innerWidth < 560 ? 1 : 2;
    for (var p = 1; p <= last; p++) {
      if (p === 1 || p === last || Math.abs(p - cur) <= w) out.push(p);
      else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
  }
  function pbtn(label, page, opts) {
    opts = opts || {};
    var b = document.createElement(opts.disabled || opts.cur ? 'span' : 'a');
    b.className = 'pg' + (opts.cur ? ' cur' : '') + (opts.disabled ? ' off' : '') + (opts.cls ? ' ' + opts.cls : '');
    b.innerHTML = label;
    if (opts.aria) b.setAttribute('aria-label', opts.aria);
    if (opts.cur) b.setAttribute('aria-current', 'page');
    if (!opts.disabled && !opts.cur) {
      var keep = st.page; st.page = page; b.href = urlOf(); st.page = keep;
      b.dataset.page = page;
    }
    return b;
  }
  var L2 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>';
  var L1 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var R1 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  var R2 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>';
  function drawPager(total) {
    pager.innerHTML = '';
    var last = Math.max(Math.ceil(total / PAGE), 1);
    if (last <= 1) { pager.hidden = true; return; }
    pager.hidden = false;
    var cur = Math.min(st.page, last);
    pager.appendChild(pbtn(L2 + '<span class="pg-t">처음</span>', 1, { disabled: cur === 1, aria: '처음 페이지', cls: 'ends' }));
    pager.appendChild(pbtn(L1, cur - 1, { disabled: cur === 1, aria: '이전 페이지', cls: 'step' }));
    pageList(cur, last).forEach(function (p) {
      if (p === '…') { var d = document.createElement('span'); d.className = 'pg gap'; d.textContent = '…'; d.setAttribute('aria-hidden', 'true'); pager.appendChild(d); }
      else pager.appendChild(pbtn(String(p), p, { cur: p === cur, aria: p + '페이지' }));
    });
    pager.appendChild(pbtn(R1, cur + 1, { disabled: cur === last, aria: '다음 페이지', cls: 'step' }));
    pager.appendChild(pbtn('<span class="pg-t">마지막</span>' + R2, last, { disabled: cur === last, aria: '마지막 페이지 (' + last + ')', cls: 'ends' }));
    // 원하는 쪽으로 바로 가기 (페이지가 많을 때)
    if (last > 7) {
      var f = document.createElement('form'); f.className = 'pg-jump';
      f.innerHTML = '<label><span class="sr">이동할 페이지</span><input type="number" inputmode="numeric" min="1" max="' + last + '" placeholder="' + cur + '"></label><span>/ ' + last + '</span><button type="submit">이동</button>';
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = parseInt($('input', f).value, 10);
        if (v >= 1 && v <= last && v !== st.page) { st.page = v; go(true); scrollToList(); }
      });
      pager.appendChild(f);
    }
    $('#clPageInfo').textContent = total + '건 중 ' + ((cur - 1) * PAGE + 1) + '–' + Math.min(cur * PAGE, total) + '번째';
  }
  pager.addEventListener('click', function (e) {
    var a = e.target.closest('a.pg'); if (!a) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return; // 새 탭으로 열기는 그대로
    e.preventDefault();
    st.page = Number(a.dataset.page); go(true); scrollToList();
  });
  function scrollToList() {
    var y = $('.cl-bar').getBoundingClientRect().top + window.scrollY - 90;
    if (window.scrollY > y) window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }

  function load() {
    var my = ++req;
    loadingEl.hidden = false; empty.hidden = true; grid.classList.add('busy');
    drawTabs(null);
    var url = '/api/cases?facet=1&limit=' + PAGE + '&offset=' + (st.page - 1) * PAGE +
      (st.cat !== 'all' ? '&cat=' + st.cat : '') + (st.tags.length ? '&tag=' + st.tags.join(',') : '') + (st.q ? '&q=' + encodeURIComponent(st.q) : '');
    fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      if (my !== req) return; // 더 최근 요청이 있으면 무시
      loadingEl.hidden = true; grid.classList.remove('busy');
      if (!d || !d.ok) { grid.innerHTML = ''; pager.hidden = true; empty.textContent = '목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'; empty.hidden = false; return; }
      // 없는 페이지(예: 꼬리표를 바꿔 건수가 줄어든 뒤 뒤로가기)면 마지막 페이지로
      var last = Math.max(Math.ceil(d.total / PAGE), 1);
      if (st.page > last) { st.page = last; history.replaceState(null, '', urlOf()); return load(); }
      if (d.tagGroups && !groups.length) {
        groups = d.tagGroups;
        groups.forEach(function (g) { g.tags.forEach(function (t) { tagName[t.k] = t.n; }); });
      }
      drawTabs(d.counts); drawTags(d.tagCounts);
      grid.innerHTML = '';
      d.items.forEach(function (c) { grid.appendChild(card(c)); });
      drawPager(d.total);
      if (!d.items.length) {
        empty.textContent = st.tags.length ? '고른 조건에 모두 맞는 사례가 없습니다. 조건을 하나씩 빼 보세요.'
          : st.q ? '"' + st.q + '"에 맞는 사례가 없습니다. 다른 말로 찾아보세요.'
          : '이 분류의 설치사례를 준비 중입니다. 문의 주시면 사례 사진을 보내드립니다.';
        empty.hidden = false;
        $('#clPageInfo').textContent = '';
      } else if (d.total <= PAGE) $('#clPageInfo').textContent = d.total + '건';
    });
  }

  $$('#clTabs button').forEach(function (t) {
    t.addEventListener('click', function () { if (st.cat === t.dataset.cat) return; st.cat = t.dataset.cat; st.page = 1; go(true); });
  });
  var qt;
  $('#clQ').addEventListener('input', function () {
    var v = this.value.trim().slice(0, 40);
    clearTimeout(qt); qt = setTimeout(function () { if (v === st.q) return; st.q = v; st.page = 1; go(false); }, 300);
  });
  window.addEventListener('popstate', function () { readUrl(); load(); });

  readUrl();
  setOpen(st.tags.length > 0 || window.innerWidth >= 760);
  load();
})();
