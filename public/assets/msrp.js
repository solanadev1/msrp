/* MSRP: progressive enhancement only; every page works without it. "/" focuses search, paste opens,
   copy buttons, links open "details", the highlighter (wallets + linked wallets, graph included), waiting page. */
(function () {
  "use strict";
  var d = document;
  var B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  function all(sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); }
  function up(el, sel) { return el && el.closest ? el.closest(sel) : null; }

  /* "/" jumps to the address field. */
  var q = d.getElementById("q");
  d.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || !q) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    e.preventDefault();
    q.focus();
    q.select();
  });

  /* Pasting a valid address opens it right away. */
  if (q) {
    q.addEventListener("paste", function () {
      setTimeout(function () {
        var v = q.value.trim();
        if (B58.test(v) && q.form) { q.value = v; q.form.submit(); }
      }, 0);
    });
  }

  /* Links into a closed <details> open it first, so "#holders" or "#tree" always lands. */
  function reveal(id) {
    var el = id && d.getElementById(id);
    if (!el) return;
    for (var p = el; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
    el.scrollIntoView({ block: "start" });
  }
  d.addEventListener("click", function (e) {
    var a = up(e.target, 'a[href^="#"]');
    if (!a) return;
    var id = decodeURIComponent(a.getAttribute("href").slice(1));
    if (!d.getElementById(id)) return;
    e.preventDefault();
    if (history.pushState) history.pushState(null, "", "#" + id);
    reveal(id);
  });
  if (location.hash) reveal(decodeURIComponent(location.hash.slice(1)));

  /* Copy buttons: data-copy="text" or data-copy-from="id-of-field". Hidden until this script runs. */
  all("[data-copy],[data-copy-from]").forEach(function (b) { b.hidden = false; });
  function copied(btn, ok) {
    var old = btn.getAttribute("data-label") || btn.textContent;
    btn.setAttribute("data-label", old);
    btn.textContent = ok ? "copied" : "press ctrl+c";
    setTimeout(function () { btn.textContent = old; }, 1600);
  }
  d.addEventListener("click", function (e) {
    var btn = up(e.target, "[data-copy],[data-copy-from]");
    if (!btn) return;
    var text = btn.getAttribute("data-copy"), from = btn.getAttribute("data-copy-from");
    if (from) { var f = d.getElementById(from); text = f ? f.value || f.textContent : ""; if (f && f.select) f.select(); }
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { copied(btn, true); }, function () { copied(btn, false); });
    } else copied(btn, false);
  });

  /* Highlighter: data-w = the wallet, data-g = linked groups (same funder, same cluster). */
  var index = {}, lit = [];
  function keys(el) {
    var k = ["w:" + el.getAttribute("data-w")], g = el.getAttribute("data-g");
    return g ? k.concat(g.split(" ")) : k;
  }
  all("[data-w]").forEach(function (el) {
    keys(el).forEach(function (k) { (index[k] = index[k] || []).push(el); });
  });
  function mark(el) {
    if (el.classList.contains("hl")) return;
    el.classList.add("hl");
    lit.push(el);
  }
  function clear() { lit.forEach(function (el) { el.classList.remove("hl"); }); lit = []; }
  function light(el) {
    clear();
    keys(el).forEach(function (k) {
      (index[k] || []).forEach(function (x) { mark(x); var row = up(x, "tr"); if (row) mark(row); });
    });
  }
  d.addEventListener("mouseover", function (e) { var el = up(e.target, "[data-w]"); if (el) light(el); });
  d.addEventListener("mouseout", function (e) {
    var el = up(e.target, "[data-w]");
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) clear();
  });
  d.addEventListener("focusin", function (e) { var el = up(e.target, "[data-w]"); if (el) light(el); else clear(); });
  d.addEventListener("keydown", function (e) { if (e.key === "Escape") clear(); });

  /* Waiting page: ask the API for the sticker, tick the steps off, then open it. */
  var wait = d.getElementById("wait");
  if (wait && window.fetch) {
    var api = wait.getAttribute("data-api"), next = wait.getAttribute("data-next");
    var status = d.getElementById("wait-status"), error = d.getElementById("wait-error");
    var t0 = Date.now(), tries = 0;
    var secs = function () { return Math.round((Date.now() - t0) / 1000); };
    var timer = setInterval(function () { status.textContent = "reading the chain · " + secs() + "s"; }, 1000);
    var fail = function (msg) {
      clearInterval(timer);
      status.textContent = "stopped after " + secs() + "s";
      error.textContent = msg;
      error.hidden = false;
    };
    var done = function () {
      clearInterval(timer);
      var marks = all(".steps .ok", wait), i = 0;
      (function tick() {
        if (i < marks.length) { marks[i].textContent = "ok"; marks[i++].className = "ok done"; setTimeout(tick, 160); return; }
        status.textContent = "done · " + secs() + "s";
        location.replace(next);
      })();
    };
    var oops = function (r) { fail("something went wrong (" + r.status + ") · reload to try again"); };
    var poll = function () {
      tries++;
      fetch(api, { headers: { accept: "application/json" }, cache: "no-store" }).then(function (r) {
        return r.json().then(function (j) {
          if (r.ok && j && !j.error) done();
          else if (j && j.error) fail(String(j.error));
          else oops(r);
        }, function () { oops(r); });
      }, function () {
        if (tries < 3) setTimeout(poll, 3000);
        else fail("couldn't reach msrp · check your connection and reload");
      });
    };
    poll();
  }
})();
