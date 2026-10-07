// GameSync API Client
// Handles game state synchronization with GameSync service

const GAMESYNC_BASE_URL = "https://danieldailey.com/gamesync/index.php"
const POLLING_INTERVAL = 2000 // 2 seconds
const DETECTION_TIMEOUT = 2000 // 2 seconds
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const GAME_TYPE = "khet"

// Internal state
let sessionId = null
let version = null
let isAvailable = null
let pollInterval = null
let lastCheckTime = null

// Client identity - persistent across sessions
let clientId = null

/**
 * Generate a random client ID
 */
function generateClientId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Get or create persistent client ID
 */
export function getClientId() {
  if (clientId) {
    return clientId
  }

  try {
    const stored = localStorage.getItem("khet_client_id")
    if (stored) {
      clientId = stored
      return clientId
    }

    clientId = generateClientId()
    localStorage.setItem("khet_client_id", clientId)
    return clientId
  } catch (error) {
    // localStorage unavailable, generate ephemeral ID
    console.warn("localStorage unavailable for client ID:", error)
    clientId = generateClientId()
    return clientId
  }
}

/**
 * Check if GameSync service is available
 * Caches result in sessionStorage for 5 minutes
 */
export async function checkAvailability() {
  // Check for force refresh via URL param
  const urlParams = new URLSearchParams(window.location.search)
  const forceRefresh = urlParams.get('sync_refresh') === '1'
  
  // Check cache first (unless force refresh)
  const cacheKey = "gamesync_available"
  const cacheTimeKey = "gamesync_check_time"
  const cached = sessionStorage.getItem(cacheKey)
  const cachedTime = sessionStorage.getItem(cacheTimeKey)

  if (!forceRefresh && cached !== null && cachedTime !== null) {
    const age = Date.now() - parseInt(cachedTime, 10)
    if (age < CACHE_TTL) {
      isAvailable = cached === "true"
      return isAvailable
    }
  }

  // Check service
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DETECTION_TIMEOUT)

    const response = await fetch(`${GAMESYNC_BASE_URL}?action=status`, {
      method: "GET",
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      const data = await response.json()
      isAvailable = data.status === "operational"
    } else {
      isAvailable = false
    }
  } catch (error) {
    // Network error or timeout - service unavailable
    isAvailable = false
  }

  // Cache result
  sessionStorage.setItem(cacheKey, isAvailable ? "true" : "false")
  sessionStorage.setItem(cacheTimeKey, Date.now().toString())
  lastCheckTime = Date.now()

  return isAvailable
}

/**
 * Get service availability (cached)
 */
export function getServiceAvailable() {
  return isAvailable
}

/**
 * Create a new game session
 */
export async function createSession(stateBlob, meta = {}) {
  if (!isAvailable) {
    const available = await checkAvailability()
    if (!available) {
      throw new Error("GameSync service unavailable")
    }
  }

  try {
    const response = await fetch(`${GAMESYNC_BASE_URL}?action=create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        game_type: GAME_TYPE,
        state_blob: stateBlob,
        meta: meta
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || "Failed to create session")
    }

    const session = await response.json()
    sessionId = session.session_id
    version = session.version

    console.log("[GameSync] Session created:", sessionId, "version:", version)
    return session
  } catch (error) {
    console.error("Failed to create GameSync session:", error)
    throw error
  }
}

/**
 * Load an existing game session
 */
export async function loadSession(sessionIdParam) {
  if (!isAvailable) {
    const available = await checkAvailability()
    if (!available) {
      throw new Error("GameSync service unavailable")
    }
  }

  try {
    const url = new URL(GAMESYNC_BASE_URL)
    url.searchParams.set("action", "load")
    url.searchParams.set("session_id", sessionIdParam)
    url.searchParams.set("game_type", GAME_TYPE)

    const response = await fetch(url.toString())

    if (response.status === 404) {
      throw { type: "not_found", message: "Session not found" }
    }

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || "Failed to load session")
    }

    const session = await response.json()
    sessionId = session.session_id
    version = session.version

    console.log("[GameSync] Session loaded:", sessionId, "version:", version)
    return session
  } catch (error) {
    console.error("Failed to load GameSync session:", error)
    throw error
  }
}

/**
 * Load session without updating internal state (for polling)
 */
export async function peekSession(sessionIdParam) {
  const url = new URL(GAMESYNC_BASE_URL)
  url.searchParams.set("action", "load")
  url.searchParams.set("session_id", sessionIdParam)
  url.searchParams.set("game_type", GAME_TYPE)

  const response = await fetch(url.toString())

  if (response.status === 404) {
    throw { type: "not_found", message: "Session not found" }
  }

  if (!response.ok) {
    throw new Error("Failed to load session")
  }

  return await response.json()
}

/**
 * Register session state (for reconnection)
 */
export function registerSession(newSessionId, newVersion) {
  sessionId = newSessionId
  version = newVersion
  console.log("[GameSync] Session registered:", sessionId, "version:", version)
}

/**
 * Update game session with optimistic locking
 * Retries on version conflict
 */
export async function updateSession(stateBlob, maxRetries = 3) {
  if (!sessionId || version === null) {
    throw new Error("No active session")
  }

  let attempts = 0
  let currentVersion = version

  while (attempts < maxRetries) {
    try {
      const response = await fetch(`${GAMESYNC_BASE_URL}?action=update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session_id: sessionId,
          game_type: GAME_TYPE,
          state_blob: stateBlob,
          version: currentVersion
        })
      })

      if (response.status === 409) {
        // Version conflict - reload and retry
        const conflict = await response.json()
        if (conflict.current) {
          version = conflict.current.version
          currentVersion = conflict.current.version
          attempts++

          if (attempts >= maxRetries) {
            throw {
              type: "version_conflict",
              current: conflict.current,
              message: "Version conflict: max retries reached"
            }
          }

          // Return current state so caller can merge/reload
          return {
            type: "conflict",
            current: conflict.current
          }
        }
        continue
      }

      if (response.status === 404) {
        throw { type: "not_found", message: "Session not found" }
      }

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to update session")
      }

      const session = await response.json()
      version = session.version
      console.log("[GameSync] Session updated, version:", version)
      return session
    } catch (error) {
      if (error.type === "version_conflict") {
        throw error
      }

      // Network error - don't retry, just fail
      console.error("Failed to update GameSync session:", error)
      throw error
    }
  }

  throw new Error("Max retries reached")
}

