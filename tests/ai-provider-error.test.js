const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeAIProviderError } = require('../lib/ai-provider-error')

test('actual JSON HTTP/2 provider failure is a transient interrupted response', () => {
  const payload = { error: { message: 'Upstream HTTP/2 stream failed', type: 'upstream_error', code: 'upstream_error' } }
  const error = normalizeAIProviderError(payload, { status: 200, providerLabel: 'AI' })
  assert.equal(error.code, 'AI_RESPONSE_INTERRUPTED')
  assert.equal(error.status, 200)
  assert.equal(error.providerCode, 'upstream_error')
  assert.equal(error.cause, payload)
  assert.match(error.message, /连接中断/)
  assert.equal(error.message.includes('HTTP/2'), false)
})

test('SSE error envelopes and top-level messages share the same classification', () => {
  for (const payload of [
    { type: 'error', error: { message: 'Upstream HTTP/2 stream failed' } },
    { type: 'error', message: 'Upstream HTTP/2 stream failed', code: 'upstream_error' },
    { error: 'Upstream HTTP/2 stream failed' },
    { message: 'upstream request timed out' }
  ]) assert.equal(normalizeAIProviderError(payload, { status: 200 }).code, 'AI_RESPONSE_INTERRUPTED')
})

test('known connection resets, terminated streams and upstream timeouts are recoverable', () => {
  for (const message of ['Connection reset by peer', 'The stream was terminated', 'terminated', 'upstream timeout', 'gateway read timed out', 'Unexpected EOF', 'Upstream prematurely closed connection']) {
    assert.equal(normalizeAIProviderError(new Error(message)).code, 'AI_RESPONSE_INTERRUPTED', message)
  }
  const inner = Object.assign(new Error('socket failure'), { code: 'ECONNRESET' })
  const outer = new TypeError('fetch failed', { cause: inner })
  assert.equal(normalizeAIProviderError(outer).code, 'AI_RESPONSE_INTERRUPTED')
})

test('known HTTP/2 and undici transport codes classify without relying on vague messages', () => {
  for (const code of ['ERR_HTTP2_STREAM_ERROR', 'ERR_HTTP2_GOAWAY_SESSION', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'upstream_timeout']) {
    const error = normalizeAIProviderError({ error: { code, message: 'request failed' } })
    assert.equal(error.code, 'AI_RESPONSE_INTERRUPTED')
    assert.equal(error.providerCode, code)
  }
})

test('authentication errors override incidental transport language', () => {
  for (const payload of [
    { error: { code: 'invalid_api_key', message: 'Upstream HTTP/2 stream failed: invalid API key' } },
    { error: { message: 'invalid credentials' } },
    { error: { message: '鉴权失败，密钥已过期' } }
  ]) assert.equal(normalizeAIProviderError(payload).code, 'AI_PROVIDER_AUTH')
  assert.equal(normalizeAIProviderError({ message: 'Upstream HTTP/2 stream failed' }, { status: 403 }).code, 'AI_PROVIDER_AUTH')
})

test('exhausted quota is permanent even when the HTTP transport status is 429', () => {
  for (const payload of [
    { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } },
    { error: { code: 'insufficient_balance', message: '余额不足' } },
    { error: { message: 'Credit balance is too low; quota exhausted' } }
  ]) assert.equal(normalizeAIProviderError(payload, { status: 429 }).code, 'AI_PROVIDER_QUOTA')
})

