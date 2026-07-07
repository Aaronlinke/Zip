import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radii, fonts } from "@/src/lib/theme";
import { fetchSnippets, Snippet } from "@/src/lib/api";
import {
  addProject,
  detectTechStack,
  Project,
  setActiveFilePath,
  setActiveProjectId,
} from "@/src/lib/projectStore";

const FILTERS = ["ALL", "HTML", "JS", "CSS", "PY", "JAVA", "C++", "RN"];

function matchFilter(s: Snippet, f: string): boolean {
  if (f === "ALL") return true;
  const l = s.language.toLowerCase();
  const tags = s.tags.map((t) => t.toLowerCase());
  if (f === "HTML") return l === "html" || tags.includes("html");
  if (f === "JS") return l === "javascript" || l === "tsx" || l === "jsx";
  if (f === "CSS") return l === "css";
  if (f === "PY") return l === "python";
  if (f === "JAVA") return l === "java";
  if (f === "C++") return l === "cpp" || l === "c";
  if (f === "RN") return tags.includes("react-native");
  return true;
}

export default function LibraryScreen() {
  const router = useRouter();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchSnippets();
      setSnippets(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => snippets.filter((s) => matchFilter(s, filter)),
    [snippets, filter]
  );

  const copySnippet = async (s: Snippet) => {
    await Clipboard.setStringAsync(s.content);
    Alert.alert("Copied", `${s.name} copied to clipboard.`);
  };

  const openAsProject = async (s: Snippet) => {
    const ext =
      s.language === "javascript"
        ? "js"
        : s.language === "python"
          ? "py"
          : s.language === "java"
            ? "java"
            : s.language === "cpp"
              ? "cpp"
              : s.language === "html"
                ? "html"
                : s.language === "css"
                  ? "css"
                  : s.language === "tsx"
                    ? "tsx"
                    : "txt";
    const filename = `${s.id.replace(/[^a-z0-9-]/gi, "")}.${ext}`;
    const files = [
      {
        path: filename,
        content: s.content,
        size: s.content.length,
        language: s.language,
      },
    ];
    const project: Project = {
      id: `p_${Date.now().toString(36)}`,
      name: s.name,
      files,
      tech_stack: detectTechStack(files),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await addProject(project);
    await setActiveProjectId(project.id);
    await setActiveFilePath(filename);
    router.push("/(tabs)/editor");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Library</Text>
          <Text style={styles.subtitle}>offline snippets · open source</Text>
        </View>
        <TouchableOpacity
          onPress={load}
          testID="reload-library-btn"
          style={styles.iconBtn}
        >
          <Feather name="refresh-cw" size={18} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowContent}
        >
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              testID={`filter-${f}`}
              style={[
                styles.chip,
                filter === f && {
                  borderColor: colors.borderFocus,
                  backgroundColor: "rgba(229,255,0,0.08)",
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  filter === f && { color: colors.accent },
                ]}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}
        style={{ flex: 1 }}
      >
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : error ? (
          <View style={styles.errBox}>
            <Feather name="alert-triangle" size={30} color={colors.danger} />
            <Text style={styles.errText}>{error}</Text>
            <TouchableOpacity onPress={load} style={styles.retryBtn}>
              <Text style={styles.retryText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((s) => {
            const isOpen = expanded === s.id;
            return (
              <View
                key={s.id}
                style={styles.card}
                testID={`snippet-card-${s.id}`}
              >
                <TouchableOpacity
                  style={styles.cardHead}
                  onPress={() => setExpanded(isOpen ? null : s.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{s.name}</Text>
                    <Text style={styles.cardDesc}>{s.description}</Text>
                  </View>
                  <View style={styles.langBadge}>
                    <Text style={styles.langText}>
                      {s.language.toUpperCase()}
                    </Text>
                  </View>
                </TouchableOpacity>

                {isOpen ? (
                  <>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.codeContainer}
                    >
                      <Text style={styles.codeText}>{s.content}</Text>
                    </ScrollView>
                    <View style={styles.cardActions}>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => copySnippet(s)}
                        testID={`copy-snippet-${s.id}`}
                      >
                        <Feather name="copy" size={14} color={colors.textPrimary} />
                        <Text style={styles.actionBtnText}>Copy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.primaryAction]}
                        onPress={() => openAsProject(s)}
                        testID={`use-snippet-${s.id}`}
                      >
                        <Feather name="corner-up-right" size={14} color={colors.textInverse} />
                        <Text style={[styles.actionBtnText, { color: colors.textInverse }]}>
                          Use as project
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}
              </View>
            );
          })
        )}
        {!loading && filtered.length === 0 ? (
          <Text style={styles.empty}>No snippets match this filter.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  title: { color: colors.textPrimary, fontWeight: "900", fontSize: 20 },
  subtitle: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 2,
  },
  iconBtn: { padding: 8 },
  chipRow: {
    height: 56,
    justifyContent: "center",
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  chipRowContent: {
    paddingHorizontal: spacing.md,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: "center",
    flexShrink: 0,
  },
  chipText: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  cardHead: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  cardTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "800" },
  cardDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    fontFamily: fonts.mono,
  },
  langBadge: {
    borderWidth: 1,
    borderColor: colors.borderFocus,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  langText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
  },
  codeContainer: {
    backgroundColor: colors.editorBg,
    maxHeight: 260,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  codeText: {
    padding: 12,
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 10,
  },
  primaryAction: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionBtnText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  empty: {
    color: colors.textTertiary,
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: 12,
    padding: spacing.xl,
  },
  errBox: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  errText: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    fontFamily: fonts.mono,
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  retryText: {
    color: colors.textInverse,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
