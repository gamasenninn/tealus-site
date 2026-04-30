#!/usr/bin/env node
/**
 * Pitch markdown を slide 単位に分割し、TTS 用 narration テキストを抽出する。
 *
 * 入力: $TEALUS_REPO/docs/presentation/full-pitch-oss-adopters.md
 *      (デフォルト: C:/app/tealus)
 * 出力: pitch/audio/narration.json
 *
 * 抽出方針:
 *   - --- (frontmatter / slide 区切り) で分割
 *   - HTML コメント (<!-- ... -->) は presenter note なので除外
 *   - markdown 装飾 (#, **, *, `, [...], 表, code block) を除去
 *   - 各 slide の本文を句点で区切ったプレーンテキストに変換
 */

const fs = require('fs');
const path = require('path');

const TEALUS_REPO = process.env.TEALUS_REPO || 'C:/app/tealus';
const SOURCE = path.join(TEALUS_REPO, 'docs/presentation/full-pitch-oss-adopters.md');
const OUT = path.join(__dirname, '..', 'pitch', 'audio', 'narration.json');

function stripMarkdown(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')                 // HTML コメント (speaker note)
    .replace(/```[\s\S]*?```/g, '')                  // code block
    .replace(/`([^`]+)`/g, '$1')                     // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')         // link → label のみ
    .replace(/\*\*([^*]+)\*\*/g, '$1')               // bold
    .replace(/\*([^*]+)\*/g, '$1')                   // italic
    .replace(/^#{1,6}\s+/gm, '')                     // heading marker
    .replace(/^[-*]\s+/gm, '')                       // bullet marker
    .replace(/^\|.*\|$/gm, '')                       // table 行を除外
    .replace(/^\s*\|[-:|\s]+\|\s*$/gm, '')           // table separator
    .replace(/https?:\/\/\S+/g, '')                  // URL (読み上げ不要)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}]/gu, '') // emoji 全般
    .replace(/[→←↑↓]/g, '')                          // 矢印 (読み上げ不要)
    .replace(/[（(]\s*[）)]/g, '');                   // 中身が消えた空 paren を除去
}

function toNarration(raw) {
  const cleaned = stripMarkdown(raw);
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return lines
    .map(l => l.replace(/[。、]+$/, ''))              // 末尾句読点を一旦取る
    .map(l => l + '。')                               // 句点で締める
    .join(' ');
}

function main() {
  const md = fs.readFileSync(SOURCE, 'utf8');
  const sections = md.split(/^---\s*$/m);
  // sections[0] = "" (BOF before opening ---)
  // sections[1] = YAML frontmatter (marp: true, theme: default, ...)
  // sections[2..] = 各 slide
  const slides = [];
  sections.slice(2).forEach((sec) => {
    const text = toNarration(sec);
    if (text) slides.push(text);
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    source: 'full-pitch-oss-adopters.md',
    generated_at: new Date().toISOString(),
    slides,
  }, null, 2));
  console.log(`Wrote ${slides.length} slides to ${OUT}`);
  slides.forEach((s, i) => {
    console.log(`  [${i + 1}] (${s.length} chars) ${s.substring(0, 60).replace(/\n/g, ' ')}...`);
  });
}

main();
