// The AME's page. Reads the key from the #fragment (never sent to the server), removes it from the address bar,
// shows the expiry, and on the Download click fetches the encrypted file straight from storage and decrypts it here.
// The PMGL decryptor (shared/pmgl.mjs) is inlined above this script at build time.
(async () => {
  const $ = (id) => document.getElementById(id);
  const show = (id) => { for (const s of document.querySelectorAll("section")) s.hidden = s.id !== id; $("resource").hidden = id !== "ready"; };
  const frag = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  // "#<id>.<key>", or "#<id>.<key>.c" when the pilot also gave the AME a 6-digit code (it never goes in the link).
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(\.c)?$/.exec(frag);
  if (!m) return show("incomplete");
  const [, id, k, hasCode] = m;
  const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

  let info;
  try {
    const r = await fetch(`/v1/links/${id}/info`, { cache: "no-store" });
    if (!r.ok) return show(r.status === 410 ? "gone" : "error");
    info = await r.json();
  } catch { return show("error"); }
  const short = { year: "numeric", month: "short", day: "numeric" };
  const exp = new Date(info.expiresAt);
  $("expires").textContent = exp.toLocaleDateString(undefined, short);
  $("sent").textContent = new Date(info.sentAt).toLocaleDateString(undefined, short);   // the viewer's own time zone
  $("filename").replaceChildren("Pilot medical records ", Object.assign(document.createElement("span"), { className: "nowrap", textContent: `${info.sentDay}.pdf` }));
  const kb = Math.round(info.size / 1e3);
  if (info.size > 0) $("sizepart").textContent = `, about ${kb < 1000 ? `${Math.max(1, kb)} KB` : `${(info.size / 1e6).toFixed(1)} MB`}`;
  // Ask for the code when the link says so, or when the server says so (an email program may have cut the ".c").
  const needsCode = !!hasCode || info.needsCode === true;
  $("codebox").hidden = !needsCode;
  document.querySelector(".noaccount").hidden = needsCode;
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("download").disabled) $("download").click(); });
  show("ready");

  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  $("download").addEventListener("click", async () => {
    const button = $("download"), progress = $("progress");
    const meter = $("meter"), fill = $("meter-fill");
    // With a code: the file key and the server's verifier both come from the link key and the code (shared/pmgl.mjs).
    // Only the verifier is sent; the code and the key stay on this page.
    let rawKey = fromB64url(k), req = { method: "POST", cache: "no-store" };
    if (needsCode) {
      const code = $("code").value.replace(/\s/g, "");
      $("codeerr").textContent = "";
      if (!/^[0-9]{6}$/.test(code)) { $("codeerr").textContent = "Enter the 6-digit code from the pilot."; return $("code").focus(); }
      const keys = await pmglCodeKeys(rawKey, code);
      rawKey = keys.fileKey;
      req = { ...req, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verifier: keys.verifier }) };
    }
    button.disabled = true;
    progress.className = "progress";
    progress.textContent = "Downloading...";
    fill.style.width = "0%";
    meter.hidden = false;
    let got = 0;
    try {
      const r = await fetch(`/v1/links/${id}/download`, req);
      if (r.status === 403 && needsCode) {
        const left = Number((await r.json().catch(() => ({}))).left);
        if (!(left > 0)) return show("locked");
        meter.hidden = true;
        progress.textContent = "";
        button.disabled = false;
        $("codeerr").textContent = `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.`;
        return $("code").focus();
      }
      if (r.status === 429) return show("limit");
      if (!r.ok) return show(r.status === 410 ? "gone" : "error");
      const { url } = await r.json();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok || !res.body) throw new Error("fetch");

      const dec = new PmglDecryptor(await pmglImportKey(rawKey));
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
        got += value.length;
        if (info.size > 0) fill.style.width = `${Math.min(100, Math.round((got / info.size) * 100))}%`;
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
      fill.style.width = "100%";
      progress.className = "progress done";
      progress.textContent = "Downloaded. Look in your Downloads folder.";
      button.disabled = false;
    } catch (e) {
      show(e && e.message === "notpdf" ? "notpdf" : "error");
    }
  });
})();
