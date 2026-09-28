import { useMemo } from 'react';
import qrcodegen from 'qrcode-generator';

/**
 * Renders a QR code as inline SVG.
 *
 * `qrcode-generator` is pure JS math (Reed–Solomon error correction over a
 * finite field) with zero runtime dependencies — not something worth
 * hand-rolling, but small and dependency-free enough to justify pulling in for
 * a single, real product need (every published Tap needs a scannable code).
 */
export function QrCodeCanvas({
  value,
  size = 200,
  fgColor = '#101722',
  bgColor = '#ffffff',
}: {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
}) {
  const cells = useMemo(() => {
    const qr = qrcodegen(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const modules: boolean[][] = [];
    for (let row = 0; row < count; row++) {
      const line: boolean[] = [];
      for (let col = 0; col < count; col++) line.push(qr.isDark(row, col));
      modules.push(line);
    }
    return modules;
  }, [value]);

  const count = cells.length;
  // Quiet zone matters for real-world scanning — a code with no margin can
  // fail to decode against a busy background.
  const quiet = 4;
  const dimension = count + quiet * 2;

  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (cells[row]![col]) {
        path += `M${col + quiet},${row + quiet}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      role="img"
      aria-label="QR code"
      style={{ borderRadius: 12 }}
    >
      <rect width={dimension} height={dimension} fill={bgColor} />
      <path d={path} fill={fgColor} />
    </svg>
  );
}
