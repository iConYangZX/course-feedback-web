const test = require('node:test')
const assert = require('node:assert/strict')
const { AIResultCache } = require('../lib/ai-result-cache')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('successful summaries are reused without calling the provider again', async () => {
  const cache = new AIResultCache()
  let calls = 0
  const factory = () => { calls += 1; return '同一课件摘要' }
  assert.equal(await cache.getOrCreate('scoped-content-hash', factory), '同一课件摘要')
  assert.equal(await cache.getOrCreate('scoped-content-hash', factory), '同一课件摘要')
  assert.equal(calls, 1)
})

test('simultaneous requests for the same key share the exact in-flight promise', async () => {
  const cache = new AIResultCache()
  const waiting = deferred()
  let calls = 0
  const first = cache.getOrCreate('same', () => { calls += 1; return waiting.promise })
  const second = cache.getOrCreate('same', () => { throw new Error('must not start duplicate work') })
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  waiting.resolve('完成')
  assert.deepEqual(await Promise.all([first, second]), ['完成', '完成'])
})

test('different user or content keys do not share summaries', async () => {
  const cache = new AIResultCache()
  assert.equal(await cache.getOrCreate('user-a-content', () => '甲的摘要'), '甲的摘要')
  assert.equal(await cache.getOrCreate('user-b-content', () => '乙的摘要'), '乙的摘要')
  assert.equal(await cache.getOrCreate('user-a-changed-content', () => '新课件摘要'), '新课件摘要')
})

test('the 30-minute TTL starts when a long summary succeeds, and refreshes after regeneration', async () => {
  let now = 0
  const cache = new AIResultCache({ now: () => now })
  const waiting = deferred()
  const pending = cache.getOrCreate('long-job', () => waiting.promise)
  now = 40 * 60 * 1000
  waiting.resolve('第一版')
  await pending
  now += 29 * 60 * 1000
  assert.equal(await cache.getOrCreate('long-job', () => '不应调用'), '第一版')
  now += 60 * 1000
  assert.equal(await cache.getOrCreate('long-job', () => '第二版'), '第二版')
  now += 29 * 60 * 1000
  assert.equal(await cache.getOrCreate('long-job', () => '不应调用'), '第二版')
})

test('entry limit evicts the least recently used completed summary', async () => {
  const cache = new AIResultCache({ maxEntries: 2 })
  await cache.getOrCreate('a', () => 'A')
  await cache.getOrCreate('b', () => 'B')
  await cache.getOrCreate('a', () => 'should not replace A')
  await cache.getOrCreate('c', () => 'C')
  assert.equal(await cache.getOrCreate('a', () => 'missing A'), 'A')
  assert.equal(await cache.getOrCreate('b', () => 'new B'), 'new B')
})

test('total character limit evicts old summaries and never retains an oversized result', async () => {
  const cache = new AIResultCache({ maxTotalChars: 6 })
  await cache.getOrCreate('a', () => '甲乙丙')
  await cache.getOrCreate('b', () => '丁戊己')
  await cache.getOrCreate('c', () => '庚辛')
  assert.equal(await cache.getOrCreate('b', () => 'missing'), '丁戊己')
  assert.equal(await cache.getOrCreate('a', () => 'new'), 'new')
  let largeCalls = 0
  const large = () => { largeCalls += 1; return '1234567' }
  assert.equal(await cache.getOrCreate('large', large), '1234567')
  assert.equal(await cache.getOrCreate('large', large), '1234567')
  assert.equal(largeCalls, 2)
})

test('rejections and synchronous factory failures are removed so a retry can succeed', async () => {
  const cache = new AIResultCache()
  await assert.rejects(cache.getOrCreate('retry', () => { throw new Error('HTTP 524') }), /524/)
  assert.equal(await cache.getOrCreate('retry', () => '成功'), '成功')
  const waiting = deferred()
  const one = cache.getOrCreate('shared-failure', () => waiting.promise)
  const two = cache.getOrCreate('shared-failure', () => 'unexpected')
  waiting.reject(new Error('断开'))
  const settled = await Promise.allSettled([one, two])
  assert.ok(settled.every((result) => result.status === 'rejected'))
  assert.equal(await cache.getOrCreate('shared-failure', () => '重新分析成功'), '重新分析成功')
})

test('empty and non-string responses are never cached', async () => {
  const cache = new AIResultCache()
  for (const value of ['', '  ', null, { summary: 'unvalidated' }]) {
    await assert.rejects(cache.getOrCreate('empty', () => value), /未返回有效文本/)
  }
  assert.equal(await cache.getOrCreate('empty', () => '有效'), '有效')
})

test('clear removes completed data and prevents old in-flight work from refilling the cache', async () => {
  const cache = new AIResultCache()
  await cache.getOrCreate('complete', () => '旧摘要')
  const old = deferred()
  const pending = cache.getOrCreate('pending', () => old.promise)
  cache.clear()
  assert.equal(await cache.getOrCreate('complete', () => '新摘要'), '新摘要')
  assert.equal(await cache.getOrCreate('pending', () => '清理后的结果'), '清理后的结果')
  old.resolve('旧在途结果')
  assert.equal(await pending, '旧在途结果')
  assert.equal(await cache.getOrCreate('pending', () => '不应覆盖'), '清理后的结果')
})

test('completed-entry eviction does not discard an unrelated in-flight shared request', async () => {
  const cache = new AIResultCache({ maxEntries: 1 })
  const work = deferred()
  const pending = cache.getOrCreate('waiting', () => work.promise)
  await cache.getOrCreate('one', () => '一')
  await cache.getOrCreate('two', () => '二')
  assert.equal(cache.getOrCreate('waiting', () => 'duplicate'), pending)
  work.resolve('完成')
  assert.equal(await pending, '完成')
})

test('invalid settings fail early and a zero capacity disables completed caching', async () => {
  assert.throws(() => new AIResultCache({ maxEntries: -1 }), /non-negative/)
  assert.throws(() => new AIResultCache({ ttlMs: Infinity }), /non-negative/)
  const cache = new AIResultCache({ maxEntries: 0 })
  assert.equal(await cache.getOrCreate('disabled', () => '第一次'), '第一次')
  assert.equal(await cache.getOrCreate('disabled', () => '第二次'), '第二次')
})