/**
 * Start polling for opponent updates
 */
export function startPolling(onUpdate) {
  if (pollInterval) {
    stopPolling()
  }

  if (!sessionId) {
    console.warn("[GameSync] Cannot start polling without session")
    return
  }

  console.log("[GameSync] Starting polling for session:", sessionId)

  pollInterval = setInterval(async () => {
    try {
      // Capture current version before loading
      const currentVersion = version

      // Load session without updating our internal version
      const session = await peekSession(sessionId)

      // Only update if version increased
      if (session.version > currentVersion) {
        // New version available
        console.log(`[GameSync] Poll detected update: version ${currentVersion} -> ${session.version}`)
        version = session.version
        if (onUpdate) {
          onUpdate(session)
        }
      }
    } catch (error) {
      // Log but don't stop polling on transient errors
      if (error.type === "not_found") {
        console.warn("[GameSync] Session not found, stopping polling")
        stopPolling()
        if (onUpdate) {
          onUpdate(null, error)
        }
      } else {
        console.error("[GameSync] Poll error:", error)
      }
    }
  }, POLLING_INTERVAL)
}

/**
 * Stop polling for updates
 */
export function stopPolling() {
  if (pollInterval) {
    console.log("[GameSync] Stopping polling")
    clearInterval(pollInterval)
    pollInterval = null
  }
}

/**
 * Get current session ID
 */
export function getSessionId() {
  return sessionId
}

/**
 * Get current version
 */
export function getVersion() {
  return version
}

/**
 * Check if sync is active
 */
export function isSyncActive() {
  return sessionId !== null && isAvailable
}

/**
 * Trim session ID prefix for display
 */
export function trimSessionId(id) {
  if (!id) return ""
  const prefix = `${GAME_TYPE}_`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

/**
 * Normalize session ID (add prefix if missing)
 */
export function normalizeSessionId(id) {
  if (!id) return null
  const prefix = `${GAME_TYPE}_`
  return id.startsWith(prefix) ? id : `${prefix}${id}`
}

/**
 * Get shareable URL with session ID
 */
export function getSessionUrl(role = null) {
  if (!sessionId) {
    return null
  }

  const url = new URL(window.location.href)
  url.searchParams.set("session", trimSessionId(sessionId))
  if (role) {
    url.searchParams.set("role", role)
  }
  // Remove hash to avoid confusion
  url.hash = ""
  return url.toString()
}

/**
 * Build QR code URL for session
 */
export function getSessionQrUrl(shareUrl) {
  if (!shareUrl) return ""
  const encoded = encodeURIComponent(shareUrl)
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}`
}

/**
 * Clear current session (for reset/new game)
 */
export function clearSession() {
  console.log("[GameSync] Clearing session")
  sessionId = null
  version = null
  stopPolling()
}

/**
 * Initialize - check availability only (don't auto-load session)
 */
export async function initialize() {
  // Initialize client ID
  getClientId()

  // Just check availability
  await checkAvailability()

  return {
    available: isAvailable,
    clientId: clientId
  }
}
