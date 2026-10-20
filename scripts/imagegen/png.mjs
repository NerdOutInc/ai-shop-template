const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Read the IHDR of a PNG. `alphaChannel` only says the file carries an alpha channel; whether that
 * channel is actually used must be judged on decoded pixels, which the skills do separately.
 */
export function readPngHeader(bytes) {
  if (bytes.length < 29 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("latin1", 12, 16) !== "IHDR")
    return null
  const colorType = bytes[25]
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    alphaChannel: colorType === 4 || colorType === 6,
  }
}
