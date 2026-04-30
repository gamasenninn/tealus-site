#!/usr/bin/env node
/**
 * deck.html (Marp Bespoke 出力) に audio narration controller を注入する。
 *
 * - 既に注入済 (MARKER 検出) の場合は再 inject (置換) する → 冪等
 * - 注入位置: </body> 直前
 *
 * controller の挙動:
 *   - top-left に固定 widget (▶ 再生 / 速度 / slide N/M 表示)
 *   - Bespoke の bespoke-marp-active class を MutationObserver で監視
 *   - active slide が変わったら対応 audio を再生
 *   - audio ended で ArrowRight key event を dispatch → 次 slide へ
 */

const fs = require('fs');
const path = require('path');

const DECK = path.join(__dirname, '..', 'pitch', 'deck.html');
const MARKER_BEGIN = '<!-- NARRATION-CONTROLLER:BEGIN -->';
const MARKER_END = '<!-- NARRATION-CONTROLLER:END -->';

// audio ファイル数を narration.json から取得
const NARRATION = path.join(__dirname, '..', 'pitch', 'audio', 'narration.json');
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
  <button id="nar-bgm" data-state="off" title="BGM オン/オフ">🔇 BGM</button>
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
  var BGM_VOLUME = 0.7;
  var sharedAudio = null;
  var bgm = null;
  var currentIdx = -1;
  var enabled = false;
  var autoAdvance = true;
  var toggle = document.getElementById('nar-toggle');
  var speed = document.getElementById('nar-speed');
  var status = document.getElementById('nar-status');
  var box = document.getElementById('narration-controls');

  function ensureBgm() {
    if (bgm) return bgm;
    bgm = new Audio('audio/bgm.mp3');
    bgm.loop = true;
    bgm.volume = BGM_VOLUME;
    return bgm;
  }

  function manualNext() {
    var slides = document.querySelectorAll('section');
    var i = -1;
    for (var k = 0; k < slides.length; k++) {
      if (slides[k].classList.contains('bespoke-marp-active')) { i = k; break; }
    }
    if (i < 0 || i >= slides.length - 1) return false;
    slides[i].classList.remove('bespoke-marp-active', 'bespoke-marp-active-ready');
    slides[i].classList.add('bespoke-marp-inactive');
    slides[i + 1].classList.remove('bespoke-marp-inactive');
    slides[i + 1].classList.add('bespoke-marp-active');
    setTimeout(function () {
      slides[i + 1].classList.add('bespoke-marp-active-ready');
    }, 50);
    return true;
  }

  function advanceSlide() {
    var prev = currentIdx;
    // 1) Bespoke の keys plugin 経由 (document 上で listen)
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39,
      bubbles: true, cancelable: true,
    }));
    // 2) 300ms 待って変化がなければ class 直接操作で fallback
    setTimeout(function () {
      if (currentIdx === prev) manualNext();
    }, 300);
  }

  function setStatus(text) { status.textContent = text; }

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

  function updateStatus() {
    status.textContent = 'slide ' + (currentIdx + 1) + ' / ' + TOTAL;
  }

  function checkActive() {
    var slides = document.querySelectorAll('section');
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].classList.contains('bespoke-marp-active')) {
        if (i !== currentIdx) {
          currentIdx = i;
          updateStatus();
          playForCurrent();
        }
        return;
      }
    }
  }

  function setupObserver() {
    // 個別 section に attach すると Bespoke が DOM 操作した場合に
    // 観測対象が外れる可能性。document.body の subtree を観測することで
    // section の class 変更を確実に拾う
    var observer = new MutationObserver(checkActive);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
    checkActive();
  }

  toggle.addEventListener('click', function () {
    enabled = !enabled;
    toggle.textContent = enabled ? '⏸ ナレーション停止' : '▶ ナレーション';
    box.dataset.state = enabled ? 'on' : 'off';
    if (enabled) {
      // Bespoke 初期化前なら slide 0 で起動
      checkActive();
      if (currentIdx < 0) { currentIdx = 0; updateStatus(); }
      // BGM は明示 OFF (user 集中フェーズ)。🎵 ボタンで明示 ON 時のみ再生
      playForCurrent();
    } else {
      pauseAll();
      if (bgm) bgm.pause();
    }
  });

  var bgmToggle = document.getElementById('nar-bgm');
  if (bgmToggle) {
    bgmToggle.addEventListener('click', function () {
      var b = ensureBgm();
      if (b.paused || b.muted) {
        b.muted = false;
        if (enabled && b.paused) { var p = b.play(); if (p && p.catch) p.catch(function () {}); }
        bgmToggle.dataset.state = 'on';
        bgmToggle.textContent = '🎵 BGM';
      } else {
        b.muted = true;
        bgmToggle.dataset.state = 'off';
        bgmToggle.textContent = '🔇 BGM';
      }
    });
  }

  speed.addEventListener('change', function () {
    if (sharedAudio) sharedAudio.playbackRate = parseFloat(speed.value);
  });

  // Bespoke が active class を付けるまで少し時間がかかるため、
  // DOMContentLoaded + 微小 delay で setup
  function boot() { setTimeout(setupObserver, 100); }
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
