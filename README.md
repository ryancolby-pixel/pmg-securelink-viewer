# The page your AME opens (Pilot Medical Guardian secure link)

When a pilot sends their AME a secure link from Pilot Medical Guardian, the AME's browser opens one page. That page
downloads the pilot's encrypted file and decrypts it inside the browser. The key is in the part of the link after the
`#`, which browsers never send to a server, so my server only ever holds the encrypted file.

Because my server also serves this page, you are trusting that the page is what I say it is. So the exact page is
published here, and every day an automated check compares the live page with `viewer.html` in this folder. That
check can tell me the page changed; it can't stop a change.

## Check it yourself

The live page is at `/r` on the host in the link (the part before the `#`):

    curl -s https://<host from the link>/r | shasum -a 256

It should print the same hash as `viewer.html` in SHA256SUMS:

    8d12dbff795d45eb8a58b5e47b5819308cc40a58a3362a52ce4980bb741f3ad3

## What's in it

- `viewer.html`: the page exactly as the server sends it (22579 bytes). Its Content-Security-Policy allows only
  the inline script and style with these hashes, so the browser runs nothing else:
  - script `sha256-OX8LQmNDtZVnt5Ml3B7l/rGHQgXqawZqDoOr5eG8pIo=`
  - style `sha256-/kOpFTaGpll6jpMvmpwRq4lYqAdxuA5DeybwzO6jSoU=`
- `source/`: what it's built from. `build-viewer.mjs` puts `pmgl.mjs` (the file format: AES-256-GCM in 4 MiB chunks),
  `viewer.js` and `viewer.css` into `viewer.template.html`.

The page loads nothing from anywhere else, sets no cookies and has no analytics. It talks only to my server (to get a
short-lived download address) and to the storage address that returns.

## The request sheet

`/sheet` on the same host is a free list of the FAA's own published documents for each Special Issuance condition,
quoted word for word, with a link to each FAA source. It holds no pilot data.

- `sheet/index.html`: the page exactly as the server sends it (21621 bytes). Its Content-Security-Policy
  allows only the inline script and style with these hashes:
  - script `sha256-E6cpGRlqerddyUMTPLd+kKq/CLBivqw9VrBOBscnSRM=`
  - style `sha256-wEzZMsP+Jm1hUrnbpLwDqO3xo3kF+QOr/1hEvbko7iU=`
- `sheet/sheet-data.json`: the list, exactly as the server sends it at `/sheet/sheet-data.json` (98124 bytes).
  The quotes are the FAA's, so they keep the FAA's own punctuation.
- `sheet/sheet-links.json`: each condition's name and the links to its FAA pages, with no FAA words, exactly as the
  server sends it at `/sheet/sheet-links.json` (9577 bytes). `build-sheet.mjs` makes it from the list.
- `source/`: `build-sheet-data.py` makes the list from `sheet-curated.json` and checks every quote again against a
  fresh copy of the FAA document it cites; one quote it can't find there stops the build. `build-sheet.mjs` puts the
  page and the list into the server unchanged.

The quotes are shown only while they are freshly re-checked. An automated check re-reads every quote on the FAA's
current pages each day and records that the list still matches, byte for byte. If that record is missing, older than
36 hours, or the check found a problem, the server answers `/sheet/sheet-data.json` with "rechecking" instead, and
the page shows only the links to the FAA's own pages until the list passes again. When it does serve the list, the
`X-Sheet-Verified` header says when it was last re-checked.

The page loads nothing but its own two data files and sends nothing anywhere. The condition you pick goes only in the part
of the link after the `#`, which browsers never send to a server.

To check it, compare the live files with SHA256SUMS:

    curl -s https://<same host>/sheet | shasum -a 256
    curl -s https://<same host>/sheet/sheet-data.json | shasum -a 256
    curl -s https://<same host>/sheet/sheet-links.json | shasum -a 256

They should print:

    451589714d59e1e65b669ea69521c4ab21fd87c651a21b010599b3710e006ad4  sheet/index.html
    7bf3fec4fdb51c5a6b174b711f6461b7409e7e4bb861236c55e401080c158ddb  sheet/sheet-data.json
    872ff20300f0c3b907e1b7701128c0b00593ee7fc43c8db111c82bddd17d0152  sheet/sheet-links.json

(The data file prints this hash only while it is being served; see above.) The daily check compares all three with
the live server too.
