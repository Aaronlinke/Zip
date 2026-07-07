import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/src/lib/theme";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bottomSheet,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: {
          fontFamily: "SpaceMono",
          fontSize: 10,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginTop: 2,
        },
        tabBarIcon: ({ color, focused }) => (
          <View style={styles.iconWrap}>
            {focused ? (
              <View
                style={[styles.activeIndicator, { backgroundColor: color }]}
              />
            ) : null}
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Forge",
          tabBarIcon: ({ color }) => (
            <Feather name="package" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="editor"
        options={{
          title: "Editor",
          tabBarIcon: ({ color }) => (
            <Feather name="code" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="preview"
        options={{
          title: "Preview",
          tabBarIcon: ({ color }) => (
            <Feather name="play" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: "AI Lab",
          tabBarIcon: ({ color }) => (
            <Feather name="cpu" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color }) => (
            <Feather name="book-open" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="forge"
        options={{
          title: "Pipeline",
          tabBarIcon: ({ color }) => (
            <Feather name="zap" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  activeIndicator: {
    position: "absolute",
    top: -10,
    height: 2,
    width: 16,
    borderRadius: 1,
  },
});
