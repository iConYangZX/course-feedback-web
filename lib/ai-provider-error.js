'use strict'

const AUTH_CODES = new Set(['ai_provider_auth', 'authentication_error', 'invalid_api_key', 'invalid_token', 'unauthorized', 'permission_denied', 'access_denied', 'account_deactivated', 'organization_deactivated'])
const QUOTA_CODES = new Set(['ai_provider_quota', 'insufficient_quota', 'insufficient_balance', 'insufficient_credits', 'insufficient_funds', 'quota_exceeded', 'billing_hard_limit_reached', 'credit_balance_too_low'])
const REFUSAL_CODES = new Set(['ai_provider_refusal', 'content_filter', 'content_policy_violation', 'safety_violation', 'refusal', 'request_refused', 'moderation_blocked'])
const BAD_REQUEST_CODES = new Set(['ai_provider_bad_request', 'bad_request', 'invalid_request', 'invalid_request_error', 'invalid_argument', 'invalid_parameter', 'unsupported_parameter', 'unsupported_value', 'unsupported_model', 'model_not_found', 'context_length_exceeded', 'max_context_length_exceeded', 'invalid_image', 'invalid_image_format'])
const BUSY_CODES = new Set(['ai_provider_busy', 'rate_limit_exceeded', 'rate_limit_error', 'ratelimit_error', 'rate_limited', 'too_many_requests', 'server_overloaded', 'overloaded', 'overloaded_error', 'capacity_exceeded', 'service_overloaded', 'engine_overloaded', 'service_unavailable'])
const INTERRUPTED_CODES = new Set(['ai_response_interrupted', 'econnreset', 'econnrefused', 'etimedout', 'epipe', 'eai_again', 'enetreset', 'und_err_socket', 'und_err_connect_timeout', 'und_err_headers_timeout', 'und_err_body_timeout', 'err_http2_stream_error', 'err_http2_stream_cancel', 'err_http2_goaway_session', 'err_http2_invalid_session', 'upstream_timeout', 'upstream_connection_error', 'request_timeout', 'connection_error', 'connection_reset'])

function httpStatus(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : undefined
}

