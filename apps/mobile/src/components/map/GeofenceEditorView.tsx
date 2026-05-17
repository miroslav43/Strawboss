import { useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { GeofenceEditorCommand, GeofenceEditorEvent } from '@/map/map-bridge';
import { serializeEditorCommand, parseGeofenceEditorEvent } from '@/map/map-bridge';
import { LEAFLET_GEOFENCE_EDITOR_HTML } from '@/map/leaflet-geofence-editor';

export interface GeofenceEditorViewHandle {
  sendCommand(cmd: GeofenceEditorCommand): void;
}

interface GeofenceEditorViewProps {
  onEvent?: (event: GeofenceEditorEvent) => void;
  onReady?: () => void;
  style?: object;
}

export const GeofenceEditorView = forwardRef<GeofenceEditorViewHandle, GeofenceEditorViewProps>(
  function GeofenceEditorView({ onEvent, onReady, style }, ref) {
    const webViewRef = useRef<WebView>(null);
    const [loading, setLoading] = useState(true);

    useImperativeHandle(ref, () => ({
      sendCommand(cmd: GeofenceEditorCommand) {
        webViewRef.current?.injectJavaScript(serializeEditorCommand(cmd));
      },
    }));

    const handleMessage = useCallback(
      (e: WebViewMessageEvent) => {
        const event = parseGeofenceEditorEvent(e.nativeEvent.data);
        if (!event) return;

        if (event.type === 'MAP_READY') {
          setLoading(false);
          onReady?.();
        }
        onEvent?.(event);
      },
      [onEvent, onReady],
    );

    return (
      <View style={[styles.container, style]}>
        <WebView
          ref={webViewRef}
          source={{ html: LEAFLET_GEOFENCE_EDITOR_HTML, baseUrl: 'https://localhost/' }}
          style={styles.webview}
          javaScriptEnabled
          originWhitelist={['*']}
          onMessage={handleMessage}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          startInLoadingState={false}
          mixedContentMode="never"
          onError={() => setLoading(false)}
        />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#0A5C36" size="large" />
            <Text style={styles.loadingText}>Se înarcă harta...</Text>
          </View>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F3DED8',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14, color: '#5D4037' },
});
