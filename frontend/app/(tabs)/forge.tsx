import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radii, fonts } from "@/src/lib/theme";
import { storage } from "@/src/utils/storage";
import {
  startForgePipeline,
  getForgeJob,
  PipelineJob,
  TargetEnv,
} from "@/src/lib/api";
import {
  addProject,
  detectTechStack,
  Project,
  setActiveFilePath,
  setActiveProjectId,
} from "@/src/lib/projectStore";

const ACTIVE_JOB_KEY = "zipforge.activeJobId";

const TARGETS: {
  id: TargetEnv;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  hint: string;
}[] = [
  {
    id: "html_js",
    label: "HTML/JS App",
    icon: "globe",
    hint: "Erstelle eine reaktionsschnelle Web-App mit Echtzeit-Charts, Formularen oder Spielen.",
  },
  {
    id: "python",
    label: "Python 3",
    icon: "cpu",
    hint: "Implementiere ein Feed-Forward Neuronales Netz zur Klassifizierung.",
  },
  {
    id: "termux",
    label: "Termux (Android)",
    icon: "smartphone",
    hint: "Automatisiertes Termux-Backup mit Kompression und termux-api Telemetrie.",
  },
  {
    id: "powershell",
    label: "PowerShell",
    icon: "monitor",
    hint: "Kryptografischer Algorithmus zur Entropie-Maximierung lokaler Logs.",
  },
  {
    id: "sqlite",
    label: "SQLite SQL",
    icon: "database",
    hint: "Normalisiertes Schema mit rekursiven CTEs zur Kontostand-Berechnung.",
  },
  {
    id: "lua",
    label: "Lua VM",
    icon: "layers",
    hint: "Leichter LZW-Kompressionsalgorithmus für In-Memory-Datenstrukturen.",
  },
];

const STAGE_LABEL: Record<string, string> = {
  architect: "ARCHITECT",
  refiner: "REFINER",
  synthesizer: "SYNTHESIZER",
};