function providerDetails(input) {
  const messages = []
  const codes = []
  const types = []
  const statuses = []
  const codeStatuses = []
  const seen = new Set()
  const visit = (value, depth = 0) => {
    if (depth > 5 || value == null) return
    if (typeof value === 'string') { messages.push(value.slice(0, 12000)); return }
    if (typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (typeof value.message === 'string') messages.push(value.message.slice(0, 12000))
    if (typeof value.code === 'string' || typeof value.code === 'number') codes.push(value.code)
    if (typeof value.type === 'string' && value.type !== 'error') types.push(value.type)
    for (const candidate of [value.status, value.statusCode, value.http_status]) {
      const status = httpStatus(candidate)
      if (status !== undefined) statuses.push(status)
    }
    const codeStatus = httpStatus(value.code)
    if (codeStatus !== undefined) codeStatuses.push(codeStatus)
    visit(value.error, depth + 1)
    visit(value.response, depth + 1)
    visit(value.cause, depth + 1)
  }
  visit(input)
  return { messages, codes: [...codes, ...types], statuses: [...statuses, ...codeStatuses] }
}

function safeProviderCode(code) {
  if (typeof code === 'number' && Number.isFinite(code)) return code
  if (typeof code !== 'string' || !/^[a-z0-9_.:-]{1,80}$/i.test(code)) return undefined
  if (/\b(?:sk|rk|sess|token|secret|key)-[a-z0-9]/i.test(code)) return undefined
  return code
}

function normalizeAIProviderError(input, { providerLabel = 'AI', status } = {}) {
  const label = typeof providerLabel === 'string' && /^[\p{L}\p{N} _-]{1,32}$/u.test(providerLabel)
    && !/\b(?:sk|rk|sess|token|secret|key)-[a-z0-9]/i.test(providerLabel) ? providerLabel : 'AI'
  const details = providerDetails(input)
  const message = details.messages.join('\n').toLowerCase()
  const codes = details.codes.map((code) => String(code).toLowerCase())
  const hasCode = (set) => codes.some((code) => set.has(code))
  const transportStatus = httpStatus(status)
  const upstreamStatus = details.statuses[0]
  const effectiveStatus = transportStatus !== undefined && transportStatus >= 400 ? transportStatus : upstreamStatus
  const http2StreamFailure = codes.some((value) => ['err_http2_stream_error', 'err_http2_stream_cancel'].includes(value))
    || /http\/?2\b[^.\n]{0,40}\bstream\b[^.\n]{0,30}\b(?:failed|reset|closed|terminated|interrupted|cancelled|canceled)\b/.test(message)
  let code = 'AI_PROVIDER_ERROR'
  let description = '服务未能完成请求，请稍后重试'

  // Explicit cancellation and permanent request errors take precedence over
  // incidental transport words in a provider's diagnostic message.
  if (input && input.name === 'AbortError') {
    description = '请求已取消'
  } else if (hasCode(QUOTA_CODES) || (!hasCode(BUSY_CODES) && /insufficient[ _-]*(?:quota|balance|credits?|funds)|(?:quota|credits?|balance).{0,40}(?:exceeded|exhausted|insufficient|depleted|too low|not enough)|(?:exceeded|exhausted).{0,40}(?:quota|credits?|balance)|billing[ _-]*hard[ _-]*limit|余额不足|额度不足|配额(?:已)?(?:耗尽|用尽)|欠费/.test(message))) {
    code = 'AI_PROVIDER_QUOTA'
    description = '服务额度不足，请联系管理员检查账户额度'
  } else if (hasCode(AUTH_CODES) || [401, 403].includes(effectiveStatus) || /invalid.{0,24}(?:api[ _-]?key|credentials|token)|(?:api[ _-]?key|token).{0,24}(?:invalid|expired)|authentication failed|unauthorized|not authorized|permission denied|认证失败|鉴权失败|(?:密钥|令牌).{0,12}(?:无效|失效|过期)/.test(message)) {
    code = 'AI_PROVIDER_AUTH'
    description = '服务认证失败，请联系管理员检查 API 配置'
  } else if (hasCode(REFUSAL_CODES) || /content[ _-]*(?:filter|policy)|safety[ _-]*(?:violation|policy)|(?:request|model).{0,12}(?:refused|refusal)|内容.{0,12}(?:被拒绝|被拦截)|安全策略/.test(message)) {
    code = 'AI_PROVIDER_REFUSAL'
    description = '服务未能处理此内容，请调整输入后重试'
  } else if (hasCode(BAD_REQUEST_CODES) || [400, 404, 405, 413, 415, 422].includes(effectiveStatus) || /invalid request|bad request|unsupported (?:parameter|model|image)|context length exceeded|参数.{0,8}(?:无效|错误)|不支持.{0,8}(?:参数|模型|图片)/.test(message)) {
    code = 'AI_PROVIDER_BAD_REQUEST'
    description = '请求参数或材料格式未被服务商接受，请联系管理员检查'
  } else if (hasCode(BUSY_CODES) || effectiveStatus === 429 || /rate[ _-]*limit|too many requests|server.{0,12}overloaded|temporarily overloaded|服务.{0,8}(?:繁忙|拥挤)|请求过于频繁/.test(message)) {
    code = 'AI_PROVIDER_BUSY'
    description = '服务当前繁忙，请稍后重试'
  } else if (hasCode(INTERRUPTED_CODES)
    || /http\/?2\b[^.\n]{0,60}\b(?:stream|connection)\b[^.\n]{0,30}\b(?:failed|reset|closed|terminated|interrupted|cancelled|canceled)\b/.test(message)
    || /\b(?:connection|socket|stream)\b[^.\n]{0,30}\b(?:reset|terminated|closed unexpectedly|closed prematurely|interrupted|disconnected)\b/.test(message)
    || /\b(?:upstream|gateway)\b[^.\n]{0,50}\b(?:timeout|timed out|connection reset|connection closed|disconnected)\b/.test(message)
    || /unexpected eof|premature end of (?:stream|response)|remote (?:server|peer).{0,12}(?:closed|disconnected)|upstream prematurely closed connection|\beconnreset\b|\bund_err_socket\b/.test(message)
    || details.messages.some((text) => /^terminated$/i.test(text.trim()))
    || /(?:上游|服务端|服务器).{0,16}(?:连接中断|连接重置|响应超时|请求超时)/.test(message)) {
    code = 'AI_RESPONSE_INTERRUPTED'
    description = '服务响应连接中断，请稍后重试'
  }

  // Never include raw provider text, HTML or credentials in the user-facing
  // message. Keep the original envelope only as the diagnostic cause.
  const error = new Error(`${label} ${description}`, { cause: input })
  error.code = code
  if (code === 'AI_RESPONSE_INTERRUPTED' && http2StreamFailure) error.streamFallbackRecommended = true
  if (input && input.name === 'AbortError') error.name = 'AbortError'
  if (transportStatus !== undefined || upstreamStatus !== undefined) error.status = transportStatus ?? upstreamStatus
  if (upstreamStatus !== undefined) error.upstreamStatus = upstreamStatus
  const providerCode = details.codes.map(safeProviderCode).find((value) => value !== undefined)
  if (providerCode !== undefined) error.providerCode = providerCode
  return error
}

module.exports = { normalizeAIProviderError }
