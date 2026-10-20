import { crc32, deflateSync } from "node:zlib"

/** A tiny valid PNG for tests: `alpha` selects RGBA (color type 6) over RGB (color type 2). */
export function makeTestPng({ width = 2, height = 1, alpha = true, seed = 7 } = {}) {
  const channels = alpha ? 4 : 3
  const raw = Buffer.alloc(height * (1 + width * channels))
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width * channels; x++) raw[y * (1 + width * channels) + 1 + x] = (seed * 31 + x * 17 + y) & 255
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type, "latin1")
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
    return Buffer.concat([length, typeBytes, data, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = alpha ? 6 : 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}
