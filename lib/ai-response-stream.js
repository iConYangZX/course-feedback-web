const { TextDecoder } = require('node:util')

const TERMINAL_RESPONSE_EVENTS = new Set([
  'response.completed',
  'response.incomplete',
  'response.failed',
  'error'
])

function inspectEventFrame(frame) {
  const dataLines = []
  let eventName = ''
  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    else if (field === 'event') eventName = value
  }
  if (!dataLines.length) return null
  let data = dataLines.join('\n').trim()
  if (!data) return null
  if (data === '[DONE]') return { text: 'data: [DONE]\n\n', terminal: true }

  let event
  try {
    event = JSON.parse(data)
  } catch {
    // Return the invalid complete frame immediately for the existing provider
    // parser to report it, instead of waiting forever for another event.
    return { text: `data: ${data.replace(/\n/g, '\ndata: ')}\n\n`, terminal: true }
  }

  if (event && typeof event === 'object' && !Array.isArray(event)) {
    // SSE event names and JSON type fields express the same event identity.
    // Preserve it for providers that put the type only in the event: line.
    if (!event.type && eventName) {
      event = { ...event, type: eventName }
      data = JSON.stringify(event)
    }
    const choice = Array.isArray(event.choices)
      ? event.choices.find((item) => item && (item.index === undefined || item.index === 0))
      : null
    const terminal = Boolean(event.error)
      || TERMINAL_RESPONSE_EVENTS.has(event.type)
      || Boolean(choice && choice.finish_reason)
    return { text: `data: ${data.replace(/\n/g, '\ndata: ')}\n\n`, terminal }
  }

  return { text: `data: ${data.replace(/\n/g, '\ndata: ')}\n\n`, terminal: true }
}

async function readAIResponseText(response) {
  // Error pages and providers that do not expose a stream retain their status
  // and original body for the shared HTTP/provider error handling.
  if (!response.ok || !response.body || typeof response.body.getReader !== 'function') {
    return response.text()
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const rawChunks = []
  const eventFrames = []
  let pending = ''
  let terminal = false
  let streamEnded = false

  const consumeFrame = (frame) => {
    const event = inspectEventFrame(frame.replace(/^\uFEFF/, ''))
    if (!event) return false
    eventFrames.push(event.text)
    return event.terminal
  }

  try {
    while (!terminal) {
      const chunk = await reader.read()
      if (chunk.done) {
        streamEnded = true
        const tail = decoder.decode()
        rawChunks.push(tail)
        pending += tail
        if (pending) terminal = consumeFrame(pending)
        break
      }

      const decoded = decoder.decode(chunk.value, { stream: true })
      rawChunks.push(decoded)
      pending += decoded
      let boundary
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(pending))) {
        const frame = pending.slice(0, boundary.index)
        pending = pending.slice(boundary.index + boundary[0].length)
        if (consumeFrame(frame)) {
          terminal = true
          break
        }
      }
    }

    // A clean EOF without a completion event is passed through unchanged in
    // meaning: parseProviderResponseJson rejects an interrupted SSE response.
    // Ordinary JSON is returned verbatim when a provider ignores stream:true.
    return eventFrames.length ? eventFrames.join('') : rawChunks.join('')
  } catch (error) {
    if (error && error.name !== 'AbortError') error.code = 'AI_RESPONSE_INTERRUPTED'
    throw error
  } finally {
    if (!streamEnded) {
      try {
        // Do not wait for upstream to close or acknowledge cancellation after
        // it has already sent a terminal event. Consume rejection safely.
        Promise.resolve(reader.cancel()).catch(() => {})
      } catch {
        // The body may already be errored or closed.
      }
    }
    reader.releaseLock()
  }
}

module.exports = { readAIResponseText }
