import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import WebView from "react-native-webview";

import { colors, spacing, radii, fonts } from "@/src/lib/theme";
import {
  getActiveFilePath,
  getActiveProjectId,
  getProject,
  Project,
} from "@/src/lib/projectStore";

export default function PreviewScreen() {
  const router = useRouter();
  const webviewRef = useRef<WebView>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const load = useCallback(async () => {
    const pid = await getActiveProjectId();
    if (!pid) {
      setProject(null);
      return;
    }
    const p = await getProject(pid);
    setProject(p);
    const active = await getActiveFilePath();
    setActivePath(active);
    setLogs([]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const previewData = useMemo(() => {
    if (!project) return null;
    const html =
      project.files.find(
        (f) => f.path === activePath && f.language === "html"
      ) ||
      project.files.find(
        (f) => f.path.toLowerCase().endsWith("index.html")
      ) ||
      project.files.find((f) => f.language === "html");

    if (!html) return null;

    // Try to inline sibling css/js referenced by path (best-effort)
    let source = html.content;
    const cssFiles = project.files.filter((f) => f.language === "css");
    const jsFiles = project.files.filter((f) => f.language === "javascript");

    // Inline referenced CSS via <link href="...">
    source = source.replace(
      /<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi,
      (_m, href: string) => {
        const match =
          cssFiles.find((c) => c.path.endsWith(href)) ||
          cssFiles.find((c) => c.path === href);
        return match ? `<style>${match.content}</style>` : "";
      }
    );

    // Inline referenced JS via <script src="...">
    source = source.replace(
      /<script[^>]+src=["']([^"']+\.js)["'][^>]*><\/script>/gi,
      (_m, src: string) => {
        const match =
          jsFiles.find((j) => j.path.endsWith(src)) ||
          jsFiles.find((j) => j.path === src);
        return match ? `<script>${match.content}</script>` : "";
      }
    );

    // Console bridge for the log panel
    const bridge = `<script>
      (function(){
        var origLog = console.log, origErr = console.error, origWarn = console.warn;
        function post(level, args) {
          try { window.ReactNativeWebView.postMessage(JSON.stringify({
            level: level,
            args: Array.prototype.slice.call(args).map(function(a){
              try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
              catch(e){ return String(a); }
            })
          })); } catch(e){}
        }
        console.log = function(){ post('log', arguments); origLog.apply(console, arguments); };
        console.error = function(){ post('error', arguments); origErr.apply(console, arguments); };
        console.warn = function(){ post('warn', arguments); origWarn.apply(console, arguments); };
        window.addEventListener('error', function(e){ post('error', [e.message + ' @ ' + e.filename + ':' + e.lineno]); });
      })();
    </script>`;

    // Inject bridge just after <head> or at start
    if (/<head[^>]*>/i.test(source)) {
      source = source.replace(/<head[^>]*>/i, (m) => m + bridge);
    } else {
      source = bridge + source;
    }
    return { html: source, name: html.path };
  }, [project, activePath]);
  // Include reloadKey as an intentional dependency to trigger re-inline on reload
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const reload = () => setReloadKey((k) => k + 1);

  const clearLogs = () => setLogs([]);

  if (!project) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.empty}>
          <Feather name="play-circle" size={44} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Nothing to preview</Text>
          <Text style={styles.emptySub}>
            Load a project first from the Forge tab.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push("/(tabs)")}
          >
            <Text style={styles.primaryBtnText}>OPEN FORGE</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!previewData) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.empty}>
          <Feather name="alert-circle" size={44} color={colors.danger} />
          <Text style={styles.emptyTitle}>No HTML file found</Text>
          <Text style={styles.emptySub}>
            Live preview supports HTML/CSS/JS projects. Open an .html file in
            the editor, or add one via a snippet.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push("/(tabs)/editor")}
          >
            <Text style={styles.primaryBtnText}>OPEN EDITOR</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Live Preview</Text>
          <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="middle">
            {previewData.name}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowLogs((v) => !v)}
          testID="toggle-logs-btn"
          style={styles.iconBtn}
        >
          <Feather
            name="terminal"
            size={18}
            color={showLogs ? colors.accent : colors.textSecondary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={reload}
          testID="reload-preview-btn"
          style={styles.iconBtn}
        >
          <Feather name="refresh-cw" size={18} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        <WebView
          key={reloadKey}
          ref={webviewRef}
          testID="preview-webview"
          originWhitelist={["*"]}
          source={{ html: previewData.html, baseUrl: "" }}
          style={{ flex: 1, backgroundColor: "#fff" }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loader}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )}
          onMessage={(e) => {
            try {
              const data = JSON.parse(e.nativeEvent.data);
              const line = `[${data.level}] ${data.args.join(" ")}`;
              setLogs((prev) => [...prev, line].slice(-100));
            } catch {}
          }}
          javaScriptEnabled
          domStorageEnabled
        />
        {showLogs ? (
          <View style={styles.logs}>
            <View style={styles.logsHeader}>
              <Text style={styles.logsTitle}>CONSOLE</Text>
              <TouchableOpacity onPress={clearLogs} testID="clear-logs-btn">
                <Feather name="trash-2" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.logsBody}>
              {logs.length === 0 ? (
                <Text style={styles.logsEmpty}>
                  Waiting for console output...
                </Text>
              ) : (
                logs.map((l, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.logLine,
                      l.startsWith("[error]") && { color: colors.danger },
                      l.startsWith("[warn]") && { color: colors.accent },
                    ]}
                  >
                    {l}
                  </Text>
                ))
              )}
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: 6,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 10,
    fontFamily: fonts.mono,
    marginTop: 2,
  },
  iconBtn: {
    padding: 8,
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  logs: {
    maxHeight: 200,
    backgroundColor: colors.editorBg,
    borderTopWidth: 1,
    borderTopColor: colors.borderFocus,
  },
  logsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  logsTitle: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
  },
  logsBody: { padding: spacing.md, gap: 2 },
  logsEmpty: { color: colors.textTertiary, fontFamily: fonts.mono, fontSize: 11 },
  logLine: {
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  emptySub: {
    color: colors.textTertiary,
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: 12,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radii.md,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
