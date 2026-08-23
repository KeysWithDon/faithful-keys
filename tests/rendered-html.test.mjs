import assert from "node:assert/strict";
import test from "node:test";

async function render(){
  const workerUrl=new URL("../dist/server/index.js",import.meta.url);workerUrl.searchParams.set("test",`${process.pid}-${Date.now()}`);
  const {default:worker}=await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/",{headers:{accept:"text/html"}}),{ASSETS:{fetch:async()=>new Response("Not found",{status:404})}},{waitUntil(){},passThroughOnException(){}});
}

test("server-renders the complete Faithful Keys teaching workspace",async()=>{
  const response=await render();assert.equal(response.status,200);assert.match(response.headers.get("content-type")??"",/^text\/html\b/i);
  const html=await response.text();
  assert.match(html,/<title>Faithful Keys — Chord Progression Maker &amp; Voicing Teacher<\/title>/);
  assert.match(html,/Faithful Keys/);assert.match(html,/Psalm 150:3–5/);assert.match(html,/Praise Him with/);
  assert.match(html,/Common progressions/);assert.match(html,/Resolution lab/);assert.match(html,/Circle warm-up/);assert.match(html,/Jazz standards/);assert.match(html,/Gospel standards/);
  assert.doesNotMatch(html,/Target practice|Workshop|AI chart reader|Song Analyzer|Song analyzer|Admin publishing|Administrator access|Arpeggiate|Block chords/);
  assert.match(html,/Adjust controls/);
  assert.match(html,/Cadence soft EP/);assert.match(html,/Grand piano/);
  assert.doesNotMatch(html,/Wurlitzer|B3 organ|drawbar_organ|Rhodes|electric_piano_1/);
  assert.doesNotMatch(html,/Why this works|Why this movement works/);
  assert.match(html,/aria-label="Switch to dark mode"/);assert.match(html,/aria-label="Enter full screen"/);
  assert.doesNotMatch(html,/>Studio<|>Learn<|>Library</);
  assert.match(html,/Play whole progression/);assert.match(html,/Hear.*voicing.*bass/);
  assert.doesNotMatch(html,/codex-preview|Building your site|react-loading-skeleton/);
});
