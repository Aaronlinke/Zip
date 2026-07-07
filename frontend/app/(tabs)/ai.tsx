import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radii, fonts } from "@/src/lib/theme";
import { storage } from "@/src/utils/storage";
import { ChatMessage, sendChatMessage, fetchSessionMessages } from "@/src/lib/api";
import {
  getActiveFilePath,
  getActiveProjectId,
  getProject,
} from "@/src/lib/projectStore";

const SESSION_KEY = "zipforge.chat.sessionId";

const QUICK_PROMPTS = [
  { icon: "search", label: "Explain code", text: "Explain what this code does step by step." },
  { icon: "zap", label: "Optimize", text: "Refactor this code to be cleaner and faster while keeping behavior identical." },
  { icon: "shield", label: "Find bugs", text: "Review this code for bugs, edge cases, and security issues." },
  { icon: "repeat", label: "Convert", text: "Convert this code to Python (or ask me which language)." },
  { icon: "book", label: "Docs", text: "Add clear JSDoc/docstring comments to this code." },
];

type Block = { kind: "text" | "code"; content: string; lang?: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m.index > last)
      blocks.push({ kind: "text", content: md.slice(last, m.index) });
    blocks.push({ kind: "code", lang: m[1] || "", content: m[2] });
    last = m.index + m[0].length;
  }
  if (last < md.length) blocks.push({ kind: "text", content: md.slice(last) });
  return blocks;
}

export default function AiChat() {
  const params = useLocalSearchParams<{ withContext?: string }>();
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [codeContext, setCodeContext] = useState<{
    fileName: string;
    content: string;
  } | null>(null);
  const [includeContext, setIncludeContext] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Init session
  useEffect(() => {
    (async () => {
      const raw = await storage.getItem<string>(SESSION_KEY, "");
      if (raw) {
        setSessionId(raw);
        try {
          const msgs = await fetchSessionMessages(raw);
          setMessages(msgs);
        } catch {}
      } else {
        const s = `s_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        await storage.setItem(SESSION_KEY, s);
        setSessionId(s);
      }
    })();
  }, []);

  // Load code context from active project
  const loadContext = useCallback(async () => {
    const pid = await getActiveProjectId();
    const path = await getActiveFilePath();
    if (!pid || !path) {
      setCodeContext(null);
      return;
    }
    const proj = await getProject(pid);
    const file = proj?.files.find((f) => f.path === path);
    if (file && file.language !== "binary") {
      setCodeContext({ fileName: file.path, content: file.content });
    } else {
      setCodeContext(null);
    }
  }, []);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (params.withContext === "1") setIncludeContext(true);
  }, [params.withContext]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages, sending]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !sessionId || sending) return;
    setSending(true);
    const optimistic: ChatMessage = {
      id: `local_${Date.now()}`,
      session_id: sessionId,
      role: "user",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const res = await sendChatMessage({
        session_id: sessionId,
        message: msg,
        code_context:
          includeContext && codeContext ? codeContext.content : undefined,
        file_name: includeContext && codeContext ? codeContext.fileName : undefined,
      });
      setMessages((prev) => [...prev, res]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          session_id: sessionId,
          role: "assistant",
          content: `⚠️ Error: ${String(e)}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const newChat = async () => {
    const s = `s_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await storage.setItem(SESSION_KEY, s);
    setSessionId(s);
    setMessages([]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AI Lab</Text>
          <Text style={styles.subtitle}>Claude Sonnet 4.5</Text>
        </View>
        <TouchableOpacity
          onPress={newChat}
          testID="new-chat-btn"
          style={styles.iconBtn}
        >
          <Feather name="plus-square" size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {codeContext ? (
        <TouchableOpacity
          onPress={() => setIncludeContext((v) => !v)}
          style={[
            styles.contextBar,
            includeContext && { borderColor: colors.borderFocus },
          ]}
          testID="context-toggle-btn"
        >
          <Feather
            name={includeContext ? "check-square" : "square"}
            size={14}
            color={includeContext ? colors.accent : colors.textSecondary}
          />
          <Text
            style={styles.contextText}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {includeContext ? "Attaching:" : "Attach code:"} {codeContext.fileName}
          </Text>
        </TouchableOpacity>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.messagesBox}
      >
        {messages.length === 0 && !sending ? (
          <View style={styles.welcome}>
            <View style={styles.welcomeIcon}>
              <Feather name="cpu" size={30} color={colors.accent} />
            </View>
            <Text style={styles.welcomeTitle}>Ask ZipForge AI</Text>
            <Text style={styles.welcomeSub}>
              Analyze code, find bugs, convert between languages, or generate
              new modules. Powered by Claude Sonnet 4.5.
            </Text>
            <View style={styles.chipsRow}>
              {QUICK_PROMPTS.map((p) => (
                <TouchableOpacity
                  key={p.label}
                  style={styles.chip}
                  onPress={() => send(p.text)}
                  testID={`quick-prompt-${p.label}`}
                >
                  <Feather name={p.icon as any} size={12} color={colors.accent} />
                  <Text style={styles.chipText}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        {sending ? (
          <View style={[styles.bubble, styles.aiBubble]}>
            <View style={styles.typingRow}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.typingText}>thinking...</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <View style={styles.inputBar}>
          <TextInput
            testID="chat-input"
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything..."
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            multiline
            editable={!sending}
          />
          <TouchableOpacity
            testID="send-chat-btn"
            style={[
              styles.sendBtn,
              (!input.trim() || sending) && { opacity: 0.4 },
            ]}
            onPress={() => send()}
            disabled={!input.trim() || sending}
          >
            <Feather name="arrow-up" size={20} color={colors.textInverse} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const blocks = parseBlocks(message.content);
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.aiBubble,
      ]}
    >
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <CodeBlock key={i} content={b.content} lang={b.lang} />
        ) : (
          <Text key={i} style={styles.msgText}>
            {b.content.trim()}
          </Text>
        )
      )}
    </View>
  );
}

function CodeBlock({ content, lang }: { content: string; lang?: string }) {
  const copy = async () => {
    await Clipboard.setStringAsync(content);
  };
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{lang || "code"}</Text>
        <TouchableOpacity onPress={copy} hitSlop={8}>
          <Feather name="copy" size={12} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.codeText}>{content}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
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
  iconBtn: { padding: 8 },
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    borderTopWidth: 1,
    borderTopColor: "transparent",
  },
  contextText: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 11,
    flex: 1,
  },
  messagesBox: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  bubble: {
    padding: spacing.md,
    borderRadius: radii.lg,
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    backgroundColor: colors.surfaceElevated,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    alignSelf: "flex-start",
    maxWidth: "94%",
    backgroundColor: "transparent",
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    borderTopLeftRadius: 4,
  },
  msgText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 22,
  },
  codeBlock: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginVertical: 6,
  },
  codeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  codeLang: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  codeText: {
    padding: 12,
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  welcome: {
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  welcomeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(229,255,0,0.08)",
    borderWidth: 1,
    borderColor: colors.borderFocus,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  welcomeTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  welcomeSub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    fontFamily: fonts.mono,
    marginBottom: spacing.md,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  typingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingText: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  inputBar: {
    flexDirection: "row",
    padding: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bottomSheet,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    color: colors.textPrimary,
    padding: spacing.sm,
    minHeight: 40,
    maxHeight: 120,
    fontSize: 14,
    backgroundColor: colors.surface,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
