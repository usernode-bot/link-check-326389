/*
 * LINK CHECK's analyser.
 *
 * Pure JavaScript: no DOM, no network, nothing sent anywhere. It reads how a
 * link is WRITTEN and reports the tricks fake links use. The page calls
 * LinkCheck.analyze(); the unit tests call the same function under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;
  var NON_WEB = { javascript: 1, vbscript: 1, data: 1, file: 1 };
  // Second-level labels that make "bbc.co.uk" one real site.
  var REAL_SITE_SECOND = { co: 1, com: 1, net: 1, org: 1, gov: 1, edu: 1, ac: 1, ne: 1, go: 1 };
  // TLD-shaped labels that mean nothing when they sit in the subdomain.
  var TLD_IN_SUB = { com: 1, net: 1, org: 1, gov: 1, edu: 1, info: 1, io: 1, co: 1, app: 1, biz: 1 };
  var RISKY_EXTS = ['exe', 'scr', 'msi', 'bat', 'cmd', 'com', 'apk', 'jar', 'vbs', 'ps1', 'dmg', 'pkg'];
  var SHORTENERS = { 'bit.ly': 1, 'tinyurl.com': 1, 't.co': 1, 'goo.gl': 1, 'ow.ly': 1, 'is.gd': 1, 'buff.ly': 1, 'cutt.ly': 1, 'rebrand.ly': 1, 'shorturl.at': 1, 'tiny.cc': 1, 'rb.gy': 1 };
  var REASSURING = ['login', 'signin', 'verify', 'secure', 'account', 'update', 'confirm', 'password', 'wallet', 'support'];
  // Zero-width and bidi characters browsers can hide in a name.
  var INVISIBLE_RE = /[​-‏‪-‮⁠-⁤﻿]/;

  var PART_LABELS = {
    scheme: 'Scheme', login: 'Login', subdomain: 'Subdomain', domain: 'Domain',
    port: 'Port', path: 'Path', query: 'Query', fragment: 'Fragment',
  };

  /* ── Punycode: a small RFC 3492 decoder, so an xn-- name shows the
   * characters it really stands for. Returns null on anything malformed. */
  function punyDecode(label) {
    var base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128;
    var n = initialN, i = 0, bias = initialBias, out = [];
    var pos = label.lastIndexOf('-') > 0 ? label.lastIndexOf('-') + 1 : 0;
    var j, ch;
    for (j = 0; j < (label.lastIndexOf('-') > 0 ? label.lastIndexOf('-') : 0); j++) out.push(label.charCodeAt(j));
    function digit(c) {
      if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 97;
      if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 65;
      if (c >= '0' && c <= '9') return c.charCodeAt(0) - 22;
      return -1;
    }
    function adapt(delta, num, first) {
      delta = first ? Math.floor(delta / damp) : Math.floor(delta / 2);
      delta += Math.floor(delta / num);
      var k = 0;
      while (delta > ((base - tMin) * tMax) / 2) { delta = Math.floor(delta / (base - tMin)); k += base; }
      return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
    }
    while (pos < label.length) {
      var oldi = i, w = 1, k, d, t;
      for (k = base; ; k += base) {
        if (pos >= label.length) return null;
        ch = label.charAt(pos++);
        d = digit(ch);
        if (d < 0) return null;
        i += d * w;
        t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
        if (d < t) break;
        w *= base - t;
      }
      bias = adapt(i - oldi, out.length + 1, oldi === 0);
      n += Math.floor(i / (out.length + 1));
      i %= out.length + 1;
      out.splice(i, 0, n);
      i++;
    }
    try {
      var s = '';
      for (j = 0; j < out.length; j++) {
        if (out[j] < 0 || out[j] > 0x10FFFF) return null;
        s += String.fromCodePoint(out[j]);
      }
      return s;
    } catch (e) { return null; }
  }

  function decodeLabels(host) {
    return host.split('.').map(function (label) {
      if (label.slice(0, 4).toLowerCase() !== 'xn--') return label;
      var dec = punyDecode(label.slice(4));
      return dec === null ? label : dec;
    }).join('.');
  }

  /* ── Scripts: which alphabets a label mixes. ── */
  var SCRIPT_TESTS = [
    { script: 'Latin', re: /\p{Script=Latin}/u },
    { script: 'Cyrillic', re: /\p{Script=Cyrillic}/u },
    { script: 'Greek', re: /\p{Script=Greek}/u },
  ];

  function normalise(raw) {
    var t = String(raw == null ? '' : raw).trim();
    // Strip one wrapping pair of <>, quotes or brackets, then trailing punctuation.
    var pairs = { '<': '>', '"': '"', "'": "'", '(': ')', '[': ']', '{': '}' };
    for (var guard = 0; guard < 4; guard++) {
      var open = t.charAt(0), close = pairs[open];
      if (close && t.charAt(t.length - 1) === close) t = t.slice(1, -1).trim();
      else break;
    }
    t = t.replace(/[.,;)\]]+$/, '');
    return t;
  }

  function isIPv4(host) {
    var m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    for (var i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
    return true;
  }

  function isIPv6(host) {
    return host.charAt(0) === '[' && host.charAt(host.length - 1) === ']';
  }

  function splitPort(hostPart) {
    if (hostPart.charAt(0) === '[') {
      var close = hostPart.indexOf(']');
      if (close === -1) return { host: hostPart, port: null };
      var after = hostPart.slice(close + 1);
      return after.charAt(0) === ':'
        ? { host: hostPart.slice(0, close + 1), port: after.slice(1) }
        : { host: hostPart, port: null };
    }
    var c = hostPart.lastIndexOf(':');
    return c > -1 ? { host: hostPart.slice(0, c), port: hostPart.slice(c + 1) } : { host: hostPart, port: null };
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  /* ── The finding rules. ── */
  function collectFindings(ctx) {
    var f = [];
    function add(id, level, title, detail, part) {
      f.push({ id: id, level: level, title: title, detail: detail, part: part || null });
    }

    // no-https — the scheme typed as http.
    if (ctx.scheme === 'http') {
      add('no-https', 'caution', 'Not encrypted',
        '"http://" is not encrypted: anyone on the way could read what you send to this site. Look for https instead.',
        'scheme');
    }

    // ip-host — a bare internet number instead of a name.
    if (ctx.isIP) {
      var ipDetail;
      if (ctx.ipDisguised) {
        ipDetail = '"' + ctx.rawHost + '" is an internet address written as one number. A real site shows its usual name.';
      } else {
        ipDetail = '"' + ctx.displayHost + '" is a bare internet address instead of a site name. Real sites have names.';
      }
      add('ip-host', 'warning', 'A number instead of a site name', ipDetail, 'domain');
    }

    // credentials — something before the "@" that browsers skip.
    if (ctx.userinfo) {
      add('credentials', 'warning', 'Hides the real address',
        '"' + ctx.userinfo + '" before the "@" is skipped by browsers. The real site is ' + ctx.realSite + '.',
        'login');
    }

    // tld-in-subdomain — another site's name parked in front.
    var badSub = null;
    for (var i = 0; i < ctx.subLabels.length; i++) {
      var label = ctx.subLabels[i].toLowerCase();
      if (TLD_IN_SUB[label]) { badSub = ctx.subLabels.slice(0, i + 1).join('.'); break; }
      if (i > 0 && label.length === 2 && REAL_SITE_SECOND[ctx.subLabels[i - 1].toLowerCase()]) {
        badSub = ctx.subLabels.slice(0, i + 1).join('.'); break;
      }
    }
    if (badSub) {
      add('tld-in-subdomain', 'warning', "Another site's name is in front",
        '"' + badSub + '" is only a subdomain here. The real site is ' + ctx.displayRealSite + '.', 'subdomain');
    }

    // mixed-script — Latin mixed with Cyrillic or Greek in one label.
    var displayLabels = ctx.displayHost.split('.');
    for (var d = 0; d < displayLabels.length; d++) {
      var present = [];
      for (var s = 0; s < SCRIPT_TESTS.length; s++) {
        if (SCRIPT_TESTS[s].re.test(displayLabels[d])) present.push(SCRIPT_TESTS[s].script);
      }
      if (present.length > 1) {
        add('mixed-script', 'warning', 'Letters from different alphabets',
          'The name "' + displayLabels[d] + '" mixes ' + present.join(' and ') + ' letters, so it can look right while pointing somewhere else.',
          'domain');
        break;
      }
    }

    // digit-letter — 0, 1, 3 or 5 standing in for letters in the real site.
    var realLabels = ctx.displayRealSite.split('.');
    for (var r = 0; r < realLabels.length; r++) {
      var m = realLabels[r].match(/[a-z][0135][a-z]/i);
      if (m) {
        add('digit-letter', 'caution', 'Numbers that look like letters',
          'The name "' + realLabels[r] + '" uses the digit "' + m[0].charAt(1) + '" where a letter would go, a common lookalike trick.',
          'domain');
        break;
      }
    }

    // risky-file — the path hands you a program.
    var path = ctx.url ? ctx.url.pathname : '';
    var ext = path.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    if (ext && RISKY_EXTS.indexOf(ext[1]) !== -1) {
      var file = path.split('/').pop();
      var dbl = file.toLowerCase().match(/\.[a-z0-9]{1,5}\.(exe|scr|msi|bat|cmd|com|apk|jar|vbs|ps1|dmg|pkg)$/);
      add('risky-file', 'warning', 'Downloads a program',
        dbl
          ? '"' + file + '" ends in ".' + ext[1] + '" behind another ending, a double ending used to hide a program.'
          : '"' + file + '" is a program file. Opening it runs whatever it carries.',
        'path');
    }

    // shortener — the real site is a short-link service.
    if (SHORTENERS[ctx.realSite]) {
      add('shortener', 'caution', 'Short link hides where it goes',
        '"' + ctx.realSite + '" is a short-link service: the address you see is not the address you land on.',
        'domain');
    }

    // redirect — a query value is itself a link.
    if (ctx.url && ctx.url.search) {
      var q = ctx.url.searchParams;
      q.forEach(function (value) {
        if (f.some(function (x) { return x.id === 'redirect'; })) return;
        var v = value;
        try { v = decodeURIComponent(value); } catch (e) { /* keep raw */ }
        var target = null;
        if (/^https?:\/\//i.test(v)) target = v;
        else if (v.slice(0, 2) === '//') target = 'https:' + v;
        if (target) {
          var host = '';
          try { host = new URL(target).hostname; } catch (e) { host = ''; }
          add('redirect', 'caution', 'Passes you on to another site',
            'This link carries "' + v + '" inside it, so the first site hands you on to ' + (host || 'another site') + '.',
            'query');
        }
      });
    }

    // reassuring-words — the real site's own name asks to be trusted.
    var first = realLabels.length ? realLabels[0].toLowerCase() : '';
    var words = [];
    for (var w = 0; w < REASSURING.length; w++) {
      if (first.indexOf(REASSURING[w]) !== -1) words.push('"' + REASSURING[w] + '"');
    }
    if (words.length) {
      add('reassuring-words', 'caution', 'Words meant to reassure',
        "The site's name uses " + words.join(' and ') + ', words fake sign-in pages often use.',
        'domain');
    }

    // port — an explicit, non-standard door.
    if (ctx.port && ctx.port !== String(ctx.defaultPort)) {
      add('port', 'caution', 'Unusual port',
        '":' + ctx.port + '" names an unusual door on the site. Normal web links use the standard one and leave this out.',
        'port');
    }

    // deep-subdomains — a long chain of names before the real site.
    if (ctx.subLabels.length >= 4) {
      add('deep-subdomains', 'caution', 'Many subdomains',
        '"' + ctx.subLabels.join('.') + '" is a chain of ' + ctx.subLabels.length + ' subdomains, a way to bury the real site name.',
        'subdomain');
    }

    // hyphens — three or more in the real site's first label.
    var hyphens = (first.match(/-/g) || []).length;
    if (hyphens >= 3) {
      add('hyphens', 'caution', 'Lots of hyphens',
        '"' + realLabels[0] + '" has ' + hyphens + ' hyphens. Fakers pile words together to look like a real brand.',
        'domain');
    }

    // long — long enough to hide its far end.
    if (ctx.href.length > 200) {
      add('long', 'caution', 'Very long link',
        'This link is ' + ctx.href.length + ' characters long, long enough to hide the real site past the edge of the screen.',
        null);
    }

    // encoded-letters — ordinary letters written in % code.
    var encRe = /%[2-7][0-9a-fA-F]/g;
    var em, encPart = null;
    while ((em = encRe.exec(ctx.href)) !== null) {
      var decoded = '';
      try { decoded = decodeURIComponent(em[0]); } catch (e) { decoded = ''; }
      if (/[a-zA-Z0-9]/.test(decoded)) {
        if (ctx.url && ctx.url.search && em.index >= ctx.href.indexOf(ctx.url.search)) encPart = 'query';
        else if (ctx.url && ctx.url.pathname !== '/' && em.index >= ctx.href.indexOf(ctx.url.pathname)) encPart = 'path';
        add('encoded-letters', 'caution', 'Letters written in code',
          '"' + em[0] + '" is ordinary text written in % code, which can hide the link\'s words from you.',
          encPart);
        break;
      }
    }

    // double-encoding — a % sign that was itself encoded.
    if (/%25/.test(ctx.href)) {
      add('double-encoding', 'caution', 'Coded twice',
        '"%25" is a % sign written in code, so part of this link is coded twice.',
        encPart);
    }

    // control-chars — invisible characters in the text.
    var ctrlMatch = ctx.href.match(/%0[0-9a-fA-F]|%1[0-9a-fA-F]/);
    var rawCtrl = ctx.href.match(/[\u0000-\u001F\u007F]/);
    var zero = ctx.href.match(INVISIBLE_RE);
    if (ctrlMatch || rawCtrl || zero) {
      var what = zero ? 'a zero-width character' : rawCtrl ? 'a control character' : '"%00" to "%1F" code';
      add('control-chars', 'warning', 'Hidden characters',
        'This link hides invisible characters (' + what + '). What you see may not be what the browser reads.',
        null);
    }

    // encoded-host — the site's own name written in % code.
    if (ctx.rawHost && ctx.rawHost.indexOf('%') !== -1) {
      add('encoded-host', 'warning', 'Coded site name',
        "The site's name is written in % code, which can hide its real name from you.",
        'domain');
    }

    return f;
  }

  /* ── The entry point. ── */
  function analyze(raw) {
    var input = normalise(raw);
    if (input === '') return { ok: false, error: 'empty' };
    if (/\s/.test(input) || input.length > 4000) return { ok: false, error: 'not-a-link' };

    var schemeMatch = input.match(SCHEME_RE);
    var scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;

    // javascript:, data:, file:, vbscript: — checked, and warned about.
    if (scheme && NON_WEB[scheme]) {
      return {
        ok: true, input: input, href: input, realSite: null, displayHost: null,
        parts: [{
          key: 'scheme', label: PART_LABELS.scheme, value: scheme + ':',
          note: 'Not an http or https link', level: 'warning',
        }],
        findings: [{
          id: 'not-web', level: 'warning', title: 'Not a web link',
          detail: '"' + scheme + ':" does not open a website: it runs code or shows a made-up page instead. Never open one like this.',
          part: 'scheme',
        }],
        verdict: {
          level: 'warning', title: 'Warning signs found',
          summary: '1 warning sign. Don’t open it unless you are sure who sent it and why.',
        },
      };
    }

    // Any other scheme that is not http(s) — mailto:, tel:, and friends.
    if (scheme && scheme !== 'http' && scheme !== 'https') {
      return { ok: false, error: 'unsupported', scheme: scheme };
    }

    // No scheme typed: accept it when the front looks like a host name.
    var href = input, schemeTyped = !!scheme;
    if (!schemeTyped) {
      var head = input.split(/[/?#]/)[0];
      if (!head || head.indexOf('.') === -1) return { ok: false, error: 'not-a-link' };
      href = 'https://' + input;
    }

    // The authority as typed, before URL() normalises anything.
    var authority = null;
    var schemeCut = href.indexOf('://');
    if (schemeCut > 0) {
      var rest = href.slice(schemeCut + 3);
      var cut = rest.search(/[/?#]/);
      authority = cut === -1 ? rest : rest.slice(0, cut);
    }

    var url;
    try { url = new URL(href); } catch (e) { return { ok: false, error: 'not-a-link' }; }
    if (!url.hostname) return { ok: false, error: 'not-a-link' };

    var userinfo = null, rawHost = url.hostname, rawPort = null;
    if (authority !== null) {
      var at = authority.lastIndexOf('@');
      if (at > -1) { userinfo = authority.slice(0, at); authority = authority.slice(at + 1); }
      var sp = splitPort(authority);
      rawHost = sp.host || url.hostname;
      rawPort = sp.port;
    }

    var hostNorm = url.hostname.toLowerCase();
    var v6 = isIPv6(hostNorm);
    var v4 = !v6 && isIPv4(hostNorm);
    var isIP = v4 || v6;
    var ipDisguised = v4 && rawHost && !isIPv4(rawHost.toLowerCase());

    // The real site: the last labels that name it.
    var realSite;
    if (isIP) {
      realSite = hostNorm;
    } else {
      var labels = hostNorm.replace(/\.$/, '').split('.');
      var n = labels.length;
      var take = n >= 2 ? 2 : n;
      if (n >= 3 && labels[n - 1].length === 2 && REAL_SITE_SECOND[labels[n - 2]]) take = 3;
      realSite = labels.slice(Math.max(0, n - take)).join('.');
    }

    var displayHost;
    if (rawHost && /[^\x00-\x7F]/.test(rawHost)) displayHost = rawHost.toLowerCase();
    else displayHost = decodeLabels(hostNorm);
    var displayRealSite = decodeLabels(realSite);

    var defaultPort = scheme === 'http' ? 80 : 443;
    var port = url.port || (rawPort && rawPort !== '' ? rawPort : null);

    // Subdomain labels between the host's front and the real site.
    var subLabels = [];
    if (!isIP) {
      var hostLabels = hostNorm.replace(/\.$/, '').split('.');
      var realCount = realSite.split('.').length;
      subLabels = hostLabels.slice(0, Math.max(0, hostLabels.length - realCount));
    }

    var ctx = {
      scheme: scheme, href: href, url: url, userinfo: userinfo,
      rawHost: rawHost, displayHost: displayHost, realSite: realSite,
      displayRealSite: displayRealSite, subLabels: subLabels,
      isIP: isIP, ipDisguised: ipDisguised, port: port, defaultPort: defaultPort,
    };

    var findings = collectFindings(ctx);
    findings.sort(function (a, b) {
      return (a.level === 'warning' ? 0 : 1) - (b.level === 'warning' ? 0 : 1);
    });

    // Parts, in order, only when present.
    var partLevel = {};
    findings.forEach(function (x) { if (x.part) partLevel[x.part] = x.level; });
    var parts = [];

    if (schemeTyped) {
      parts.push({
        key: 'scheme', label: PART_LABELS.scheme,
        value: scheme + '://',
        note: scheme === 'https' ? 'Encrypted connection' : 'Not encrypted',
        level: partLevel.scheme || (scheme === 'https' ? undefined : 'caution'),
      });
    } else {
      parts.push({
        key: 'scheme', label: PART_LABELS.scheme, value: '(none)',
        note: 'None typed. Browsers usually add https://',
      });
    }
    if (userinfo) {
      parts.push({ key: 'login', label: PART_LABELS.login, value: userinfo, note: 'Browsers skip this. Real addresses don’t need it.', level: partLevel.login });
    }
    if (!isIP && subLabels.length) {
      parts.push({
        key: 'subdomain', label: PART_LABELS.subdomain,
        value: decodeLabels(subLabels.join('.')),
        note: 'Chosen by whoever owns the site. It can say anything.',
        level: partLevel.subdomain,
      });
    }
    if (displayRealSite) {
      parts.push({ key: 'domain', label: PART_LABELS.domain, value: displayRealSite, note: 'The site you would actually visit', level: partLevel.domain });
    }
    if (port) {
      parts.push({ key: 'port', label: PART_LABELS.port, value: ':' + port, note: 'The door on the site. Most links leave it out.', level: partLevel.port });
    }
    if (url.pathname && url.pathname !== '/') {
      parts.push({ key: 'path', label: PART_LABELS.path, value: url.pathname, note: 'The page on that site', level: partLevel.path });
    }
    if (url.search) {
      parts.push({ key: 'query', label: PART_LABELS.query, value: url.search, note: 'Data handed to the page', level: partLevel.query });
    }
    if (url.hash) {
      parts.push({ key: 'fragment', label: PART_LABELS.fragment, value: url.hash, note: 'A spot on the page', level: partLevel.fragment });
    }

    var warnings = findings.filter(function (x) { return x.level === 'warning'; }).length;
    var cautions = findings.length - warnings;
    var verdict = { level: 'clear', title: 'No warning signs found', summary: 'Nothing in how this link is written looks like a common trick.' };
    if (warnings) {
      verdict.level = 'warning';
      verdict.title = 'Warning signs found';
      verdict.summary =
        warnings + ' ' + plural(warnings, 'warning sign', 'warning signs') +
        (cautions ? ', ' + cautions + ' ' + plural(cautions, 'thing to check', 'things to check') : '') +
        '. Don’t open it unless you are sure who sent it and why.';
    } else if (cautions) {
      verdict.level = 'caution';
      verdict.title = 'Some things to check';
      verdict.summary = cautions + ' ' + plural(cautions, 'thing to check', 'things to check') + '. Look closely before you open it.';
    }

    return {
      ok: true, input: input, href: href, realSite: realSite,
      displayHost: displayHost, realSiteDisplay: displayRealSite,
      schemeTyped: schemeTyped, port: port, subLabels: subLabels,
      parts: parts, findings: findings, verdict: verdict,
    };
  }

  return { analyze: analyze };
});
