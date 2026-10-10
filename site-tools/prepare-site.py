#!/usr/bin/env python3
"""Builds the publishable copy of the RaceSignal site from the reviewed draft in site/.

  python3 site-tools/prepare-site.py <output-dir> --confirm-published-changes

It copies site/ to <output-dir> and removes everything that only exists for review: the "Draft for review" banner, the
noindex robots tag, the draft body class and the dashed highlight on passages that depended on unshipped changes. It
refuses to run without --confirm-published-changes, which you pass only after the passages marked class="pending" in the
draft are true (see docs/site-review.md). It also refuses to package any link to the App Store (apps.apple.com) unless you pass
--app-store-live, which you pass only once the app has a public App Store listing. It never uploads or publishes anything.
"""
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "site"


def main(argv):
    if len(argv) < 1 or argv[0].startswith("--"):
        sys.exit(__doc__)
    out = pathlib.Path(argv[0]).resolve()
    if "--confirm-published-changes" not in argv:
        sys.exit("Refusing: pass --confirm-published-changes once every highlighted (class=\"pending\") passage is true.")
    if "--app-store-live" not in argv:
        linked = [str(p.relative_to(SRC)) for p in SRC.rglob("*.html") if "apps.apple.com" in p.read_text()]
        if linked:
            sys.exit(f"Refusing: {', '.join(linked)} link to the App Store, but --app-store-live was not passed (the app has no public listing yet).")
    if out == SRC or SRC in out.parents:
        sys.exit("Refusing: the output directory must be outside site/.")
    if out.exists() and any(out.iterdir()):
        sys.exit(f"Refusing: {out} is not empty.")
    shutil.copytree(SRC, out, dirs_exist_ok=True)
    for page in out.rglob("*.html"):
        html = page.read_text()
        html = re.sub(r'\s*<div class="draft-banner" data-draft>.*?</div>', "", html, flags=re.S)
        html = re.sub(r'\s*<meta name="robots" content="noindex" data-draft>', "", html)
        html = re.sub(r'<body class="([^"]*)">', lambda m: "<body" + (' class="%s"' % " ".join(c for c in m.group(1).split() if c != "draft") if [c for c in m.group(1).split() if c != "draft"] else "") + ">", html)
        html = html.replace(' class="pending"', "")
        assert "data-draft" not in html and "draft-banner" not in html and 'class="pending"' not in html and not re.search(r'class="[^"]*\bdraft\b', html), page
        page.write_text(html)
    if "--app-store-live" not in argv:
        (out / "assets" / "app-store-badge-black.svg").unlink(missing_ok=True)  # the official badge artwork is not shipped before the listing is public
    css = out / "assets" / "site.css"
    css.write_text(re.sub(r"\.draft-banner[^\n]*\n", "", re.sub(r"body\.draft \.pending[^\n]*\n", "", css.read_text())))
    print(f"Wrote the publishable site to {out}. Nothing was uploaded.")


if __name__ == "__main__":
    main(sys.argv[1:])
