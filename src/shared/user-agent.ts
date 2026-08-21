// GitHub requires a User-Agent on every API request and rejects requests
// without one. Sent by the Bun server's GitHub client on every call.
export const PROXY_USER_AGENT = 'tandem/0.1.0';
