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

    a964fa12e08cd1452eefeda6f9e60a5218fe73d5584d6403bdb40b9e28e13241

## What's in it

- `viewer.html`: the page exactly as the server sends it (9987 bytes). Its Content-Security-Policy allows only
  the inline script and style with these hashes, so the browser runs nothing else:
  - script `sha256-dm1L3lzxrINlIJNH/l7IEuPFEAn3S+M/4kF8wtUCZH8=`
  - style `sha256-m8KM+kK2H3F9XLOv0gEm80I+Dewmn3IEg8+uL4HdGig=`
- `source/`: what it's built from. `build-viewer.mjs` puts `pmgl.mjs` (the file format: AES-256-GCM in 4 MiB chunks),
  `viewer.js` and `viewer.css` into `viewer.template.html`.

The page loads nothing from anywhere else, sets no cookies and has no analytics. It talks only to my server (to get a
short-lived download address) and to the storage address that returns.

## The request sheet

`/sheet` on the same host is a free list of the FAA's own published documents for each Special Issuance condition,
quoted word for word, with a link to each FAA source. It holds no pilot data.

- `sheet/index.html`: the page exactly as the server sends it (11315 bytes). Its Content-Security-Policy
  allows only the inline script and style with these hashes:
  - script `sha256-WP+y1zFUVzC5VP+9slJJExn6/aUB/Y5oBp1KORzszes=`
  - style `sha256-kijD6Vg0sL/W+QTev39l/bLq9iBxl3j4zJ8I5rparKA=`
- `sheet/sheet-data.json`: the list, exactly as the server sends it at `/sheet/sheet-data.json` (98124 bytes).
  The quotes are the FAA's, so they keep the FAA's own punctuation.
- `source/`: `build-sheet-data.py` makes the list from `sheet-curated.json` and checks every quote again against a
  fresh copy of the FAA document it cites; one quote it can't find there stops the build. `build-sheet.mjs` puts the
  page and the list into the server unchanged.

The page loads nothing but its own data file and sends nothing anywhere. The condition you pick goes only in the part
of the link after the `#`, which browsers never send to a server.

To check it, compare the live files with SHA256SUMS:

    curl -s https://<same host>/sheet | shasum -a 256
    curl -s https://<same host>/sheet/sheet-data.json | shasum -a 256

They should print:

    99d40043a83394786072169f52b1b4a2b2f4de04baba0f917828aa7322adb847  sheet/index.html
    1fa2120e2133d16610db3a3542b958971a16d0785188ff5a42bc60138a283120  sheet/sheet-data.json

The daily check compares both of these with the live server too.
