import { useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { GeofenceEditorCommand, GeofenceEditorEvent } from '@/map/map-bridge';
import { serializeEditorCommand, parseGeofenceEditorEvent } from '@/map/map-bridge';
import { LEAFLET_GEOFENCE_EDITOR_HTML } from '@/map/leaflet-geofence-editor';
import { useI18n } from '@/lib/i18n';

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
    const [hasError, setHasError] = useState(false);
    const { t } = useI18n();

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

    const handleError = useCallback(() => {
      setLoading(false);
      setHasError(true);
    }, []);

    const handleRetry = useCallback(() => {
      setHasError(false);
      setLoading(true);
      webViewRef.current?.reload();
    }, []);

    return (
      <View style={[styles.container, style]}>
        <WebView
          ref={webViewRef}
          source={{ html: LEAFLET_GEOFENCE_EDITOR_HTML, baseUrl: 'https://localhost/' }}
          style={styles.webview}
          javaScriptEnabled
          originWhitelist={['https://*', 'about:*']}
          onMessage={handleMessage}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          startInLoadingState={false}
          mixedContentMode="never"
          onError={handleError}
        />
        {loading && !hasError && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#0A5C36" size="large" />
            <Text style={styles.loadingText}>{t('map.geofenceEditor.loadingMap')}</Text>
          </View>
        )}
        {hasError && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.errorText}>{t('map.geofenceEditor.error')}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.8}>
              <Text style={styles.retryButtonText}>{t('map.geofenceEditor.retry')}</Text>
            </TouchableOpacity>
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
  errorText: {
    fontSize: 15,
    color: '#C62828',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryButton: {
    backgroundColor: '#0A5C36',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
