/*
 * LINK CHECK's page. All rendering is createElement + textContent: link text
 * never goes through innerHTML, and no link from the visitor is ever turned
 * into an <a> or an href. Class names are whole literals (see the note in
 * index.html) — level-dependent classes come from the maps below, never from
 * a fragment built at runtime.
 */
(function () {
  'use strict';

  var api = window.LinkCheck || (typeof require !== 'undefined' ? require('./check.js') : null);

  /* ── Whole-literal class maps. ── */
  var VERDICT_CLASS = {
    warning: 'verdict verdict-warning',
    caution: 'verdict verdict-caution',
    clear: 'verdict verdict-clear',
  };
  var LEVEL_TEXT = { warning: 'text-warning', caution: 'text-caution', clear: 'text-clear' };
  var SEG_CLASS = {
    domain: 'seg seg-domain',
    warning: 'seg seg-warning',
    caution: 'seg seg-caution',
    plain: 'seg',
  };

  /* Built-in shape icons, one per level: circle-tick, triangle, octagon. */
  var ICONS = {
    clear:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="m8 12.3 2.7 2.7L16 9.5"/></svg>',
    caution:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.1 2.2 18.2a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4.5"/><path d="M12 17.2h.01"/></svg>',
    warning:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9z"/><path d="M12 7.8v5"/><path d="M12 16.2h.01"/></svg>',
  };

  /* ── Tiny DOM helpers. ── */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function byId(id) { return document.getElementById(id); }
  function show(node) { node.hidden = false; }
  function hide(node) { node.hidden = true; }

  var $input = byId('link-input');
  var $form = byId('link-form');
  var $inputError = byId('input-error');
  var $empty = byId('empty-state');
  var $result = byId('result');
  var $verdict = byId('verdict');
  var $verdictIcon = byId('verdict-icon');
  var $verdictTitle = byId('verdict-title');
  var $verdictSummary = byId('verdict-summary');
  var $dest = byId('dest');
  var $xray = byId('xray');
  var $parts = byId('parts');
  var $findings = byId('findings');
  var $copyBtn = byId('copy-btn');
  var $copyNote = byId('copy-note');
  var $copyLinkBtn = byId('copy-link-btn');
  var $copyLinkNote = byId('copy-link-note');
  var $clearBtn = byId('clear-btn');
  var $demoBanner = byId('demo-banner');
  var $demoSection = byId('demo');
  var $demoList = byId('demo-list');
  var $demoCopyNote = byId('demo-copy-note');

  var currentResult = null;

  /* Clear sits beside Check once there is something to clear: text or a result. */
  function updateClear() {
    $clearBtn.hidden = !$input.value && !currentResult;
  }

  /* ── The input's error lines, one per analyse() failure. ── */
  var ERROR_TEXT = {
    empty: 'Paste a link first.',
    'not-a-link': 'That doesn’t look like a link. Paste a full address, for example https://example.com/sale',
  };
  function unsupportedText(scheme) {
    return '“' + scheme + ':” links aren’t checked here. Paste a web address (http or https).';
  }

  function setInputError(message) {
    $inputError.textContent = message;
    show($inputError);
    $input.setAttribute('aria-invalid', 'true');
  }
  function clearInputError() {
    hide($inputError);
    $inputError.textContent = '';
    $input.removeAttribute('aria-invalid');
  }

  /* ── Checking. ── */
  function runCheck(raw) {
    var res = api.analyze(raw);
    if (!res.ok) {
      setInputError(res.error === 'unsupported' ? unsupportedText(res.scheme) : ERROR_TEXT[res.error]);
      // The old answer comes down: the screen shows the field, the error and
      // the explainer, never a result it is no longer about.
      currentResult = null;
      hide($result);
      show($empty);
      updateClear();
      $input.focus();
      return;
    }
    clearInputError();
    currentResult = res;
    render(res);
  }

  /* ── Rendering. ── */
  function levelIcon(level, size) {
    var holder = el('span', LEVEL_TEXT[level] || '');
    holder.innerHTML = ICONS[level] || ICONS.clear; // built-in markup only, never link text
    if (size && holder.firstChild) {
      holder.firstChild.removeAttribute('width');
      holder.firstChild.removeAttribute('height');
      holder.firstChild.style.width = size + 'px';
      holder.firstChild.style.height = size + 'px';
      holder.classList.add('shrink-0');
    }
    return holder;
  }

  function render(res) {
    hide($empty);
    show($result);

    // The verdict banner.
    $verdict.className = VERDICT_CLASS[res.verdict.level];
    $verdict.setAttribute('data-verdict', res.verdict.level);
    $verdictIcon.replaceChildren(levelIcon(res.verdict.level));
    $verdictTitle.textContent = res.verdict.title;
    $verdictSummary.textContent = res.verdict.summary;

    // Where it really goes: the real site, large. For a not-web link there
    // is no site; the finding says so instead.
    $dest.textContent = res.realSiteDisplay || res.displayHost || 'No website';
    $dest.className = res.realSiteDisplay || res.displayHost
      ? 'font-mono text-heading text-accent'
      : 'font-mono text-heading text-muted';

    renderXray(res);
    renderParts(res);
    renderFindings(res);
    hide($copyNote);
    hide($copyLinkNote);
    updateClear();

    // Announce and move attention to the answer.
    $verdict.focus();
  }

  /* The link x-ray: each labelled part of the link, drawn as written, the
     flagged parts underlined in their level colour and the real site in the
     accent. */
  function renderXray(res) {
    $xray.replaceChildren();
    res.parts.forEach(function (part) {
      var group = el('span', 'inline-flex max-w-full flex-col align-top');
      var label = el('span', 'text-small ' + (part.level && LEVEL_TEXT[part.level] ? LEVEL_TEXT[part.level] : 'text-muted'), part.label);
      var value = el('span', SEG_CLASS[part.key] || SEG_CLASS.plain, part.value);
      if (part.key === 'domain') label.className = 'text-small text-accent font-medium';
      group.append(label, value);
      $xray.append(group);
    });
    // Breathing room between the labelled parts, whatever wraps.
    $xray.classList.add('flex', 'flex-wrap', 'gap-x-3', 'gap-y-3');
  }

  /* The link's parts, one row each: name, what it says, what it means.
     A part a warning is about takes that warning's colour, dot and shape;
     the domain, when nothing points at it, keeps the accent it wears in the
     x-ray above — one colour per part. */
  var DOT_CLASS = { warning: 'bg-warning', caution: 'bg-caution', clear: 'bg-clear' };

  function partNameClass(part) {
    // Whole literals, for the extractor:
    if (part.level === 'warning') return 'w-22 shrink-0 text-small font-medium text-warning';
    if (part.level === 'caution') return 'w-22 shrink-0 text-small font-medium text-caution';
    if (part.level === 'clear') return 'w-22 shrink-0 text-small font-medium text-clear';
    if (part.key === 'domain') return 'w-22 shrink-0 text-small font-medium text-accent';
    return 'w-22 shrink-0 text-small font-medium text-muted';
  }

  function renderParts(res) {
    $parts.replaceChildren();
    res.parts.forEach(function (part) {
      var row = el('li', 'list-row items-start');

      var name = el('span', partNameClass(part) + (part.level ? ' flex items-center gap-1' : ''));
      if (part.level) name.append(levelIcon(part.level, 14));
      name.append(document.createTextNode(part.label));

      var body = el('span', 'flex min-w-0 flex-1 flex-col gap-0.5');
      var value = el('span', 'font-mono text-small text-fg');
      value.style.overflowWrap = 'anywhere';
      // A coloured dot on the real domain and on any flagged part.
      if (part.key === 'domain' || part.level) {
        var dot = el('span', 'mr-1.5 inline-block h-2 w-2 rounded-full align-middle ' +
          (part.level ? DOT_CLASS[part.level] : 'bg-accent'));
        value.append(dot, document.createTextNode(part.value));
      } else {
        value.textContent = part.value;
      }
      var note = el('span', 'text-small text-muted', part.note);
      body.append(value, note);

      row.append(name, body);
      $parts.append(row);
    });
  }

  /* What we found: one row per finding, or a single clear row. */
  function renderFindings(res) {
    $findings.replaceChildren();
    if (!res.findings.length) {
      var ok = el('li', 'list-row items-start');
      ok.append(levelIcon('clear'));
      var okBody = el('span', 'flex flex-col gap-0.5');
      okBody.append(el('span', 'text-body font-medium', 'Nothing found'));
      okBody.append(el('span', 'text-small text-muted',
        'Nothing in how this link is written looks like a common trick.'));
      ok.append(okBody);
      $findings.append(ok);
      return;
    }
    res.findings.forEach(function (finding) {
      var row = el('li', 'list-row items-start');
      row.append(levelIcon(finding.level));
      var body = el('span', 'flex min-w-0 flex-1 flex-col gap-0.5');
      body.append(el('span', 'text-body font-medium', finding.title));
      body.append(el('span', 'text-small text-muted', finding.detail));
      row.append(body);
      $findings.append(row);
    });
  }

  /* ── Copy results: plain text, clipboard API first, textarea fallback. ── */
  function resultText(res) {
    var lines = [
      'LINK CHECK result',
      'Link: ' + res.input,
      'Verdict: ' + res.verdict.title + '. ' + res.verdict.summary,
      'Really goes to: ' + (res.realSiteDisplay || res.displayHost || 'No website'),
    ];
    if (res.findings.length) {
      lines.push('What we found:');
      res.findings.forEach(function (f) {
        lines.push('- ' + (f.level === 'warning' ? 'Warning' : 'Check') + ': ' + f.title + '. ' + f.detail);
      });
    } else {
      lines.push('What we found: nothing in how this link is written looks like a common trick.');
    }
    lines.push('Checked on this page only; the link was never opened.');
    return lines.join('\n');
  }

  function legacyCopy(text) {
    var box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    try {
      var done = document.execCommand('copy');
      document.body.removeChild(box);
      return done;
    } catch (err) {
      document.body.removeChild(box);
      return false;
    }
  }

  /* One copier for every button that copies: the results, the checked link,
     a demo link. Each note shows beside its own button. */
  function copyText(text, note, failMessage) {
    var done = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { showCopyNote(note, 'Copied.'); },
        function () { showCopyNote(note, legacyCopy(text) ? 'Copied.' : failMessage); }
      );
      return;
    }
    try { done = legacyCopy(text); } catch (err) { done = false; }
    showCopyNote(note, done ? 'Copied.' : failMessage);
  }

  function copyResults() {
    if (!currentResult) return;
    copyText(resultText(currentResult), $copyNote, 'Couldn’t copy. Select the results and copy yourself.');
  }

  /* The link as checked: the same text the x-ray is drawn from, never href
     (which may have https:// added) and never the field (which may have been
     edited since the check). */
  function copyLink() {
    if (!currentResult) return;
    copyText(currentResult.input, $copyLinkNote, 'Couldn’t copy. Select the link and copy it yourself.');
  }

  function showCopyNote(note, message) {
    note.textContent = message;
    show(note);
    if (note._timer) clearTimeout(note._timer);
    note._timer = setTimeout(function () { hide(note); }, 2000);
  }

  /* ── Clear: back to the start. ── */
  function clearAll() {
    currentResult = null;
    $input.value = '';
    clearInputError();
    hide($result);
    show($empty);
    updateClear();
    $input.focus();
  }

  /* ── The staging demo (?demo=1): banner, sample links, first one checked. ── */
  var demoLinks = [];
  var currentDemo = -1;

  function pageParams() {
    var params = {};
    location.search.replace(/^\?/, '').split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq > -1) params[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    });
    return params;
  }

  function demoFetch(url) {
    var params = pageParams();
    var headers = {};
    if (params.token) headers['x-usernode-token'] = params.token;
    return fetch(url, { headers: headers, credentials: 'same-origin' });
  }

  function demoRow(link, index) {
    var row = el('li', 'list-row items-stretch gap-0 p-0');
    var tap = el('button', 'flex min-h-11 min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left');
    var label = el('span', 'min-w-0 flex-1 truncate font-mono text-small text-fg', link);
    var go = el('span', 'shrink-0 text-small text-accent', 'Check');
    tap.append(label, go);
    tap.addEventListener('click', function () { checkDemo(index); });

    // Copy this one demo link, without checking it.
    var copy = el('button', 'flex min-h-11 shrink-0 items-center border-l border-line px-4 text-small text-accent', 'Copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy link');
    copy.addEventListener('click', function () {
      copyText(link, $demoCopyNote, 'Couldn’t copy. Select the link and copy it yourself.');
    });

    row.append(tap, copy);
    return row;
  }

  function markDemoRow() {
    var rows = $demoList.children;
    for (var i = 0; i < rows.length; i++) {
      var tap = rows[i].firstChild;
      if (!tap || tap.tagName !== 'BUTTON') continue;
      if (i === currentDemo) {
        tap.className = 'flex min-h-11 min-w-0 flex-1 items-center gap-2 bg-raised px-4 py-3 text-left';
        tap.setAttribute('aria-current', 'true');
      } else {
        tap.className = 'flex min-h-11 min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left';
        tap.removeAttribute('aria-current');
      }
    }
  }

  function checkDemo(index) {
    currentDemo = index;
    markDemoRow();
    // The field shows what is being checked, so Check re-checks it.
    $input.value = demoLinks[index];
    runCheck(demoLinks[index]);
    $verdict.focus();
  }

  function showDemoError() {
    $demoList.replaceChildren();
    hide($demoCopyNote);
    var row = el('li', 'state-error');
    row.append(el('p', 'text-body font-medium', 'The demo links didn’t load'));
    row.append(el('p', 'text-small text-muted',
      'The rest of the page still works: paste any link above to check it.'));
    var retry = el('button', 'btn-secondary', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', loadDemo);
    row.append(retry);
    $demoList.append(row);
  }

  function showDemoSkeleton() {
    $demoList.replaceChildren();
    hide($demoCopyNote);
    for (var i = 0; i < 4; i++) {
      var row = el('li', 'list-row');
      var bar = el('span', 'skeleton h-5 w-full');
      row.append(bar);
      $demoList.append(row);
    }
  }

  function loadDemo() {
    showDemoSkeleton();
    demoFetch('/api/demo?demo=1').then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      demoLinks = (data && data.links) || [];
      $demoList.replaceChildren();
      demoLinks.forEach(function (link, index) { $demoList.append(demoRow(link, index)); });
      show($demoBanner);
      show($demoSection);
      if (demoLinks.length) checkDemo(0);
    }).catch(function (err) {
      console.warn('demo load failed: ' + (err && err.message));
      showDemoError();
    });
  }

  /* ── Wire up. ── */
  $form.addEventListener('submit', function (event) {
    event.preventDefault();
    runCheck($input.value);
  });
  $input.addEventListener('input', function () {
    clearInputError();
    updateClear();
  });
  $copyBtn.addEventListener('click', copyResults);
  $copyLinkBtn.addEventListener('click', copyLink);
  $clearBtn.addEventListener('click', clearAll);

  if (pageParams().demo === '1') loadDemo();
})();
