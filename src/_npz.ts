import JSZip from "jszip";

export interface NpyArray {
  data: Float32Array;
  shape: number[];
  dtype: string;
}

export type NpzArchive = Record<string, NpyArray>;

const NUMPY_MAGIC = "\x93NUMPY";

export async function loadNpz(input: ArrayBuffer | Buffer): Promise<NpzArchive> {
  const zip = await JSZip.loadAsync(input);
  const archive: NpzArchive = {};
  const entries = Object.entries(zip.files).filter(
    ([name, file]) => name.endsWith(".npy") && !file.dir,
  );

  await Promise.all(
    entries.map(async ([name, file]) => {
      const data = await file.async("arraybuffer");
      archive[name.slice(0, -4)] = parseNpy(data);
    }),
  );

  return archive;
}

// ---- internals ----

function parseNpy(buffer: ArrayBuffer): NpyArray {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < NUMPY_MAGIC.length; i++) {
    if (bytes[i] !== NUMPY_MAGIC.charCodeAt(i)) {
      throw new Error("Invalid .npy file");
    }
  }

  const major = bytes[6] ?? 1;
  const headerOffset = major >= 2 ? 12 : 10;
  const headerLength =
    major >= 2
      ? new DataView(buffer, 8, 4).getUint32(0, true)
      : new DataView(buffer, 8, 2).getUint16(0, true);
  const header = new TextDecoder().decode(bytes.slice(headerOffset, headerOffset + headerLength));

  const descr = header.match(/'descr'\s*:\s*'([^']+)'/)?.[1];
  const shapeText = header.match(/'shape'\s*:\s*\(([^)]*)\)/)?.[1];
  const fortran = header.match(/'fortran_order'\s*:\s*(True|False)/)?.[1] === "True";
  if (!descr || !shapeText) {
    throw new Error(`Unsupported .npy header: ${header.trim()}`);
  }

  const dataOffset = headerOffset + headerLength;
  const data = buffer.slice(dataOffset);
  const dtype = descr.replace(/[<>|=]/g, "");
  const shape = shapeText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));

  const values = toFloat32(data, dtype);
  const ordered =
    fortran && shape.length === 2 ? fromFortran(values, shape[0]!, shape[1]!) : values;
  return { data: ordered, shape, dtype };
}

function toFloat32(buffer: ArrayBuffer, dtype: string): Float32Array {
  switch (dtype) {
    case "f4":
      return new Float32Array(buffer.slice(0));
    case "f8": {
      const source = new Float64Array(buffer);
      const out = new Float32Array(source.length);
      for (let i = 0; i < source.length; i++) out[i] = source[i]!;
      return out;
    }
    default:
      throw new Error(`Unsupported .npy dtype: ${dtype}`);
  }
}

function fromFortran(values: Float32Array, rows: number, cols: number): Float32Array {
  const out = new Float32Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      out[row * cols + col] = values[col * rows + row]!;
    }
  }
  return out;
}
