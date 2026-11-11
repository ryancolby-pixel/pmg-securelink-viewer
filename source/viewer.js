// The AME's page. Reads the key from the #fragment (never sent to the server), removes it from the address bar,
// shows the expiry, and on the Download click fetches the encrypted file straight from storage and decrypts it here.
// The PMGL decryptor (shared/pmgl.mjs) is inlined above this script at build time.
(async () => {
  const $ = (id) => document.getElementById(id);
  const show = (id) => { for (const s of document.querySelectorAll("section")) s.hidden = s.id !== id; };
  const frag = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(frag);
  if (!m) return show("incomplete");
  const [, id, k] = m;
  const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

  let info;
  try {
    const r = await fetch(`/v1/links/${id}/info`, { cache: "no-store" });
    if (!r.ok) return show(r.status === 410 ? "gone" : "error");
    info = await r.json();
  } catch { return show("error"); }
  $("expires").textContent = new Date(info.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  show("ready");

  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  $("download").addEventListener("click", async () => {
    const button = $("download"), progress = $("progress");
    button.disabled = true;
    progress.textContent = "Downloading...";
    try {
      const r = await fetch(`/v1/links/${id}/download`, { method: "POST", cache: "no-store" });
      if (!r.ok) return show(r.status === 410 ? "gone" : "error");
      const { url } = await r.json();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok || !res.body) throw new Error("fetch");

      const dec = new PmglDecryptor(await pmglImportKey(fromB64url(k)));
      const parts = [];
      let checked = false;
      const keep = (p) => {
        if (!checked && p.length) {
          if (p.length < PDF.length || !PDF.every((x, i) => p[i] === x)) throw new Error("notpdf");
          checked = true;
        }
        parts.push(p);
      };
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const p of await dec.push(value)) keep(p);
      }
      keep(await dec.finish());
      if (!checked) throw new Error("notpdf");

      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(parts, { type: "application/pdf" }));
      a.download = `Pilot medical records ${info.sentDay}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      parts.length = 0;
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);   // don't keep the plaintext in memory longer than needed
      progress.textContent = "Downloaded. Look in your Downloads folder.";
      button.disabled = false;
    } catch (e) {
      show(e && e.message === "notpdf" ? "notpdf" : "error");
    }
  });
})();
