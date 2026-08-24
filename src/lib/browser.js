/** Firefox exposes `browser` (promises); Chrome exposes `chrome`. */
export const api = globalThis.browser ?? globalThis.chrome;
