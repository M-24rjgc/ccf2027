import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureSite,DEMO_QUESTION} from '../promo/security.mjs';

test('demo recording accepts only the local preview or the published app',()=>{
 assert.equal(captureSite('http://localhost:8765/'),'http://localhost:8765');
 assert.equal(captureSite('https://m-24rjgc.github.io/ccf2027/'),'https://m-24rjgc.github.io/ccf2027');
 for(const url of ['https://evil.test','https://m-24rjgc.github.io.evil.test/ccf2027','http://m-24rjgc.github.io/ccf2027','http://user:password@localhost:8765','http://localhost:8765?key=private','http://localhost:8765/#private'])assert.throws(()=>captureSite(url));
});

test('demo recording never reads or injects credentials and cannot record a private question argument',()=>{
 const code=readFileSync(new URL('../promo/capture-agent.mjs',import.meta.url),'utf8');
 assert.ok(!/readFileSync|STEP_API_KEY|DEEPSEEK_API_KEY|elements\.(?:stepKey|deepseekKey)\.value\s*=/.test(code));
 assert.ok(!/process\.argv\[2\]/.test(code));
 assert.match(code,/const QUESTION = DEMO_QUESTION/);
 assert.match(code,/elements\.mode\.value = 'shared'/);
 assert.match(DEMO_QUESTION,/会议/);
});
