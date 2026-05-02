#!/usr/bin/env node
/**
 * deck.html (Marp Bespoke 出力) に audio narration controller を注入する。
 *
 * - 既に注入済 (MARKER 検出) の場合は再 inject (置換) する → 冪等
 * - 注入位置: </body> 直前
 *
 * controller の挙動:
 *   - top-left に固定 widget (▶ 再生 / 速度 / slide N/M 表示)
 *   - URL hash (#N) を主検出法、class 系を fallback に slide 切替を検知
 *   - active slide が変わったら対応 audio を再生
 *   - audio ended で次 slide へ自動進行
 *
 * Flags:
 *   --pitch <name>  pitch サブディレクトリ名 (例: --pitch field → pitch/field/deck.html)
 *                   未指定なら pitch/deck.html (Audience 1 デフォルト)
 *
 * Debug:
 *   ?debug クエリパラメータを付けると console.log が有効になる
 *   例: /pitch/deck.html?debug
 */

const fs = require('fs');
const path = require('path');

function getPitchSub(argv) {
  const i = argv.indexOf('--pitch');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}
const PITCH_SUB = getPitchSub(process.argv.slice(2));
const PITCH_DIR = PITCH_SUB ? path.join('pitch', PITCH_SUB) : 'pitch';
const DECK = path.join(__dirname, '..', PITCH_DIR, 'deck.html');
const NARRATION = path.join(__dirname, '..', PITCH_DIR, 'audio', 'narration.json');

const MARKER_BEGIN = '<!-- NARRATION-CONTROLLER:BEGIN -->';
const MARKER_END = '<!-- NARRATION-CONTROLLER:END -->';

const TOTAL = JSON.parse(fs.readFileSync(NARRATION, 'utf8')).slides.length;

