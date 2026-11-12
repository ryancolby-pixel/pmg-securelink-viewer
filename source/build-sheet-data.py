#!/usr/bin/env python3
"""Builds the AME request sheet's data file (viewer/sheet/sheet-data.json) from tools/sheet-curated.json ONLY.

sheet-curated.json is the hand-curated list (Ryan 11/12, "Curated quotes"). Per condition: its FAA page,
an optional Authorization letter sentence, and blocks. Each block is one FAA document's own heading, the
document's URL, the date its quotes were matched against a fresh fetch, and the FAA's words from that
document, in the FAA's order. Nothing else feeds the sheet: not si_requirements.json, not our prose.

A block's quote is a string, or {"quote": "...", "sub": ["...", ...]} for an FAA list item with sub-items
(the page indents the sub-items under their lead). A block may carry "more": true when the FAA document
lists more than the block quotes (an item the matcher cannot verify, or one left out); the page then adds
our own line under the block pointing to the document. The flag adds no FAA words, so it is not checked.

At build time every quote (each lead and each sub-item) and every letter sentence is checked again, against its OWN sourceURL only
(no linked documents, no wider corpus), with the content repo's matcher (check-content-fidelity.py:
fetch() and in_source(); imported here, never copied), on a cache folder that must be new or empty, so
every document is fetched fresh.
  exit 2: a quote or letter sentence is not on its own sourceURL. Prints the condition id and the quote.
  exit 3: a sourceURL or condition page could not be fetched.
  exit 1: the curated file is malformed, or the cache folder is not new.
On any non-zero exit nothing is written.
Block titles are checked too (whole, or each part where a title joins two FAA headings with ": " or
" \u203a "). A title miss stops the build too (exit 2, Ryan 11/12 review): a heading we show over FAA
quotes must itself be the FAA's words.

Dashes: an en dash may appear only inside the FAA's own words (a quote, title or letter sentence that
the matcher found on its source). Our own fields (condition names, the note) may carry none.

Run:
    python3 -I SecureLink/tools/build-sheet-data.py --content /path/to/pilot-medical-guardian-content \\
        --cache /a/new/empty/folder
"""
import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DASHES = re.compile("[\\u2013\\u2014]")
FAA = re.compile(r"^https://(www\.faa\.gov|www\.ecfr\.gov)/")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID = re.compile(r"^si-[a-z0-9-]+$")


def malformed(msg: str) -> int:
    print(f"MALFORMED: {msg}", file=sys.stderr)
    return 1


def validate(conds) -> str | None:
    if not isinstance(conds, list) or not conds:
        return "top level must be a non-empty list of conditions"
    seen = set()
    for c in conds:
        cid = c.get("id") if isinstance(c, dict) else None
        if not isinstance(cid, str) or not ID.match(cid) or cid in seen:
            return f"bad or duplicate id: {cid!r}"
        seen.add(cid)
        if set(c) != {"id", "name", "page", "letter", "blocks"}:
            return f"{cid}: keys must be id, name, page, letter, blocks"
        if not isinstance(c["name"], str) or not c["name"].strip() or DASHES.search(c["name"]):
            return f"{cid}: name is empty or has a dash"
        if not isinstance(c["page"], str) or not FAA.match(c["page"]):
            return f"{cid}: page is not an FAA URL"
        L = c["letter"]
        if L is not None:
            if not isinstance(L, dict) or set(L) != {"quote", "sourceURL", "checked"}:
                return f"{cid}: letter must be null or have quote, sourceURL, checked"
            if not isinstance(L["quote"], str) or not L["quote"].strip():
                return f"{cid}: letter quote is empty"
            if not isinstance(L["sourceURL"], str) or not FAA.match(L["sourceURL"]):
                return f"{cid}: letter sourceURL is not an FAA URL"
            if not isinstance(L["checked"], str) or not DAY.match(L["checked"]):
                return f"{cid}: letter checked is not YYYY-MM-DD"
        if not isinstance(c["blocks"], list) or not c["blocks"]:
            return f"{cid}: no blocks"
        for i, b in enumerate(c["blocks"]):
            if not isinstance(b, dict) or not ({"title", "sourceURL", "checked", "quotes"} <= set(b) <= {"title", "sourceURL", "checked", "quotes", "more"}):
                return f"{cid} block {i}: keys must be title, sourceURL, checked, quotes and optionally more"
            if "more" in b and b["more"] is not True:
                return f"{cid} block {i}: more must be true when present"
            if not isinstance(b["title"], str) or not b["title"].strip():
                return f"{cid} block {i}: empty title"
            if not isinstance(b["sourceURL"], str) or not FAA.match(b["sourceURL"]):
                return f"{cid} block {i}: sourceURL is not an FAA URL"
            if not isinstance(b["checked"], str) or not DAY.match(b["checked"]):
                return f"{cid} block {i}: checked is not YYYY-MM-DD"
            q = b["quotes"]
            if not isinstance(q, list) or not q or not all(good_quote(e) for e in q):
                return f"{cid} block {i}: quotes must be a non-empty list of non-empty strings or {{quote, sub}} items"
    return None


def nonempty(s) -> bool:
    return isinstance(s, str) and bool(s.strip())


def good_quote(e) -> bool:
    """A quote is a non-empty string, or {"quote": lead, "sub": [non-empty strings]} for a list item with sub-items."""
    if isinstance(e, str):
        return nonempty(e)
    return (isinstance(e, dict) and set(e) == {"quote", "sub"} and nonempty(e["quote"])
            and isinstance(e["sub"], list) and bool(e["sub"]) and all(nonempty(s) for s in e["sub"]))


