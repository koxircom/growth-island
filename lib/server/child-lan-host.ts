// Explicit opt-in for a trusted HTTPS hostname on this private household network.
// This only selects child visitor access; it does not create a parent session.
export function isChildLanHost(origin: string, configuredHostname = ""): boolean {
  const url = new URL(origin), host = url.hostname;
  const octets = host.split(".").map(Number);
  const privateHost = ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
    (octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  return privateHost || (url.protocol === "https:" && configuredHostname.length > 0 && host === configuredHostname);
}
