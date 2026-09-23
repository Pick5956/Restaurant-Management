import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { createQrMatrix, qrMatrixPath, qrViewBoxSize } from '@/src/lib/qr';

// The table's ordering QR, drawn on the phone from the matrix in src/lib/qr.ts
// (a port of the web's). The token in it is the table's access key, so it never
// goes to an outside image service.

export function qrContent(text: string, quietZone: number): { path: string; viewBox: number } | null {
  try {
    const matrix = createQrMatrix(text);
    return { path: qrMatrixPath(matrix, quietZone), viewBox: qrViewBoxSize(matrix, quietZone) };
  } catch {
    return null;
  }
}

/**
 * A white square with the dark modules as one path. react-native-svg has no
 * shapeRendering, so the modules are whole rows of one path each: runs of
 * modules share edges inside the path and never show a seam between them.
 */
export function QrCode({ value, size, quietZone = 0 }: { value: string; size: number; quietZone?: number }) {
  const content = useMemo(() => qrContent(value, quietZone), [quietZone, value]);
  if (!content) return <View style={{ width: size, height: size, backgroundColor: '#ffffff' }} />;
  return (
    <Svg height={size} viewBox={`0 0 ${content.viewBox} ${content.viewBox}`} width={size}>
      <Rect fill="#ffffff" height={content.viewBox} width={content.viewBox} x={0} y={0} />
      <Path d={content.path} fill="#000000" />
    </Svg>
  );
}