test('rate limits and explicit overload are distinguished from exhausted quota', () => {
  for (const payload of [
    { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached for requests' } },
    { type: 'error', error: { type: 'overloaded_error', message: 'Server overloaded' } },
    { message: 'Too many requests' }
  ]) assert.equal(normalizeAIProviderError(payload).code, 'AI_PROVIDER_BUSY')
  assert.equal(normalizeAIProviderError({}, { status: 429 }).code, 'AI_PROVIDER_BUSY')
})

test('bad requests, unsupported models and refusals never enter transient recovery', () => {
  for (const code of ['invalid_request_error', 'model_not_found', 'context_length_exceeded', 'invalid_image']) {
    assert.equal(normalizeAIProviderError({ error: { code, message: 'request failed' } }).code, 'AI_PROVIDER_BAD_REQUEST')
  }
  assert.equal(normalizeAIProviderError({ message: 'Upstream HTTP/2 stream failed' }, { status: 400 }).code, 'AI_PROVIDER_BAD_REQUEST')
  for (const code of ['content_filter', 'content_policy_violation', 'refusal']) {
    assert.equal(normalizeAIProviderError({ error: { code, message: 'request refused' } }).code, 'AI_PROVIDER_REFUSAL')
  }
})

test('vague error, failed and 500 alone are never treated as transient transport failures', () => {
  for (const payload of [{ error: { message: 'error' } }, { message: 'failed' }, { error: { code: 500, message: 'Internal server error' } }, { message: 'Something failed while processing data' }]) {
    assert.equal(normalizeAIProviderError(payload, { status: 500 }).code, 'AI_PROVIDER_ERROR')
  }
})

test('outer HTTP status and structured upstream status/code are both retained', () => {
  const error = normalizeAIProviderError({ error: { status: 502, code: 'upstream_error', message: 'Upstream HTTP/2 stream failed' } }, { status: 200 })
  assert.equal(error.status, 200)
  assert.equal(error.upstreamStatus, 502)
  assert.equal(error.providerCode, 'upstream_error')
})

test('HTML, bearer tokens and API keys never appear in user messages or public metadata', () => {
  const original = { error: { code: 'sk-live-sensitive-key', message: '<html>Upstream HTTP/2 stream failed: Authorization: Bearer sk-live-sensitive-key</html>' } }
  const error = normalizeAIProviderError(original, { status: 200, providerLabel: '<script>secret</script>' })
  assert.equal(error.code, 'AI_RESPONSE_INTERRUPTED')
  assert.equal(error.providerCode, undefined)
  assert.equal(error.cause, original)
  assert.equal(/html|script|bearer|sk-live|sensitive/i.test(error.message), false)
  assert.equal(/html|script|bearer|sk-live|sensitive/i.test(JSON.stringify(error)), false)
})

test('explicit caller cancellation is preserved and never classified as transient', () => {
  const original = new DOMException('Upstream HTTP/2 stream failed', 'AbortError')
  const error = normalizeAIProviderError(original)
  assert.equal(error.name, 'AbortError')
  assert.equal(error.code, 'AI_PROVIDER_ERROR')
  assert.equal(error.cause, original)
  assert.match(error.message, /取消/)
})

test('cyclic causes and missing envelopes are handled without leaking raw values', () => {
  const original = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
  original.cause = original
  assert.equal(normalizeAIProviderError(original).code, 'AI_RESPONSE_INTERRUPTED')
  for (const value of [undefined, null, {}, 500]) {
    assert.equal(normalizeAIProviderError(value).code, 'AI_PROVIDER_ERROR')
  }
})

test('normalization is stable when a previously classified provider error is received', () => {
  const first = normalizeAIProviderError({ error: { message: 'Upstream HTTP/2 stream failed' } })
  const second = normalizeAIProviderError(first)
  assert.equal(second.code, 'AI_RESPONSE_INTERRUPTED')
  assert.match(second.message, /连接中断/)
})

test('non-stream compatibility is recommended only for explicit HTTP/2 stream failures', () => {
  for (const payload of [
    { error: { message: 'Upstream HTTP/2 stream failed' } },
    { error: { message: 'HTTP2 stream closed unexpectedly' } },
    Object.assign(new Error('provider stream ended'), { code: 'ERR_HTTP2_STREAM_ERROR' })
  ]) assert.equal(normalizeAIProviderError(payload).streamFallbackRecommended, true)
  for (const payload of [
    { message: 'connection reset by peer' },
    { message: 'upstream timeout' },
    { message: 'failed' },
    { error: { code: 'invalid_api_key', message: 'Upstream HTTP/2 stream failed: invalid API key' } }
  ]) assert.notEqual(normalizeAIProviderError(payload).streamFallbackRecommended, true)
})

test('Responses failed envelopes preserve the nested provider code and transport meaning', () => {
  const payload = { type: 'response.failed', response: { status: 'failed', error: { code: 'upstream_error', message: 'Upstream HTTP/2 stream failed' } } }
  const error = normalizeAIProviderError(payload, { status: 200 })
  assert.equal(error.code, 'AI_RESPONSE_INTERRUPTED')
  assert.equal(error.providerCode, 'upstream_error')
  assert.equal(error.streamFallbackRecommended, true)
})

test('explicit rate-limit codes distinguish per-minute quotas from exhausted account balance', () => {
  const rate = normalizeAIProviderError({ error: { code: 'rate_limit_exceeded', message: 'Per-minute request quota exceeded' } }, { status: 429 })
  assert.equal(rate.code, 'AI_PROVIDER_BUSY')
  const quota = normalizeAIProviderError({ error: { message: 'Your credit balance is too low to access the API' } })
  assert.equal(quota.code, 'AI_PROVIDER_QUOTA')
})
