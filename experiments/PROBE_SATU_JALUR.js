/**
 * PROBE_SATU_JALUR.js — kirim hasil sebagai SATU baris JSON (paling gampang disalin).
 * --------------------------------------------------------------------------------
 * Kenapa: output objek di console Chrome bersifat "collapsible" sehingga saat di-copy
 * menjadi terpotong. Versi ini menampilkan SEMUA hasil sebagai SATU BARIS teks
 * string mentah (bukan objek), jadi seluruhnya ikut tersalin sekaligus tanpa terpisah.
 *
 * Cara:
 *  1) Buka Flow -> project video.
 *  2) F12 -> Console -> ketik  allow pasting  (Enter).
 *  3) Tempel file ini seluruhnya -> Enter.
 *  4) Akan muncul SATU baris panjang mulai  HASIL_AWAL::  ...  ::HASIL_AKHIR.
 *  5) Klik kanan baris itu -> Copy (atau drag pilih atas-bawah) -> paste ke pi.
 *
 *  (Barisnya satu, panjang, tapi TIDAK terpotong — karena itu satu teks string.)
 */
(() => {
  const q = (s, r = document) => Array.from(r.querySelectorAll(s));
  const R = { fileImage: false, accepts: [], btnLabels: [], icons: 0, iconAria: '', drop: false, paste: false, filePos: '', url: location.href };

  // input file
  q('input[type="file"]').forEach((el) => {
    const ac = el.getAttribute('accept') || '';
    R.accepts.push(ac);
    if (/image/.test(ac)) R.fileImage = true;
    const r = el.getBoundingClientRect();
    if (r.width > 0) R.filePos = Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2);
  });

  // tombol ber-label
  const KW = ['add','upload','attach','image','foto','photo','gambar','referen','reference','tambah','lampir','paperclip','first frame','start image','ingredient'];
  q('[aria-label]').forEach((el) => {
    const t = ((el.getAttribute('aria-label')||'') + ' ' + (el.innerText||'')).toLowerCase();
    const hit = KW.filter((k) => t.includes(k));
    if (hit.length) R.btnLabels.push((el.getAttribute('aria-label')||el.innerText||'').trim().slice(0,30) + '[' + hit[0] + ']');
  });

  // tombol ber-icon svg
  q('button svg').forEach((svg) => {
    const d = (svg.innerHTML||'').toLowerCase();
    if (/image|photo|upload|attach|camera/.test(d)) {
      R.icons++;
      if (!R.iconAria) R.iconAria = (svg.closest('button').getAttribute('aria-label')||'(icon,no-label)') + ' ' + d.replace(/[^a-z0-9]+/g,' ').trim().slice(0,60);
    }
  });

  // react hooks
  q('body *').forEach((el) => {
    if (el.children.length > 20) return;
    const k = Object.keys(el).find((fk) => fk.startsWith('__reactProps$'));
    if (!k) return;
    if (el[k].onDrop) R.drop = true;
    if (el[k].onPaste) R.paste = true;
  });

  // satu baris string mentah
  const s = 'HASIL_AWAL:: ' + JSON.stringify(R) + ' ::HASIL_AKHIR';
  console.log(s);
  // auto copy utk jaga-jaga
  try { copy(s); console.log('(sudah di-copy otomatis ke clipboard — langsung Ctrl+V di pi)'); } catch (e) {}
})();