export default function ForgePipeline() {
  const router = useRouter();
  const [target, setTarget] = useState<TargetEnv>("html_js");
  const [prompt, setPrompt] = useState(
    "Erstelle eine reaktionsschnelle Web-App mit Live-Uhr, Wetter-Widget und Dark-Mode-Toggle."
  );
  const [running, setRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineJob | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pollingRef = useRef<boolean>(false);

  const setTargetAndHint = (t: TargetEnv) => {
    setTarget(t);
    const hint = TARGETS.find((x) => x.id === t)?.hint;
    if (hint) setPrompt(hint);
  };

  const pollJob = useCallback(async (jobId: string) => {
    if (pollingRef.current) return; // already polling
    pollingRef.current = true;
    setRunning(true);
    const maxAttempts = 180; // 6 minutes at 2s
    let attempts = 0;
    let job: PipelineJob | null = null;
    while (attempts < maxAttempts && pollingRef.current) {
      try {
        job = await getForgeJob(jobId);
        setResult(job);
        setCurrentStage(job.stage);
        if (job.status === "done" || job.status === "error") break;
      } catch {
        // Silent retry on network flake
      }
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
    }
    pollingRef.current = false;
    setRunning(false);
    setCurrentStage(null);
    if (job?.status === "done") {
      await storage.removeItem(ACTIVE_JOB_KEY);
      setExpanded(job.files[job.files.length - 1]?.name || null);
    } else if (job?.status === "error") {
      await storage.removeItem(ACTIVE_JOB_KEY);
      const err = job.error || "Unknown error";
      const friendly = err.includes("Budget has been exceeded")
        ? "Emergent LLM Key Budget aufgebraucht.\n\nBitte lade unter Profile → Universal Key → Add Balance auf oder aktiviere Auto-Top-Up. Dein bisher generierter Code ist erhalten."
        : err;
      Alert.alert("Pipeline gestoppt", friendly);
    }
    return job;
  }, []);

  // Resume any active job on mount / focus
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const savedId = await storage.getItem<string>(ACTIVE_JOB_KEY, "");
        if (!savedId || pollingRef.current || !active) return;
        try {
          const job = await getForgeJob(savedId);
          if (!active) return;
          setResult(job);
          if (job.status === "pending" || job.status === "running") {
            pollJob(savedId);
          } else if (job.status === "done") {
            setExpanded(job.files[job.files.length - 1]?.name || null);
            await storage.removeItem(ACTIVE_JOB_KEY);
          } else {
            await storage.removeItem(ACTIVE_JOB_KEY);
          }
        } catch {
          await storage.removeItem(ACTIVE_JOB_KEY);
        }
      })();
      return () => {
        active = false;
      };
    }, [pollJob])
  );

  const start = useCallback(async () => {
    if (!prompt.trim() || running) return;
    setResult(null);
    setCurrentStage("architect");
    setRunning(true);
    try {
      const { job_id } = await startForgePipeline({
        prompt: prompt.trim(),
        target_env: target,
      });
      await storage.setItem(ACTIVE_JOB_KEY, job_id);
      await pollJob(job_id);
    } catch (e) {
      setRunning(false);
      setCurrentStage(null);
      Alert.alert("Pipeline failed to start", String(e));
    }
  }, [prompt, target, running, pollJob]);

  const cancelLocal = useCallback(async () => {
    pollingRef.current = false;
    setRunning(false);
    setCurrentStage(null);
    await storage.removeItem(ACTIVE_JOB_KEY);
  }, []);

  const openAsProject = async () => {
    if (!result) return;
    const files = result.files.map((f) => ({
      path: f.name,
      content: f.content,
      size: f.content.length,
      language: f.language,
    }));
    const project: Project = {
      id: `p_${Date.now().toString(36)}`,
      name: `Forge · ${result.target_env}`,
      files,
      tech_stack: detectTechStack(files),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await addProject(project);
    await setActiveProjectId(project.id);
    await setActiveFilePath(files[files.length - 1].path);
    router.push("/(tabs)/editor");
  };

  const copyAll = async () => {
    if (!result) return;
    const combined = result.files
      .map((f) => `// ===== ${f.name} =====\n${f.content}`)
      .join("\n\n");
    await Clipboard.setStringAsync(combined);
    Alert.alert("Copied", `${result.files.length} files copied.`);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Forge Pipeline</Text>
          <Text style={styles.subtitle}>
            architect → refiner → synthesizer · claude sonnet 4.5
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}
        >
          <Text style={styles.section}>TARGET SYSTEM</Text>
          <View style={styles.chipGrid}>
            {TARGETS.map((t) => (
              <TouchableOpacity
                key={t.id}
                testID={`target-${t.id}`}
                onPress={() => setTargetAndHint(t.id)}
                style={[
                  styles.targetChip,
                  target === t.id && {
                    borderColor: colors.borderFocus,
                    backgroundColor: "rgba(229,255,0,0.08)",
                  },
                ]}
                disabled={running}
              >
                <Feather
                  name={t.icon}
                  size={16}
                  color={target === t.id ? colors.accent : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.targetChipText,
                    target === t.id && { color: colors.accent },
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.section, { marginTop: spacing.lg }]}>PROMPT</Text>
          <TextInput
            testID="forge-prompt-input"
            value={prompt}
            onChangeText={setPrompt}
            multiline
            editable={!running}
            style={styles.promptInput}
            placeholder="Beschreibe was gebaut werden soll..."
            placeholderTextColor={colors.textTertiary}
          />

          <TouchableOpacity
            testID="run-pipeline-btn"
            style={[styles.runBtn, running && { opacity: 0.6 }]}
            onPress={start}
            disabled={running || !prompt.trim()}
          >
            {running ? (
              <>
                <ActivityIndicator color={colors.textInverse} />
                <Text style={styles.runBtnText}>
                  {currentStage
                    ? `${STAGE_LABEL[currentStage]} · ${result?.files.length ?? 0}/3 FILES`
                    : "STARTING..."}
                </Text>
              </>
            ) : (
              <>
                <Feather name="zap" size={16} color={colors.textInverse} />
                <Text style={styles.runBtnText}>INIT SYNTHESE</Text>
              </>
            )}
          </TouchableOpacity>

          {running ? (
            <TouchableOpacity
              onPress={cancelLocal}
              testID="cancel-pipeline-btn"
              style={styles.cancelBtn}
            >
              <Feather name="x" size={14} color={colors.textSecondary} />
              <Text style={styles.cancelText}>Stop polling (job runs on)</Text>
            </TouchableOpacity>
          ) : null}

          {running ? (
            <View style={styles.stages}>
              {["architect", "refiner", "synthesizer"].map((s, i) => {
                const stageIdx = ["architect", "refiner", "synthesizer"].indexOf(
                  currentStage || ""
                );
                const filesDone = result?.files.length ?? 0;
                const done = i < filesDone;
                const active = i === stageIdx && !done;
                return (
                  <View key={s} style={styles.stageRow}>
                    <View
                      style={[
                        styles.stageDot,
                        active && { backgroundColor: colors.accent },
                        done && { backgroundColor: colors.cyan },
                      ]}
                    />
                    <Text
                      style={[
                        styles.stageName,
                        active && { color: colors.accent, fontWeight: "700" },
                        done && !active && { color: colors.cyan },
                      ]}
                    >
                      {STAGE_LABEL[s]}
                    </Text>
                    {active ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : done ? (
                      <Feather name="check" size={14} color={colors.cyan} />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {result && result.files.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <View style={styles.resultHeader}>
                <Text style={styles.section}>RESULT · {result.files.length} FILES</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    onPress={copyAll}
                    testID="pipeline-copy-all-btn"
                    style={styles.smallBtn}
                  >
                    <Feather name="copy" size={12} color={colors.textPrimary} />
                    <Text style={styles.smallBtnText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={openAsProject}
                    testID="pipeline-open-project-btn"
                    style={[styles.smallBtn, styles.primarySmallBtn]}
                  >
                    <Feather name="corner-up-right" size={12} color={colors.textInverse} />
                    <Text style={[styles.smallBtnText, { color: colors.textInverse }]}>
                      Open project
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {result.files.map((f) => {
                const isOpen = expanded === f.name;
                return (
                  <View key={f.name} style={styles.fileCard}>
                    <TouchableOpacity
                      style={styles.fileHead}
                      onPress={() => setExpanded(isOpen ? null : f.name)}
                    >
                      <View style={styles.fileHeadLeft}>
                        <Text style={styles.stageBadge}>{STAGE_LABEL[f.stage]}</Text>
                        <Text style={styles.fileName}>{f.name}</Text>
                      </View>
                      <Feather
                        name={isOpen ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                    {isOpen ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.codeScroll}
                      >
                        <Text style={styles.codeText}>{f.content}</Text>
                      </ScrollView>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
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
  section: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  targetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minWidth: "48%",
  },
  targetChipText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  promptInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 13,
    minHeight: 100,
    textAlignVertical: "top",
    fontFamily: fonts.mono,
  },
  runBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: radii.md,
  },
  runBtnText: {
    color: colors.textInverse,
    fontWeight: "900",
    letterSpacing: 1.5,
    fontSize: 13,
  },
  cancelBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  cancelText: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  stages: {
    marginTop: spacing.lg,
    gap: 10,
  },
  stageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  stageName: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primarySmallBtn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  smallBtnText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
  },
  fileCard: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  fileHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  fileHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  stageBadge: {
    color: colors.accent,
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: colors.borderFocus,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  fileName: {
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  codeScroll: {
    backgroundColor: colors.editorBg,
    maxHeight: 300,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  codeText: {
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 17,
    padding: 12,
  },
});
