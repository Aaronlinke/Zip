import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radii, fonts } from "@/src/lib/theme";
import { exportTermuxInstaller, exportApkBuilder } from "@/src/lib/api";
import {
  getActiveFilePath,
  getActiveProjectId,
  getProject,
  Project,
  ProjectFile,
  setActiveFilePath,
  updateProject,
} from "@/src/lib/projectStore";

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: ProjectFile;
};

function buildTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const f of files) {
    if (f.path.startsWith("__MACOSX")) continue;
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLeaf = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === name);
      if (!next) {
        next = {
          name,
          path: parts.slice(0, i + 1).join("/"),
          isDir: !isLeaf,
          children: [],
          file: isLeaf ? f : undefined,
        };
        cur.children.push(next);
      }
      cur = next;
    }
  }
  const sortRec = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

export default function EditorScreen() {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [activePath, setActivePathState] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [showTree, setShowTree] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadState = useCallback(async () => {
    const pid = await getActiveProjectId();
    if (!pid) {
      setProject(null);
      setActivePathState(null);
      setContent("");
      return;
    }
    const p = await getProject(pid);
    setProject(p);
    if (!p) return;
    const active = await getActiveFilePath();
    if (active) {
      const file = p.files.find((f) => f.path === active);
      if (file) {
        setActivePathState(active);
        setContent(file.content);
        // Expand ancestor folders
        const s = new Set<string>();
        const parts = active.split("/");
        for (let i = 1; i < parts.length; i++)
          s.add(parts.slice(0, i).join("/"));
        setExpanded(s);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadState();
    }, [loadState])
  );

  const tree = useMemo(
    () => (project ? buildTree(project.files) : null),
    [project]
  );

  const selectFile = async (file: ProjectFile) => {
    if (file.language === "binary") return;
    setActivePathState(file.path);
    setContent(file.content);
    setDirty(false);
    await setActiveFilePath(file.path);
    setShowTree(false);
  };

  const toggleFolder = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const save = async () => {
    if (!project || !activePath) return;
    setSaving(true);
    const idx = project.files.findIndex((f) => f.path === activePath);
    if (idx >= 0) {
      const updated: Project = {
        ...project,
        files: project.files.map((f, i) =>
          i === idx ? { ...f, content, size: content.length } : f
        ),
      };
      await updateProject(updated);
      setProject(updated);
      setDirty(false);
    }
    setSaving(false);
  };

  const copyAll = async () => {
    await Clipboard.setStringAsync(content);
  };

  const goPreview = async () => {
    if (dirty) await save();
    router.push("/(tabs)/preview");
  };

  const askAI = async () => {
    if (dirty) await save();
    router.push({
      pathname: "/(tabs)/ai",
      params: { withContext: "1" },
    });
  };

  const exportTermux = async () => {
    if (!project) return;
    if (dirty) await save();
    try {
      const res = await exportTermuxInstaller({
        project_name: project.name,
        files: project.files.map((f) => ({
          path: f.path,
          content: f.content,
          size: f.size,
          language: f.language,
        })),
        target_env: project.files.some((f) => f.language === "python")
          ? "python"
          : project.files.some((f) => f.language === "html")
            ? "html_js"
            : project.files.some((f) => f.language === "lua")
              ? "lua"
              : "termux",
      });
      await Clipboard.setStringAsync(res.content);
      Alert.alert(
        "Termux Installer bereit",
        `${res.file_count} Dateien konsolidiert in ${res.filename} (${res.size} bytes). Script wurde in die Zwischenablage kopiert. Auf Android in Termux einfügen und ausführen.`
      );
    } catch (e) {
      Alert.alert("Export fehlgeschlagen", String(e));
    }
  };

  const exportApk = async () => {
    if (!project) return;
    if (dirty) await save();
    const hasHtml = project.files.some((f) => f.language === "html");
    if (!hasHtml) {
      Alert.alert(
        "Keine HTML-Datei",
        "APK-Build benötigt eine HTML-Datei (WebView-App). Füge z.B. eine index.html hinzu."
      );
      return;
    }
    try {
      const pkgSuffix = project.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const res = await exportApkBuilder({
        project_name: project.name,
        package_id: `com.zipforge.${pkgSuffix || "app"}`,
        files: project.files.map((f) => ({
          path: f.path,
          content: f.content,
          size: f.size,
          language: f.language,
        })),
      });
      await Clipboard.setStringAsync(res.content);
      Alert.alert(
        "APK-Builder bereit",
        `Package: ${res.package_id}\nMain: ${res.main_html}\nAssets: ${res.file_count}\n\nScript kopiert! In Termux einfügen → APK landet in $HOME/${res.package_id.replace(/\./g, "_")}.apk`
      );
    } catch (e) {
      Alert.alert("APK-Build fehlgeschlagen", String(e));
    }
  };

  if (!project) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.emptyBox}>
          <Feather name="code" size={40} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No project loaded</Text>
          <Text style={styles.emptySub}>
            Import a ZIP or create a project from the Forge tab.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push("/(tabs)")}
            testID="go-to-projects-btn"
          >
            <Text style={styles.primaryBtnText}>OPEN FORGE</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => setShowTree((v) => !v)}
          testID="toggle-tree-btn"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name={showTree ? "chevron-down" : "chevron-right"}
            size={22}
            color={colors.textPrimary}
          />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.projectName} numberOfLines={1}>
            {project.name}
          </Text>
          <Text style={styles.filePath} numberOfLines={1} ellipsizeMode="middle">
            {activePath || "select a file"}
            {dirty ? " •" : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={save}
          disabled={!dirty || saving}
          testID="save-btn"
          style={[styles.iconBtn, !dirty && { opacity: 0.4 }]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Feather name="save" size={18} color={colors.accent} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={copyAll}
          testID="copy-btn"
          style={styles.iconBtn}
        >
          <Feather name="copy" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={goPreview}
          testID="preview-action-btn"
        >
          <Feather name="play" size={14} color={colors.accent} />
          <Text style={styles.actionText}>Preview</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={askAI}
          testID="ai-action-btn"
        >
          <Feather name="cpu" size={14} color={colors.accent} />
          <Text style={styles.actionText}>Ask AI</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={exportTermux}
          testID="export-termux-btn"
        >
          <Feather name="smartphone" size={14} color={colors.accent} />
          <Text style={styles.actionText}>Termux</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionPill}
          onPress={exportApk}
          testID="export-apk-btn"
        >
          <Feather name="package" size={14} color={colors.accent} />
          <Text style={styles.actionText}>APK</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {activePath ? (
          <View style={styles.langPill}>
            <Text style={styles.langPillText}>
              {project.files.find((f) => f.path === activePath)?.language ||
                "text"}
            </Text>
          </View>
        ) : null}
      </View>

      {showTree && tree ? (
        <ScrollView
          style={styles.treeBox}
          contentContainerStyle={{ padding: spacing.md }}
        >
          <TreeRender
            node={tree}
            depth={0}
            expanded={expanded}
            activePath={activePath}
            onFile={selectFile}
            onFolder={toggleFolder}
          />
        </ScrollView>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={styles.editorScroll}
            horizontal={false}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <TextInput
              testID="code-editor-input"
              value={content}
              onChangeText={(t) => {
                setContent(t);
                setDirty(true);
              }}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textAlignVertical="top"
              style={styles.codeInput}
              placeholder={activePath ? "" : "Select a file from the tree..."}
              placeholderTextColor={colors.textTertiary}
              editable={!!activePath}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function TreeRender({
  node,
  depth,
  expanded,
  activePath,
  onFile,
  onFolder,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activePath: string | null;
  onFile: (f: ProjectFile) => void;
  onFolder: (path: string) => void;
}) {
  const rows: React.ReactElement[] = [];
  const render = (n: TreeNode, d: number) => {
    if (n.name) {
      const isActive = n.file && n.file.path === activePath;
      const isOpen = expanded.has(n.path);
      rows.push(
        <TouchableOpacity
          key={n.path}
          testID={`tree-node-${n.path}`}
          style={[
            styles.treeRow,
            isActive && {
              backgroundColor: colors.surfaceElevated,
              borderLeftColor: colors.cyan,
              borderLeftWidth: 2,
            },
          ]}
          onPress={() =>
            n.isDir ? onFolder(n.path) : n.file && onFile(n.file)
          }
        >
          <View style={{ width: d * 12 }} />
          <Feather
            name={
              n.isDir
                ? isOpen
                  ? "folder-minus"
                  : "folder"
                : n.file?.language === "binary"
                  ? "image"
                  : "file-text"
            }
            size={14}
            color={n.isDir ? colors.cyan : colors.textSecondary}
          />
          <Text
            style={[
              styles.treeText,
              isActive && { color: colors.accent, fontWeight: "700" },
            ]}
            numberOfLines={1}
          >
            {n.name}
          </Text>
        </TouchableOpacity>
      );
    }
    if (n.isDir && (depth === 0 || expanded.has(n.path) || n === node)) {
      n.children.forEach((c) => render(c, d + 1));
    }
  };
  render(node, depth - 1);
  return <>{rows}</>;
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
    gap: 4,
  },
  projectName: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  filePath: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    marginTop: 2,
  },
  iconBtn: {
    padding: 8,
    borderRadius: radii.sm,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderFocus,
  },
  actionText: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  langPill: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  langPillText: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  treeBox: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  treeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 8,
    borderLeftWidth: 2,
    borderLeftColor: "transparent",
  },
  treeText: {
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: 13,
    flex: 1,
  },
  editorScroll: { flex: 1, backgroundColor: colors.editorBg },
  codeInput: {
    flex: 1,
    minHeight: "100%",
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  emptyBox: {
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
