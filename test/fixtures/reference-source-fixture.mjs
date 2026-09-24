import zlib from "node:zlib";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export function referenceCaptureBytes(seed = 0) {
  const width = 64;
  const height = 64;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const band = (x < 18 ? 40 : x < 46 ? 135 : 220) + seed;
      rows[offset] = band % 256;
      rows[offset + 1] = (band + y * 2) % 256;
      rows[offset + 2] = (255 - band + x) % 256;
      rows[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export function referenceMetadataBytes({
  productRecordId,
  screenRecordId,
  capturedAt,
  frames,
  popularityRecords
}) {
  return Buffer.from(JSON.stringify({
    uibowl_source_metadata_version: 1,
    product_record_id: productRecordId,
    screen_record_id: screenRecordId,
    captured_at: capturedAt,
    frames,
    frame_summaries: frames.map((frame) => ({
      frame_id: frame.frame_id,
      visible_regions: frame.role === "promotional"
        ? ["brand-message", "promotional-action"]
        : ["result-identity", "comparable-value", "confidence", "drill-down-evidence"]
    })),
    popularity_records: popularityRecords.map(({ evidence_ids: _evidenceIds, ...record }) => record)
  }));
}
