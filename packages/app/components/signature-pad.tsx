import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, GestureResponderEvent } from 'react-native';
import { colors } from '../theme/colors';

interface Point {
  x: number;
  y: number;
}

interface Props {
  onConfirm: (pathData: string) => void;
}

export function SignaturePad({ onConfirm }: Props) {
  const [paths, setPaths] = useState<Point[][]>([]);
  const currentPath = useRef<Point[]>([]);
  const [, forceUpdate] = useState(0);

  const getPoint = (e: GestureResponderEvent): Point => ({
    x: e.nativeEvent.locationX,
    y: e.nativeEvent.locationY,
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        currentPath.current = [getPoint(e)];
      },
      onPanResponderMove: (e) => {
        currentPath.current.push(getPoint(e));
        forceUpdate((n) => n + 1);
      },
      onPanResponderRelease: () => {
        if (currentPath.current.length > 0) {
          setPaths((prev) => [...prev, currentPath.current]);
          currentPath.current = [];
        }
      },
    })
  ).current;

  const allPaths = [...paths, ...(currentPath.current.length > 0 ? [currentPath.current] : [])];

  const toSvgPath = (points: Point[]): string => {
    if (points.length === 0) return '';
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
  };

  const handleClear = () => {
    setPaths([]);
    currentPath.current = [];
    forceUpdate((n) => n + 1);
  };

  const handleConfirm = () => {
    const data = JSON.stringify(paths.map((p) => p.map(({ x, y }) => [Math.round(x), Math.round(y)])));
    onConfirm(data);
  };

  return (
    <View style={styles.container}>
      <View style={styles.canvas} {...panResponder.panHandlers}>
        {/* SVG-like rendering using absolute-positioned Views for each segment */}
        {allPaths.map((path, pi) =>
          path.map((point, i) => {
            if (i === 0) return null;
            const prev = path[i - 1]!;
            const dx = point.x - prev.x;
            const dy = point.y - prev.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <View
                key={`${pi}-${i}`}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: prev.x,
                  top: prev.y - 1,
                  width: len,
                  height: 2,
                  backgroundColor: '#000',
                  transform: [{ rotate: `${angle}deg` }],
                  transformOrigin: 'left center',
                }}
              />
            );
          })
        )}
        {allPaths.length === 0 && (
          <Text style={styles.placeholder}>Sign here</Text>
        )}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmButton, paths.length === 0 && styles.buttonDisabled]}
          onPress={handleConfirm}
          disabled={paths.length === 0}
        >
          <Text style={styles.confirmText}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  canvas: {
    height: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: { color: colors.textLight, fontSize: 16 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  clearButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  clearText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  confirmText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.4 },
});