def strings_of(e) -> list[str]:
    """Every FAA string in one quote entry: the string itself, or the lead and each sub-item."""
    return [e] if isinstance(e, str) else [e["quote"], *e["sub"]]


def title_parts(title: str) -> list[str]:
    parts = [title]
    for sep in (" \u203a ", ": "):
        parts = [p for part in parts for p in part.split(sep)]
    return [p.strip() for p in parts if p.strip()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--content", type=Path, required=True, help="the pilot-medical-guardian-content checkout")
    ap.add_argument("--cache", type=Path, required=True, help="a NEW or empty folder; every document is fetched fresh")
    ap.add_argument("--curated", type=Path, default=HERE / "sheet-curated.json")
    ap.add_argument("--out", type=Path, default=HERE.parent / "viewer" / "sheet" / "sheet-data.json")
    args = ap.parse_args()

    cache = args.cache.resolve()
    if cache.exists() and any(cache.iterdir()):
        print(f"Refusing: {cache} is not empty. Pass a new folder so every document is fetched fresh.", file=sys.stderr)
        return 1

    try:
        conds = json.loads(args.curated.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return malformed(f"{args.curated}: {e}")
    err = validate(conds)
    if err:
        return malformed(err)

    spec = importlib.util.spec_from_file_location("fidelity", args.content.resolve() / "scripts" / "check-content-fidelity.py")
    fid = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fid)

    # Fetch every document once: block sources, letter sources, and each condition's page (the page is
    # linked on the sheet, so it must at least be reachable; no quote is checked against it).
    urls = []
    for c in conds:
        for u in [b["sourceURL"] for b in c["blocks"]] + ([c["letter"]["sourceURL"]] if c["letter"] else []) + [c["page"]]:
            if u not in urls:
                urls.append(u)
    texts, unreachable = {}, []
    for u in urls:
        t = fid.fetch(u, cache)
        if t is None:
            unreachable.append(u)
        texts[u] = t
    if unreachable:
        for u in unreachable:
            ids = sorted({c["id"] for c in conds if u == c["page"] or u == (c["letter"] or {}).get("sourceURL")
                          or any(b["sourceURL"] == u for b in c["blocks"])})
            print(f"UNREACHABLE {u} (used by {', '.join(ids)})", file=sys.stderr)
        return 3

    misses, title_misses, checked, faa_dash = [], [], 0, 0
    for c in conds:
        L = c["letter"]
        if L:
            checked += 1
            if not fid.in_source(L["quote"], texts[L["sourceURL"]]):
                misses.append((c["id"], "letter", L["sourceURL"], L["quote"]))
            elif DASHES.search(L["quote"]):
                faa_dash += 1
        for b in c["blocks"]:
            text = texts[b["sourceURL"]]
            for q in (s for e in b["quotes"] for s in strings_of(e)):
                checked += 1
                if not fid.in_source(q, text):
                    misses.append((c["id"], b["title"], b["sourceURL"], q))
                elif DASHES.search(q):
                    faa_dash += 1
            if not fid.in_source(b["title"], text):
                parts = title_parts(b["title"])
                if len(parts) == 1 or any(not fid.in_source(p, text) for p in parts):
                    title_misses.append((c["id"], b["title"], b["sourceURL"]))
                    continue
            if DASHES.search(b["title"]):
                faa_dash += 1
    if misses:
        for cid, where, u, q in misses:
            print(f"NOT ON ITS SOURCE  {cid}  [{where}]  {u}\n    \u201c{q}\u201d", file=sys.stderr)
        print(f"{len(misses)} of {checked} strings missing; nothing written.", file=sys.stderr)
        return 2
    # A block title is shown as the FAA's heading, so one that is not on its source may not ship
    # (Ryan 11/12 review: never put words in the FAA's mouth, headings included).
    if title_misses:
        for cid, t, u in title_misses:
            print(f"TITLE NOT ON ITS SOURCE  {cid}  {u}\n    {t}", file=sys.stderr)
        print(f"{len(title_misses)} block titles missing; nothing written.", file=sys.stderr)
        return 2

    doc = {"note": "Generated by SecureLink/tools/build-sheet-data.py from tools/sheet-curated.json. FAA words only, each re-checked on its own source at build time. Do not edit by hand.",
           "conditions": conds}
    args.out.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps({
        "conditions": len(conds),
        "blocks": sum(len(c["blocks"]) for c in conds),
        "quotes": sum(len(b["quotes"]) for c in conds for b in c["blocks"]),
        "quotes_with_sub_items": sum(1 for c in conds for b in c["blocks"] for e in b["quotes"] if isinstance(e, dict)),
        "sub_items": sum(len(e["sub"]) for c in conds for b in c["blocks"] for e in b["quotes"] if isinstance(e, dict)),
        "blocks_marked_more": sum(1 for c in conds for b in c["blocks"] if b.get("more")),
        "letters": sum(1 for c in conds if c["letter"]),
        "strings_checked_on_own_source": checked,
        "misses": 0,
        "documents_fetched_fresh": len(urls),
        "titles_matched": sum(len(c["blocks"]) for c in conds) - len(title_misses),
        "title_misses": [f"{cid}: {t} ({u})" for cid, t, u in title_misses],
        "faa_strings_with_their_own_en_dash": faa_dash,
        "cache": str(cache),
        "out": str(args.out),
    }, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
