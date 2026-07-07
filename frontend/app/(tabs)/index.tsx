import { useCallback, useState } from "react";
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
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useFocusEffect, useRouter } from "expo-router";
import JSZip from "jszip";

import { colors, spacing, radii, fonts } from "@/src/lib/theme";
import {
  addProject,
  deleteProject,
  detectLanguage,
  detectTechStack,
  isBinaryFilename,
  listProjects,
  Project,
  setActiveFilePath,
  setActiveProjectId,
} from "@/src/lib/projectStore";

export default function ProjectsHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const reload = useCallback(async () => {
    setLoading(true);
    const p = await listProjects();
    setProjects(p);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const importZip = async () => {
    try {
      setImporting(true);
      setProgress("Choosing file...");
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) {
        setImporting(false);
        setProgress("");
        return;
      }
      const asset = res.assets[0];
      setProgress("Reading ZIP...");
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setProgress("Extracting...");
      const zip = await JSZip.loadAsync(base64, { base64: true });

      const files: Project["files"] = [];
      const entries = Object.values(zip.files);
      let count = 0;
      for (const entry of entries) {
        count++;
        if (count % 20 === 0)
          setProgress(`Extracting ${count}/${entries.length}...`);
        if (entry.dir) continue;
        const lang = detectLanguage(entry.name);
        const binary = isBinaryFilename(entry.name);
        try {
          if (binary) {
            const b64 = await entry.async("base64");
            const size = Math.round((b64.length * 3) / 4);
            if (size > 800_000) {
              files.push({
                path: entry.name,
                content: `[Binary file: ${size} bytes — preview not supported]`,
                size,
                language: "text",
              });
            } else {
              files.push({
                path: entry.name,
                content: `data:application/octet-stream;base64,${b64}`,
                size,
                language: "binary",
              });
            }
          } else {
            const text = await entry.async("string");
            files.push({
              path: entry.name,
              content: text,
              size: text.length,
              language: lang,
            });
          }
        } catch (e) {
          console.warn("Failed to extract", entry.name, e);
        }
      }

      const name = (asset.name || "project").replace(/\.zip$/i, "");
      const project: Project = {
        id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        files,
        tech_stack: detectTechStack(files),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await addProject(project);
      await setActiveProjectId(project.id);
      const firstReadable = files.find(
        (f) => f.language !== "binary" && !f.path.startsWith("__MACOSX")
      );
      if (firstReadable) await setActiveFilePath(firstReadable.path);
      setImporting(false);
      setProgress("");
      await reload();
      router.push("/(tabs)/editor");
    } catch (e) {
      setImporting(false);
      setProgress("");
      Alert.alert("Import failed", String(e));
    }
  };

  const createBlank = async () => {
    const project: Project = {
      id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: `Untitled ${new Date().toLocaleDateString()}`,
      files: [
        {
          path: "index.html",
          content:
            '<!doctype html><html><body style="background:#050505;color:#fff;font-family:monospace;padding:24px"><h1 style="color:#E5FF00">Hello, ZipForge</h1><p>Edit me and hit Preview.</p></body></html>',
          size: 200,
          language: "html",
        },
      ],
      tech_stack: ["Web"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await addProject(project);
    await setActiveProjectId(project.id);
    await setActiveFilePath("index.html");
    await reload();
    router.push("/(tabs)/editor");
  };

  const openProject = async (p: Project) => {
    await setActiveProjectId(p.id);
    const first = p.files.find(
      (f) => f.language !== "binary" && !f.path.startsWith("__MACOSX")
    );
    await setActiveFilePath(first?.path || null);
    router.push("/(tabs)/editor");
  };

  const remove = (p: Project) => {
    Alert.alert("Delete project?", `"${p.name}" will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteProject(p.id);
          await reload();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>ZipForge</Text>
          <Text style={styles.subtitle}>your mobile dev studio</Text>
        </View>
        <View style={styles.badge}>
          <View style={styles.dot} />
          <Text style={styles.badgeText}>online</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          testID="import-zip-btn"
          style={styles.importCard}
          onPress={importZip}
          disabled={importing}
          activeOpacity={0.85}
        >
          {importing ? (
            <>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.importTitle}>{progress || "Working..."}</Text>
            </>
          ) : (
            <>
              <View style={styles.iconGlow}>
                <Feather name="upload-cloud" size={36} color={colors.accent} />
              </View>
              <Text style={styles.importTitle}>Import ZIP</Text>
              <Text style={styles.importSub}>
                Drop any zip → extract, view & run code offline.
              </Text>
              <View style={styles.badges}>
                <Text style={styles.tag}>HTML</Text>
                <Text style={styles.tag}>JS</Text>
                <Text style={styles.tag}>PY</Text>
                <Text style={styles.tag}>JAVA</Text>
                <Text style={styles.tag}>C++</Text>
                <Text style={styles.tag}>+</Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          testID="new-blank-btn"
          style={styles.secondaryBtn}
          onPress={createBlank}
        >
          <Feather name="plus" size={18} color={colors.textPrimary} />
          <Text style={styles.secondaryBtnText}>New blank project</Text>
        </TouchableOpacity>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent</Text>
          <Text style={styles.sectionCount}>{projects.length}</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="package" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No projects yet</Text>
            <Text style={styles.emptySub}>
              Import a ZIP or start a blank project to begin.
            </Text>
          </View>
        ) : (
          projects.map((p) => (
            <TouchableOpacity
              key={p.id}
              testID={`project-card-${p.id}`}
              style={styles.projectCard}
              onPress={() => openProject(p)}
              onLongPress={() => remove(p)}
            >
              <View style={styles.projectLeft}>
                <Feather name="folder" size={20} color={colors.cyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={styles.projectName}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {p.name}
                </Text>
                <Text style={styles.projectMeta}>
                  {p.files.length} files • {p.tech_stack.join(" · ") || "mixed"}
                </Text>
              </View>
              <TouchableOpacity
                testID={`project-delete-${p.id}`}
                onPress={() => remove(p)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Feather name="trash-2" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  brand: {
    fontSize: 34,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -1.2,
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 12,
    fontFamily: fonts.mono,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  badgeText: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  importCard: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: "center",
    backgroundColor: colors.surface,
    gap: 10,
    marginBottom: spacing.md,
  },
  iconGlow: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(229,255,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderFocus,
  },
  importTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  importSub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    fontFamily: fonts.mono,
  },
  badges: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  tag: {
    color: colors.accent,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    fontSize: 10,
    fontFamily: fonts.mono,
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 14,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.mono,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sectionCount: {
    color: colors.textTertiary,
    fontSize: 11,
    fontFamily: fonts.mono,
  },
  emptyState: {
    alignItems: "center",
    padding: spacing.xl,
    gap: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    fontWeight: "700",
    fontSize: 16,
    marginTop: 8,
  },
  emptySub: {
    color: colors.textTertiary,
    fontSize: 12,
    textAlign: "center",
    fontFamily: fonts.mono,
  },
  projectCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  projectLeft: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  projectName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  projectMeta: {
    color: colors.textTertiary,
    fontSize: 11,
    fontFamily: fonts.mono,
    marginTop: 2,
  },
});
