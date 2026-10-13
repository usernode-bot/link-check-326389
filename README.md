# LINK CHECK

Spot suspicious links before you click.

Paste a link, press **Check**, and LINK CHECK reads it as written and
shows, in plain words, where it really goes. It is a teaching tool for
the tricks fake links use:

- A long subdomain that puts a familiar name in front
  (`northbank.com.account-verify.example` really goes to
  `account-verify.example`).
- A site name in front of an `@` — everything before the `@` is
  decoration.
- A raw IP address instead of a name.
- Mixed alphabets in a name (a Cyrillic о that looks like an o).
- Double extensions (`invoice.pdf.exe`).
- Links that carry another site inside their query.

Every part of the link is shown, labelled and underlined in its own
colour — the link x-ray — with the real site in large type above it.
Findings come in three levels: **clear** (no warning signs),
**caution** (things to check) and **warning** (don't open it unless
you're sure). The verdict never calls a link safe; a link with no
warning signs can still lead somewhere harmful, and the page says so.

## How it works

- **The link is never fetched, opened, linked or sent.** All analysis
  is in `public/check.js`, a pure module that runs in the browser; the
  page (`public/app.js`) only renders its answer. Nothing about the
  pasted link leaves the page.
- **Sign-in** — the server verifies the platform-issued user token
  (an RS256 JWT) on every request, so the app already knows who is
  using it. No accounts to build.
- **Styling** — Tailwind CSS, precompiled by `npm run build` during
  image creation, in a light and a dark look that follow the viewer's
  Homeroom theme.
- **Staging demo** — on staging, `/?demo=1` shows a "Staging demo"
  banner and eight sample links (one per trick, plus a clean one), the
  first already checked. Backed by `GET /api/demo?demo=1`, gated on
  staging only.

## Development

```sh
npm ci --include=dev   # install, including Tailwind
npm run build          # compile styles/tailwind-input.css → public/tailwind.css
npm test               # unit tests for public/check.js (node --test)
npm start              # serve on PORT (default 3000)
```

To change this app, ask Homeroom bot: open the app on Homeroom, tap the
Homeroom icon in the header, then **Suggest an improvement**, and
describe the app you want in plain English. You can also run Claude
Code against this repo directly; start with `CLAUDE.md`, which carries
the app-specific notes and points at the platform rules.
