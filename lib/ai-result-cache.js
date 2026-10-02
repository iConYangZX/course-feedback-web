'use strict'

// Only successful summary text is retained. In-flight promises are shared until
// they settle, independently of the bounded LRU of completed summaries.
class AIResultCache {
  #completed = new Map()
  #inFlight = new Map()
  #totalChars = 0
  #ttlMs
  #maxEntries
  #maxTotalChars
  #now

  constructor({ ttlMs = 30 * 60 * 1000, maxEntries = 64, maxTotalChars = 250000, now = Date.now } = {}) {
    for (const [name, value] of Object.entries({ ttlMs, maxEntries, maxTotalChars })) {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`)
    }
    if (typeof now !== 'function') throw new TypeError('now must be a function')
    this.#ttlMs = ttlMs
    this.#maxEntries = maxEntries
    this.#maxTotalChars = maxTotalChars
    this.#now = now
  }

  getOrCreate(key, factory) {
    if (typeof key !== 'string' || !key) return Promise.reject(new TypeError('key must be a non-empty string'))
    if (typeof factory !== 'function') return Promise.reject(new TypeError('factory must be a function'))
    this.#removeExpired()
    const cached = this.#completed.get(key)
    if (cached) {
      this.#completed.delete(key)
      this.#completed.set(key, cached)
      return Promise.resolve(cached.value)
    }
    if (this.#inFlight.has(key)) return this.#inFlight.get(key)

    const promise = Promise.resolve().then(factory).then((value) => {
      if (typeof value !== 'string' || !value.trim()) throw new Error('AI 摘要未返回有效文本，请重试')
      return value
    }).then((value) => {
      // clear() may invalidate this work, or a newer request may own this key.
      if (this.#inFlight.get(key) === promise) {
        this.#inFlight.delete(key)
        this.#remember(key, value)
      }
      return value
    }, (error) => {
      if (this.#inFlight.get(key) === promise) this.#inFlight.delete(key)
      throw error
    })
    this.#inFlight.set(key, promise)
    return promise
  }

  clear() {
    this.#completed.clear()
    this.#inFlight.clear()
    this.#totalChars = 0
  }

  #remove(key) {
    const entry = this.#completed.get(key)
    if (!entry) return
    this.#totalChars -= entry.value.length
    this.#completed.delete(key)
  }

  #removeExpired() {
    const now = this.#now()
    for (const [key, entry] of this.#completed) {
      if (entry.expiresAt <= now) this.#remove(key)
    }
  }

  #remember(key, value) {
    if (!this.#ttlMs || !this.#maxEntries || value.length > this.#maxTotalChars) return
    this.#removeExpired()
    this.#remove(key)
    this.#completed.set(key, { value, expiresAt: this.#now() + this.#ttlMs })
    this.#totalChars += value.length
    while (this.#completed.size > this.#maxEntries || this.#totalChars > this.#maxTotalChars) {
      this.#remove(this.#completed.keys().next().value)
    }
  }
}

module.exports = { AIResultCache }
