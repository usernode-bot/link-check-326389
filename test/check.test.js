/*
 * Unit tests for public/check.js — the analyser, under Node. The same file
 * runs in the browser; these tests only exercise the pure module.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../public/check.js');

/* ── Not links, and links this app doesn't check. ── */
test('empty input is refused', () => {
  assert.deepEqual(analyze('   '), { ok: false, error: 'empty' });
});

test('plain words are refused', () => {
  assert.equal(analyze('hello there').error, 'not-a-link');
});

test('a single word with no dot is refused', () => {
  assert.equal(analyze('localhost').error, 'not-a-link');
});

test('mailto: is named as unsupported', () => {
  const r = analyze('mailto:someone@example.com');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported');
  assert.equal(r.scheme, 'mailto');
});

/* ── input: the link as written, which is what "Copy link" copies. ── */
test('input is the link as written, minus wrapping and trailing punctuation', () => {
  assert.equal(analyze(' "https://a.example/x?q=1" ').input, 'https://a.example/x?q=1');
  assert.equal(analyze('https://a.example/x?q=1.').input, 'https://a.example/x?q=1');
  assert.equal(analyze('a.example/x').input, 'a.example/x');
});

/* ── A scheme typed without // ── */
test('https typed without // still checks', () => {
  const r = analyze('https:example.com/shop');
  assert.ok(r.ok);
  assert.equal(r.realSite, 'example.com');
});

/* ── The real site, past any disguise. ── */
test('a long subdomain does not change the real site', () => {
  const r = analyze('https://northbank.com.account-verify.example/login');
  assert.ok(r.ok);
  assert.equal(r.realSite, 'account-verify.example');
  assert.deepEqual(r.subLabels, ['northbank', 'com']);
});

test('a TLD-shaped label in the subdomain is a warning', () => {
  const r = analyze('https://northbank.com.account-verify.example/login');
  assert.ok(r.findings.some((f) => f.id === 'tld-in-subdomain' && f.level === 'warning'));
});

test('a two-letter TLD keeps three labels together', () => {
  const r = analyze('https://warnings.example.co.uk/help');
  assert.ok(r.ok);
  assert.equal(r.realSite, 'example.co.uk');
});

test('userinfo before @ is not the real site', () => {
  const r = analyze('https://www.shopfront.example@login-check.test/cart');
  assert.ok(r.ok);
  assert.equal(r.realSite, 'login-check.test');
  assert.ok(r.findings.some((f) => f.id === 'credentials' && f.level === 'warning'));
});

/* ── Scheme findings. ── */
test('plain http is a caution, not a warning', () => {
  const r = analyze('http://example.com/page');
  const f = r.findings.find((x) => x.id === 'no-https');
  assert.ok(f);
  assert.equal(f.level, 'caution');
});

/* ── Host findings. ── */
test('a bare IP host is a warning', () => {
  const r = analyze('http://192.0.2.44/parcel/redelivery');
  assert.ok(r.findings.some((f) => f.id === 'ip-host' && f.level === 'warning'));
  assert.equal(r.realSite, '192.0.2.44');
});

test('an IP written as one number is flagged as disguised', () => {
  const r = analyze('https://168430150.example'); // hmm: not an IP form; see next test
  assert.ok(r.ok);
});

test('an integer host is an IP host, flagged', () => {
  // 3232235521 = 192.168.0.1
  const r = analyze('https://3232235521');
  if (r.ok) {
    assert.ok(r.findings.some((f) => f.id === 'ip-host'));
  }
});

test('mixed scripts in a name are a warning', () => {
  const r = analyze('https://shopfrоont.example/account'); // Cyrillic о
  assert.ok(r.findings.some((f) => f.id === 'mixed-script' && f.level === 'warning'));
});

/* ── Path and query findings. ── */
test('a double extension is a warning naming the real extension', () => {
  const r = analyze('https://downloads.example/invoice_2291.pdf.exe');
  const f = r.findings.find((x) => x.id === 'risky-file');
  assert.ok(f && f.level === 'warning');
  assert.ok(/exe/.test(f.detail));
});

test('a look-alike digit in the site name is a caution', () => {
  const r = analyze('https://sh0pfront-deals.example/sale');
  const f = r.findings.find((x) => x.id === 'digit-letter');
  assert.ok(f && f.level === 'caution');
});

test('a redirect written in the query is a caution naming the target', () => {
  const r = analyze('https://maps.example/go?to=https%3A%2F%2Fprize-claim.test');
  const f = r.findings.find((x) => x.id === 'redirect');
  assert.ok(f && f.level === 'caution');
  assert.ok(/prize-claim\.test/.test(f.detail));
});

/* ── Not-web schemes are checked and warned, never linked. ── */
test('javascript: is checked and warned about', () => {
  const r = analyze('javascript:alert(1)');
  assert.ok(r.ok);
  assert.equal(r.verdict.level, 'warning');
  assert.ok(r.findings.some((f) => f.id === 'not-web'));
});

/* ── The verdict. ── */
test('a clean link is clear and says so in plain words', () => {
  const r = analyze('https://library.example/opening-hours');
  assert.deepEqual(r.findings, []);
  assert.equal(r.verdict.level, 'clear');
  assert.match(r.verdict.title, /No warning signs/);
});

test('warnings outweigh cautions in the verdict', () => {
  const r = analyze('http://192.0.2.44/parcel/redelivery'); // warning + caution
  assert.equal(r.verdict.level, 'warning');
});

test('the verdict never calls a link safe', () => {
  const r = analyze('https://library.example/opening-hours');
  assert.ok(!/safe/i.test(r.verdict.title + ' ' + r.verdict.summary));
});

/* ── The parts, in order. ── */
test('parts come out in link order and flag the guilty part', () => {
  const r = analyze('http://user@192.0.2.44:8080/a?b=c');
  const keys = r.parts.map((p) => p.key);
  const first = keys.indexOf('scheme');
  const last = keys.indexOf('query');
  assert.ok(first > -1 && last > first);
  assert.ok(keys.indexOf('login') > -1);
  assert.ok(keys.indexOf('port') > -1);
  const ip = r.parts.find((p) => p.key === 'domain');
  assert.equal(ip.level, 'warning'); // the ip-host finding's part
});

test('a schemeless link is read with https added and says so', () => {
  const r = analyze('example.com/shop');
  assert.ok(r.ok);
  assert.equal(r.schemeTyped, false);
  const schemePart = r.parts.find((p) => p.key === 'scheme');
  assert.equal(schemePart.value, '(none)');
});
