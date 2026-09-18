// One place for "do an HTTP call, don't give up on the first hiccup".

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(url, { timeoutMs = 15000, retries = 3, backoffMs = 1000, ...init } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const body = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(`HTTP ${response.status} ${response.statusText} ${body}`.trim());
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`request to ${url} failed: ${lastError?.message ?? lastError}`);
}

export async function postJson(url, body, options = {}) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(body),
    ...options,
  });
}

export async function postForm(url, fields, options = {}) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(options.headers ?? {}) },
    body: new URLSearchParams(fields).toString(),
    ...options,
  });
}
