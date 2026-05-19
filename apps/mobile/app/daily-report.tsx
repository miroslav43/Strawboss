/**
 * FM-14 — Raport zilnic PDF + partajare
 *
 * Generează local un PDF cu activitatea zilei (baloți produși, litri alimentați,
 * consumabile, curse) citind din SQLite prin `useTodayActivity`, apoi îl partajează
 * via WhatsApp / email folosind `expo-sharing`.
 *
 * Accesibil din ProfileScreen prin router.push('/daily-report').
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { colors } from '@strawboss/ui-tokens';
import { useAuthStore } from '@/stores/auth-store';
import { useTodayActivity, type ActivityEntry } from '@/hooks/useTodayActivity';
import { todayInRomania } from '@/lib/date';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function kindIcon(kind: ActivityEntry['kind']): string {
  switch (kind) {
    case 'production':
      return '🌾';
    case 'fuel':
      return '⛽';
    case 'consumable':
      return '📦';
    case 'load':
      return '🚛';
  }
}

function syncBadge(status: ActivityEntry['syncStatus']): string {
  switch (status) {
    case 'synced':
      return 'sincronizat ✓';
    case 'pending':
      return 'în așteptare';
    case 'failed':
      return 'eșuat ✗';
  }
}

function syncBadgeColor(status: ActivityEntry['syncStatus']): string {
  switch (status) {
    case 'synced':
      return '#2E7D32';
    case 'pending':
      return '#E65100';
    case 'failed':
      return '#C62828';
  }
}

// ── PDF HTML template ──────────────────────────────────────────────────────

function buildHtml(entries: ActivityEntry[], today: string): string {
  const productions = entries.filter((e) => e.kind === 'production');
  const fuels = entries.filter((e) => e.kind === 'fuel');
  const consumables = entries.filter((e) => e.kind === 'consumable');
  const loads = entries.filter((e) => e.kind === 'load');

  const totalBales = productions.reduce((sum, e) => {
    const match = e.detail.match(/^(\d+)/);
    return sum + (match ? parseInt(match[1], 10) : 0);
  }, 0);

  const totalFuelL = fuels.reduce((sum, e) => {
    const match = e.detail.match(/^([\d.]+)/);
    return sum + (match ? parseFloat(match[1]) : 0);
  }, 0);

  const renderRows = (list: ActivityEntry[]): string =>
    list.length === 0
      ? '<tr><td colspan="3" style="color:#9E9E9E;font-style:italic;padding:8px 0;">Nicio înregistrare</td></tr>'
      : list
          .map(
            (e) => `
    <tr>
      <td style="padding:6px 4px;font-size:13px;">${formatDate(e.timestamp)}</td>
      <td style="padding:6px 4px;font-size:13px;">${e.detail}</td>
      <td style="padding:6px 4px;font-size:12px;color:${syncBadgeColor(e.syncStatus)};">${syncBadge(e.syncStatus)}</td>
    </tr>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Raport zilnic — ${today}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #212121; }
    h1 { color: #0A5C36; font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #757575; font-size: 13px; margin-bottom: 24px; }
    .section { margin-bottom: 20px; }
    .section-title { font-size: 15px; font-weight: bold; color: #0A5C36; border-bottom: 2px solid #0A5C36; padding-bottom: 4px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; color: #757575; padding: 4px; border-bottom: 1px solid #E0E0E0; }
    tr:nth-child(even) { background: #F9F9F9; }
    .kpi-row { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .kpi { background: #F3DED8; border-radius: 8px; padding: 12px 16px; min-width: 120px; }
    .kpi-value { font-size: 24px; font-weight: bold; color: #0A5C36; }
    .kpi-label { font-size: 12px; color: #757575; margin-top: 2px; }
    .footer { margin-top: 32px; font-size: 11px; color: #9E9E9E; text-align: center; }
  </style>
</head>
<body>
  <h1>StrawBoss — Raport zilnic</h1>
  <p class="subtitle">Data: ${today} &nbsp;·&nbsp; Generat la: ${new Date().toLocaleString('ro-RO')}</p>

  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-value">${totalBales}</div>
      <div class="kpi-label">Baloți produși</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${totalFuelL.toFixed(1)} L</div>
      <div class="kpi-label">Combustibil alimentat</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${loads.length}</div>
      <div class="kpi-label">Încărcări baloți</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${consumables.length}</div>
      <div class="kpi-label">Consumabile înregistrate</div>
    </div>
  </div>

  ${
    productions.length > 0
      ? `<div class="section">
    <div class="section-title">🌾 Producție baloți</div>
    <table><thead><tr><th>Oră</th><th>Cantitate</th><th>Sync</th></tr></thead>
    <tbody>${renderRows(productions)}</tbody></table>
  </div>`
      : ''
  }

  ${
    fuels.length > 0
      ? `<div class="section">
    <div class="section-title">⛽ Combustibil</div>
    <table><thead><tr><th>Oră</th><th>Cantitate</th><th>Sync</th></tr></thead>
    <tbody>${renderRows(fuels)}</tbody></table>
  </div>`
      : ''
  }

  ${
    loads.length > 0
      ? `<div class="section">
    <div class="section-title">🚛 Încărcări baloți</div>
    <table><thead><tr><th>Oră</th><th>Cantitate</th><th>Sync</th></tr></thead>
    <tbody>${renderRows(loads)}</tbody></table>
  </div>`
      : ''
  }

  ${
    consumables.length > 0
      ? `<div class="section">
    <div class="section-title">📦 Consumabile</div>
    <table><thead><tr><th>Oră</th><th>Detalii</th><th>Sync</th></tr></thead>
    <tbody>${renderRows(consumables)}</tbody></table>
  </div>`
      : ''
  }

  <p class="footer">Generat din aplicația StrawBoss &nbsp;·&nbsp; ${today}</p>
</body>
</html>`;
}

// ── Screen component ────────────────────────────────────────────────────────

export default function DailyReportScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const today = todayInRomania();

  const { entries, loading, error, refresh } = useTodayActivity(userId);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const html = buildHtml(entries, today);
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Raport zilnic StrawBoss — ${today}`,
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Nu s-a putut genera PDF-ul.');
    } finally {
      setExporting(false);
    }
  }, [entries, today]);

  const productions = entries.filter((e) => e.kind === 'production');
  const fuels = entries.filter((e) => e.kind === 'fuel');
  const consumables = entries.filter((e) => e.kind === 'consumable');
  const loads = entries.filter((e) => e.kind === 'load');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Înapoi"
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Raport zilnic</Text>
          <Text style={styles.headerDate}>{today}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Se încarcă activitatea...</Text>
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => void refresh()}
              activeOpacity={0.8}
            >
              <Text style={styles.retryBtnText}>Reîncearcă</Text>
            </TouchableOpacity>
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.centered}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={48} color="#BDBDBD" />
            <Text style={styles.emptyText}>Nicio activitate înregistrată astăzi.</Text>
          </View>
        ) : (
          <>
            {/* KPI summary */}
            <View style={styles.kpiRow}>
              <KpiCard
                icon="barley"
                value={String(productions.reduce((s, e) => s + parseCount(e.detail), 0))}
                label="Baloți produși"
              />
              <KpiCard
                icon="gas-station"
                value={`${fuels.reduce((s, e) => s + parseCount(e.detail), 0).toFixed(0)} L`}
                label="Combustibil"
              />
              <KpiCard icon="truck" value={String(loads.length)} label="Încărcări" />
              <KpiCard
                icon="package-variant"
                value={String(consumables.length)}
                label="Consumabile"
              />
            </View>

            {/* Activity list */}
            {entries.map((entry) => (
              <View key={entry.id} style={styles.entryRow}>
                <Text style={styles.entryIcon}>{kindIcon(entry.kind)}</Text>
                <View style={styles.entryBody}>
                  <Text style={styles.entryLabel}>{entry.label}</Text>
                  <Text style={styles.entryDetail}>{entry.detail}</Text>
                  <Text style={styles.entryTime}>{formatDate(entry.timestamp)}</Text>
                </View>
                <Text style={[styles.syncBadge, { color: syncBadgeColor(entry.syncStatus) }]}>
                  {syncBadge(entry.syncStatus)}
                </Text>
              </View>
            ))}
          </>
        )}

        {exportError ? <Text style={styles.exportError}>{exportError}</Text> : null}
      </ScrollView>

      {/* Export button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.exportBtn,
            (exporting || entries.length === 0) && styles.exportBtnDisabled,
          ]}
          onPress={() => void handleExport()}
          disabled={exporting || entries.length === 0}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Exportă PDF"
        >
          {exporting ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <MaterialCommunityIcons name="file-pdf-box" size={22} color={colors.white} />
              <Text style={styles.exportBtnText}>Exportă PDF</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

type MCIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function KpiCard({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <View style={styles.kpiCard}>
      <MaterialCommunityIcons name={icon as MCIconName} size={20} color={colors.primary} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function parseCount(detail: string): number {
  const m = detail.match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  headerDate: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
    gap: 12,
  },
  loadingText: { fontSize: 14, color: colors.neutral },
  errorText: { fontSize: 14, color: colors.danger, textAlign: 'center' },
  emptyText: { fontSize: 15, color: '#9E9E9E', textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 4,
  },
  retryBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  kpiCard: {
    flex: 1,
    minWidth: 80,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  kpiValue: { fontSize: 18, fontWeight: '700', color: colors.primary },
  kpiLabel: { fontSize: 11, color: colors.neutral, textAlign: 'center' },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  entryIcon: { fontSize: 22, lineHeight: 28 },
  entryBody: { flex: 1, gap: 2 },
  entryLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  entryDetail: { fontSize: 15, fontWeight: '700', color: colors.primary },
  entryTime: { fontSize: 11, color: '#9E9E9E', marginTop: 2 },
  syncBadge: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  exportError: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  footer: {
    padding: 16,
    paddingBottom: 8,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  exportBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
