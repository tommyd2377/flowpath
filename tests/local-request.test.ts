import assert from 'node:assert/strict';
import test from 'node:test';
import { localRequest } from '../lib/local-request';

const origin = 'https://192.168.1.250:3210';
const environment = { NODE_ENV: 'development' as const, VOICE_DEV_ORIGIN: origin };
const request = (url = origin, headers: Record<string, string> = { origin: url }) =>
  new Request(`${url}/api/session`, { headers });

test('Wi-Fi access requires the exact private HTTPS origin and explicit development opt-in', () => {
  assert.equal(localRequest(request(), true, environment), true);
  assert.equal(localRequest(request(origin, {}), false, environment), true);
  assert.equal(localRequest(request('https://localhost:3210', { host: '192.168.1.250:3210', origin }), true, environment), true);
  for (const env of [{ NODE_ENV: 'development' as const }, { ...environment, NODE_ENV: 'test' as const },
    { ...environment, NODE_ENV: 'production' as const }, { ...environment, VERCEL: '1' }]) {
    assert.equal(localRequest(request(), true, env), false);
  }
  for (const url of ['http://192.168.1.250:3210', 'https://192.168.1.251:3210', 'https://192.168.1.250:3211']) {
    assert.equal(localRequest(request(url), true, environment), false);
  }
  for (const url of ['https://example.com', 'https://8.8.8.8', 'https://10.example.com', 'https://192.168.example.com']) {
    assert.equal(localRequest(request(url), true, { ...environment, VOICE_DEV_ORIGIN: url }), false);
  }
});

test('Wi-Fi access rejects missing or foreign mutation origins and mismatched hosts', () => {
  const rejectedHeaders: Record<string, string>[] = [{}, { origin: 'https://attacker.example' }, { origin, host: 'attacker.example' }];
  for (const headers of rejectedHeaders) {
    assert.equal(localRequest(request(origin, headers), true, environment), false);
  }
  assert.equal(localRequest(request('https://attacker.example', { origin, host: '192.168.1.250:3210' }), true, environment), false);
  assert.equal(localRequest(request(origin, { origin: 'https://attacker.example' }), false, environment), false);
});

test('loopback access remains available without the Wi-Fi option', () => {
  for (const url of ['http://localhost:3210', 'http://127.0.0.1:3210', 'https://localhost:3210']) {
    assert.equal(localRequest(request(url), true, { NODE_ENV: 'development' }), true);
  }
});