const PAYLOAD = `${MARKER_BEGIN}
<style>
  #narration-controls {
    position: fixed; top: 10px; left: 10px; z-index: 10000;
    background: rgba(0,0,0,0.72); color: #fff;
    padding: 6px 10px; border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    display: flex; gap: 8px; align-items: center;
    backdrop-filter: blur(4px);
    user-select: none;
  }
  #narration-controls button, #narration-controls select {
    background: transparent; border: 1px solid rgba(255,255,255,0.35);
    color: #fff; padding: 3px 9px; border-radius: 4px;
    cursor: pointer; font-size: 12px;
  }
  #narration-controls button:hover { background: rgba(255,255,255,0.1); }
  #narration-controls label { display: flex; gap: 3px; align-items: center; opacity: 0.85; }
  #nar-status { opacity: 0.7; min-width: 70px; }
  #narration-controls[data-state="on"] #nar-toggle { background: rgba(0, 180, 160, 0.4); }
</style>
<div id="narration-controls" data-state="off">
  <button id="nar-toggle" title="ナレーション再生/停止">▶ ナレーション</button>
  <label>速度
    <select id="nar-speed">
      <option value="0.9">0.9x</option>
      <option value="1" selected>1x</option>
      <option value="1.25">1.25x</option>
      <option value="1.5">1.5x</option>
      <option value="2">2x</option>
    </select>
  </label>
  <span id="nar-status">slide 1 / ${TOTAL}</span>
</div>
<script>
(function () {
  var TOTAL = ${TOTAL};
  var DEBUG = (window.location.search || '').indexOf('debug') >= 0;
  function dbg() {
    if (!DEBUG) return;
    try { console.log.apply(console, arguments); } catch (e) {}
  }

  var sharedAudio = null;
  var currentIdx = -1;
  var enabled = false;
  var autoAdvance = true;
  var toggle = document.getElementById('nar-toggle');
  var speed = document.getElementById('nar-speed');
  var status = document.getElementById('nar-status');
  var box = document.getElementById('narration-controls');

  function setStatus(text) { status.textContent = text; }

  function getSlides() {
    return document.querySelectorAll('section[data-marpit-pagination]');
  }

  function getSharedAudio() {
    if (sharedAudio) return sharedAudio;
    sharedAudio = new Audio();
    sharedAudio.addEventListener('ended', function () {
      setStatus('slide ' + (currentIdx + 1) + ': ended');
      if (autoAdvance && enabled) advanceSlide();
    });
    sharedAudio.addEventListener('error', function () {
      setStatus('load err: slide ' + (currentIdx + 1));
    });
    return sharedAudio;
  }

  function pauseAll() {
    if (sharedAudio) { sharedAudio.pause(); sharedAudio.currentTime = 0; }
  }

  function playForCurrent() {
    if (!enabled) return;
    pauseAll();
    var idx = currentIdx >= 0 ? currentIdx : 0;
    var a = getSharedAudio();
    var num = ('00' + (idx + 1)).slice(-2);
    var newSrc = 'audio/slide-' + num + '.mp3';
    var sameSrc = a.src && a.src.indexOf(newSrc) !== -1;

    function doPlay() {
      a.currentTime = 0;
      a.playbackRate = parseFloat(speed.value);
      setStatus('slide ' + (idx + 1) + ': starting');
      var p = a.play();
      if (p && p.then) {
        p.then(function () {
          setStatus('slide ' + (idx + 1) + ': playing');
        }).catch(function (err) {
          setStatus('slide ' + (idx + 1) + ': play err ' + (err.name || 'unknown'));
        });
      }
    }

    if (sameSrc) { doPlay(); return; }

    setStatus('slide ' + (idx + 1) + ': loading');
    var onCanPlay = function () {
      a.removeEventListener('canplay', onCanPlay);
      a.removeEventListener('error', onErr);
      doPlay();
    };
    var onErr = function () {
      a.removeEventListener('canplay', onCanPlay);
      a.removeEventListener('error', onErr);
      setStatus('slide ' + (idx + 1) + ': load err');
    };
    a.addEventListener('canplay', onCanPlay);
    a.addEventListener('error', onErr);
    a.src = newSrc;
    a.load();
  }

  function manualNext() {
    var slides = getSlides();
    if (slides.length === 0) return false;
    var i = -1;
    for (var k = 0; k < slides.length; k++) {
      if (slides[k].classList.contains('bespoke-marp-active')) { i = k; break; }
    }
    if (i < 0) i = currentIdx >= 0 ? currentIdx : 0;
    if (i >= slides.length - 1) return false;
    for (var m = 0; m < slides.length; m++) {
      slides[m].classList.remove('bespoke-marp-active', 'bespoke-marp-active-ready');
      slides[m].classList.add('bespoke-marp-inactive');
    }
    slides[i + 1].classList.remove('bespoke-marp-inactive');
    slides[i + 1].classList.add('bespoke-marp-active');
    setTimeout(function () {
      slides[i + 1].classList.add('bespoke-marp-active-ready');
    }, 50);
    return true;
  }

  function advanceSlide() {
    var prev = currentIdx;
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39,
      bubbles: true, cancelable: true,
    }));
    setTimeout(function () {
      if (currentIdx === prev) manualNext();
    }, 600);
  }

  function updateStatus() {
    setStatus('slide ' + (currentIdx + 1) + ' / ' + TOTAL);
  }

  function findActiveByMethod() {
    var slides = getSlides();
    // Method C を最優先 (Marp bespoke-hash plugin が URL hash を更新)
    var hashMatch = (window.location.hash || '').match(/^#(\\d+)$/);
    if (hashMatch) {
      var hi = parseInt(hashMatch[1], 10) - 1;
      if (hi >= 0 && hi < slides.length) return { idx: hi, method: 'C' };
    }
    // Fallback: class 系 (実質使われていないが念のため)
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].classList.contains('bespoke-marp-active')) return { idx: i, method: 'A' };
    }
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].classList.contains('bespoke-marp-active-ready')) return { idx: i, method: 'B' };
    }
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].getAttribute('aria-hidden') === 'false') return { idx: i, method: 'D' };
    }
    return null;
  }

  function checkActive() {
    var found = findActiveByMethod();
    if (!found) {
      dbg('[narration] checkActive: no method found, hash=' + window.location.hash);
      return;
    }
    if (found.idx !== currentIdx) {
      var prev = currentIdx;
      currentIdx = found.idx;
      updateStatus();
      dbg('[narration] slide', currentIdx + 1, 'detected via method', found.method, '(was', prev + 1, ')');
      playForCurrent();
    }
  }

  function setupObserver() {
    var observer = new MutationObserver(checkActive);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
    checkActive();

    document.addEventListener('keydown', function (e) {
      var navKeys = [37, 38, 39, 40, 33, 34, 32, 36, 35, 13, 27];
      if (navKeys.indexOf(e.keyCode) >= 0) {
        setTimeout(checkActive, 100);
        setTimeout(checkActive, 400);
        setTimeout(checkActive, 900);
      }
    }, true);
    document.addEventListener('click', function () {
      setTimeout(checkActive, 100);
      setTimeout(checkActive, 500);
    }, true);
    window.addEventListener('hashchange', function () {
      setTimeout(checkActive, 50);
    });
    setInterval(function () {
      if (enabled) checkActive();
    }, 300);

    dbg('[narration] setupObserver done. hash polling 300ms. initial hash=' + window.location.hash);
  }

  toggle.addEventListener('click', function () {
    enabled = !enabled;
    toggle.textContent = enabled ? '⏸ ナレーション停止' : '▶ ナレーション';
    box.dataset.state = enabled ? 'on' : 'off';
    if (enabled) {
      checkActive();
      if (currentIdx < 0) { currentIdx = 0; updateStatus(); }
      playForCurrent();
    } else {
      pauseAll();
    }
  });

  speed.addEventListener('change', function () {
    if (sharedAudio) sharedAudio.playbackRate = parseFloat(speed.value);
  });

  function boot() {
    dbg('[narration] boot starting (DEBUG=' + DEBUG + ')');
    setTimeout(setupObserver, 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
</script>
${MARKER_END}`;

function main() {
  let html = fs.readFileSync(DECK, 'utf8');

  // 既存注入があれば剥がす (冪等)
  const re = new RegExp(MARKER_BEGIN + '[\\s\\S]*?' + MARKER_END, 'g');
  html = html.replace(re, '');

  // </body> 直前に挿入
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) {
    console.error('No </body> found in deck.html');
    process.exit(1);
  }
  html = html.slice(0, idx) + PAYLOAD + html.slice(idx);

  fs.writeFileSync(DECK, html);
  console.log(`Injected narration controller (TOTAL=${TOTAL}) into deck.html`);
}

main();
